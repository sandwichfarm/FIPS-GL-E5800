#!/usr/bin/env bash
# Run namcap on PKGBUILDs and built packages and fail on error-level findings.
#
# The AUR build job lints the release PKGBUILD and the package it builds. The
# rule is that namcap error-level (E:) findings fail the job and warnings (W:)
# stay advisory. namcap's own exit status cannot carry that verdict: namcap
# 3.6 exits 0 when it reports E: findings, and also exits 0 when it could not
# read its input at all (a missing file, an unexpanded glob, a file that is not
# a package). So this script reads namcap's output instead.
#
# For each FILE it requires all of:
#   - the file exists, and its name is a PKGBUILD (PKGBUILD*) or a built
#     package (*.pkg.tar.*);
#   - namcap exits 0;
#   - every non-blank output line is a tagged finding ("<name> X: ..." or
#     "PKGBUILD (<name>) X: ..." with X one of E, W, I);
#   - for a built package, the output includes the "depends-by-namcap-sight"
#     informational line, which namcap prints only after it has analysed the
#     package's dependencies;
#   - no E: findings.
# The last three close the case in which namcap examined nothing: without them
# an unreadable input would show the same zero E: count as a clean package.
#
# A red from the second, third or fourth rule is a failure of the gate to read
# namcap, not a packaging finding. It can follow a namcap update (a Python
# warning on stdout, a renamed tag). Fix the gate for it; do not edit depends.
#
# namcap resolves script interpreters through PATH, and on Arch /usr/sbin is a
# symlink to bin that pacman does not record. Run as root, where /usr/sbin comes
# first, namcap reports an undeclared script dependency such as nftables as a
# warning instead of an error. So namcap runs with /usr/bin first on PATH. The
# AUR job runs namcap under sudo, whose secure_path already puts /usr/bin
# first, so GitHub CI does not exercise this pin; only a run as root does.
#
# Known limit: a PKGBUILD has no such dependency-analysis line, so an empty
# namcap output for a PKGBUILD passes as a clean one does. The built package
# carries dependency detection.
#
# namcap is not pinned, so a namcap or Arch repository update can red the gate
# with no fips change, and that is intended. One known case: the fips package
# does not declare bash, which namcap accepts only because dbus pulls it in; if
# Arch's dbus stops depending on bash, namcap reports bash as an error.
#
# Every file is examined before the verdict, so a failure in one is reported
# even when a later one is clean.
#
# Exit status: 0 all files passed, 1 at least one file failed, 2 usage error
# or namcap not found.
#
# Usage: bash namcap-gate.sh FILE...

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: namcap-gate.sh FILE..." >&2
  exit 2
fi

# Resolve namcap before PATH is changed, so a namcap earlier on the caller's
# PATH is the one that runs.
namcap_bin=$(command -v namcap) || {
  echo "namcap gate: namcap not found on PATH" >&2
  exit 2
}

tagged='^[^ ]+( \([^)]*\))? [EWI]:[[:space:]]'
errpat='^[^ ]+( \([^)]*\))? E:[[:space:]]'
marker='^[^ ]+ I: depends-by-namcap-sight[[:space:]]'

fails=0

for f in "$@"; do
  case "$(basename -- "$f")" in
    PKGBUILD*) mode=pkgbuild ;;
    *.pkg.tar.*) mode=package ;;
    *)
      echo "namcap gate: $f: not a PKGBUILD or package"
      fails=$((fails + 1))
      continue
      ;;
  esac

  if [ ! -f "$f" ]; then
    echo "namcap gate: $f: not found"
    fails=$((fails + 1))
    continue
  fi

  rc=0
  out=$(PATH="/usr/bin:$PATH" "$namcap_bin" -i -m "$f" 2>&1) || rc=$?
  echo "namcap: $f"
  printf '%s\n' "$out"

  errs=0
  seen=0
  bad=""
  while IFS= read -r line; do
    [[ $line =~ ^[[:space:]]*$ ]] && continue
    if ! [[ $line =~ $tagged ]]; then
      [ -n "$bad" ] || bad=$line
      continue
    fi
    if [[ $line =~ $errpat ]]; then
      errs=$((errs + 1))
      echo "::error title=namcap::$line"
    fi
    if [[ $line =~ $marker ]]; then
      seen=1
    fi
  done <<< "$out"

  failed=0
  if [ "$rc" -ne 0 ]; then
    echo "namcap gate: $f: namcap exited $rc"
    failed=1
  fi
  if [ -n "$bad" ]; then
    echo "namcap gate: $f: unrecognised namcap output: $bad"
    failed=1
  fi
  if [ "$mode" = package ] && [ "$seen" -eq 0 ]; then
    echo "namcap gate: $f: no dependency analysis in namcap output"
    failed=1
  fi
  echo "namcap gate: $f: $errs error-level finding(s)"
  [ "$errs" -eq 0 ] || failed=1
  fails=$((fails + failed))
done

if [ "$fails" -eq 0 ]; then
  echo "namcap gate: passed ($# file(s), W: findings are advisory)"
  exit 0
fi
echo "namcap gate: FAILED ($fails of $# file(s) failed)"
exit 1
