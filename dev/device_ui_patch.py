#!/usr/bin/env python3
"""Apply exact, reviewable FIPS hooks to the pinned community dashboard."""

from pathlib import Path
import argparse


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "components/device-ui/src/dashboard.py"
PANEL = ROOT / "packaging/device-ui/fips_panel.inc.py"


def one(source, before, after):
    count = source.count(before)
    if count != 1:
        raise ValueError(f"Dashboard integration anchor changed ({count} matches): {before[:70]}")
    return source.replace(before, after, 1)


def render(source=None):
    source = SOURCE.read_text() if source is None else source
    panel = PANEL.read_text()
    source = one(source,
                 'PANEL_NAMES = ["clock", "sim", "monitor", "weather", "fx", "openclash", "games"]',
                 'PANEL_NAMES = ["clock", "sim", "monitor", "weather", "fx", "openclash", "games", "fips"]' + panel)
    source = one(source, 'def draw_page_dots(d, active_idx, count=7):',
                 'def draw_page_dots(d, active_idx, count=8):')
    source = one(source,
                 '        elif name == "games":\n            return panel_games(game_scores)',
                 '        elif name == "games":\n            return panel_games(game_scores)\n'
                 '        elif name == "fips":\n            return panel_fips(conn_type, cell_signal)')
    source = one(source,
                 '                        elif name == "monitor":\n                            zone = hit_main_monitor(down_x, down_y)',
                 '                        elif name == "monitor":\n                            zone = hit_main_monitor(down_x, down_y)\n'
                 '                        elif name == "fips":\n                            zone = hit_main_fips(down_x, down_y)')
    source = one(source,
                 '                        elif name == "monitor" and zone == "speedtest":\n                            new_view = "speedtest"',
                 '                        elif name == "monitor" and zone == "speedtest":\n                            new_view = "speedtest"\n'
                 '                        elif name == "fips" and zone == "stage_toggle":\n'
                 '                            show_notice(fips_toggle_action())')
    source = one(source,
                 '        ("games_hub", panel_games(load_game_scores())),',
                 '        ("fips", panel_fips(conn_type, cell_signal)),\n'
                 '        ("games_hub", panel_games(load_game_scores())),')
    compile(source, "generated-dashboard.py", "exec")
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render())
    print(args.output)


if __name__ == "__main__":
    main()
