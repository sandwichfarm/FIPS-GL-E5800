#!/usr/bin/env python3
"""Annotate failed local-CI suites with the host load during their run.

ci-local.sh samples CPU pressure (/proc/pressure/cpu, "some" total stall
microseconds) and the count of other CI runs' containers every few
seconds into a load log, and writes window lines around each suite. This
reads that log and prints, for each failed suite named on the command
line, the stall percentage over the suite's window, the peak number of
foreign runs, and a label:

  LOAD-DEGRADED       stall at or above the threshold
  not load-degraded   stall below it
  load unknown (...)  the window or the samples needed to say are missing

The label is context for a human reading a red. It changes no verdict:
a red stays a red. Unknown is never reported as "not load-degraded".

Log lines (whitespace-separated, first field a Unix epoch):

  <t> psi <some_total_us|none> runs <n> load1 <x>
  <t> barrier
  <t> begin <suite>          (chaos suites only)
  <t> end <suite>

A chaos suite's window runs from its begin to its end. Any other suite's
window runs from the latest preceding "end" of a non-chaos suite or
"barrier" line up to its own end.

Usage:
  load-annotate.py <load-log> --threshold <pct> <failed-suite>...
  load-annotate.py <load-log> --run
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass


@dataclass
class Sample:
    """One sampler line."""

    t: float
    psi: int | None
    runs: int | None


def parse(path: str):
    """Return (samples, events) from a load log; events keep file order."""
    samples: list[Sample] = []
    events: list[tuple[float, str, str | None]] = []
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                t = float(parts[0])
            except ValueError:
                continue
            kind = parts[1]
            if kind == "psi":
                fields = dict(zip(parts[1::2], parts[2::2]))
                psi = fields.get("psi")
                runs = fields.get("runs")
                samples.append(Sample(
                    t,
                    int(psi) if psi and psi.isdigit() else None,
                    int(runs) if runs and runs.isdigit() else None,
                ))
            elif kind == "barrier":
                events.append((t, "barrier", None))
            elif kind in ("begin", "end") and len(parts) >= 3:
                events.append((t, kind, parts[2]))
    return samples, events


def window(name: str, events) -> tuple[float, float] | str:
    """Return (start, end) for a suite, or the reason there is none."""
    if name.startswith("chaos-"):
        begins = [e for e in events if e[1] == "begin" and e[2] == name]
        ends = [e for e in events if e[1] == "end" and e[2] == name]
        if not begins and not ends:
            return "no window"
        if len(begins) != 1 or len(ends) != 1 or ends[0][0] < begins[0][0]:
            return "ambiguous window"
        return begins[0][0], ends[0][0]
    idx = [i for i, e in enumerate(events) if e[1] == "end" and e[2] == name]
    if not idx:
        return "no window"
    if len(idx) > 1:
        return "ambiguous window"
    end_i = idx[0]
    start = None
    for e in reversed(events[:end_i]):
        if e[1] == "barrier" or (e[1] == "end" and not e[2].startswith("chaos-")):
            start = e[0]
            break
    if start is None:
        return "no window"
    return start, events[end_i][0]


def stall(samples: list[Sample], start: float, end: float) -> float | str:
    """Stall percent over [start, end], or the reason it cannot be given."""
    psi = [s for s in samples if s.psi is not None]
    if not psi:
        return "no PSI samples"
    before = [s for s in psi if s.t <= start]
    after = [s for s in psi if s.t >= end]
    s0 = before[-1] if before else next((s for s in psi if s.t >= start), None)
    s1 = after[0] if after else next((s for s in reversed(psi) if s.t <= end), None)
    if s0 is None or s1 is None or s1.t - s0.t <= 0:
        return "too few PSI samples in window"
    return (s1.psi - s0.psi) / ((s1.t - s0.t) * 1e6) * 100


def peak_runs(samples: list[Sample], start: float, end: float) -> int | None:
    """Largest foreign-run count sampled inside the window."""
    runs = [s.runs for s in samples if start <= s.t <= end and s.runs is not None]
    return max(runs) if runs else None


def annotate(name: str, samples, events, threshold: float) -> str:
    """One annotation line for a failed suite."""
    w = window(name, events)
    if isinstance(w, str):
        return f"{name}: load unknown ({w})"
    start, end = w
    pct = stall(samples, start, end)
    if isinstance(pct, str):
        return f"{name}: load unknown ({pct})"
    runs = peak_runs(samples, start, end)
    label = "LOAD-DEGRADED" if pct >= threshold else "not load-degraded"
    runs_txt = "?" if runs is None else str(runs)
    return (f"{name}: {label} (cpu stall {pct:.1f}% over {end - start:.0f}s, "
            f"threshold {threshold:g}%; peak foreign CI runs {runs_txt})")


def run_line(samples) -> str:
    """Run-level summary: peak interval stall and peak foreign runs."""
    psi = [s for s in samples if s.psi is not None]
    peaks = [
        (b.psi - a.psi) / ((b.t - a.t) * 1e6) * 100
        for a, b in zip(psi, psi[1:]) if b.t > a.t
    ]
    runs = [s.runs for s in samples if s.runs is not None]
    stall_txt = f"{max(peaks):.1f}%" if peaks else "unknown (no PSI samples)"
    runs_txt = str(max(runs)) if runs else "unknown"
    return f"host load: peak cpu stall {stall_txt}; peak foreign CI runs {runs_txt}"


def main(argv: list[str]) -> int:
    """Entry point."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("log")
    ap.add_argument("--threshold", type=float)
    ap.add_argument("--run", action="store_true")
    ap.add_argument("suites", nargs="*")
    a = ap.parse_intermixed_args(argv)
    try:
        samples, events = parse(a.log)
    except OSError as exc:
        for name in a.suites:
            print(f"{name}: load unknown (load log unreadable: {exc.strerror})")
        if a.run:
            print("host load: unknown (load log unreadable)")
        return 0
    if a.run:
        print(run_line(samples))
    if a.suites and a.threshold is None:
        ap.error("--threshold is required with suite names")
    for name in a.suites:
        print(annotate(name, samples, events, a.threshold))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
