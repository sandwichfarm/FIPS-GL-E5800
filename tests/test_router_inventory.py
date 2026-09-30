"""Check private inventory parsing and exact package/service comparisons."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from tools.router_inventory import (SERVICES, capture, compare, parse_packages,
                                    parse_services, parse_stock_files, write_private)


class RouterInventoryTests(unittest.TestCase):
    def test_parse_opkg_status_including_partial_install(self) -> None:
        output = (
            "Package: busybox\nVersion: 1.36.1-1\nStatus: install user installed\n"
            "Conffiles:\n /etc/config/example deadbeef\n\n"
            "Package: fips\nVersion: 0.5.2-1\nStatus: install user unpacked\n"
        )
        self.assertEqual(parse_packages(output), {
            "busybox": ["1.36.1-1", "install user installed"],
            "fips": ["0.5.2-1", "install user unpacked"],
        })
        with self.assertRaisesRegex(ValueError, "duplicate"):
            parse_packages(output + "\n" + output)

    def test_parse_services_requires_every_expected_service(self) -> None:
        output = "".join(f"{name}\tabsent\tabsent\n" for name in SERVICES)
        self.assertEqual(len(parse_services(output)), len(SERVICES))
        with self.assertRaisesRegex(ValueError, "omitted"):
            parse_services(output.splitlines(keepends=True)[0])

    def test_parse_stock_web_and_touchscreen_fingerprints(self) -> None:
        digest = "a" * 64
        output = (f"{digest}  /www/js/app.abc123.js.gz\n"
                  f"{digest}  /usr/bin/gl_screen\n")
        self.assertEqual(parse_stock_files(output), {
            "web_app": ["/www/js/app.abc123.js.gz", digest],
            "touchscreen": ["/usr/bin/gl_screen", digest],
        })
        with self.assertRaisesRegex(ValueError, "unexpected stock web path"):
            parse_stock_files(output.replace("/www/js/app.abc123.js.gz", "/tmp/app.js.gz"))

    def test_compare_reports_exact_package_and_service_drift(self) -> None:
        before = {
            "format": 2, "firmware": "4.10.0",
            "packages": {"busybox": ["1", "install user installed"]},
            "services": {"gl_screen": ["enabled", "running"]},
            "stock_files": {"web_app": ["/www/js/app.abc.js.gz", "a" * 64]},
        }
        self.assertEqual(compare(before, dict(before)), [])
        after = json.loads(json.dumps(before))
        after["packages"]["busybox"][0] = "2"
        after["services"]["gl_screen"][1] = "stopped"
        after["stock_files"]["web_app"][1] = "b" * 64
        self.assertEqual(compare(before, after), [
            "CHANGED package busybox", "CHANGED service gl_screen",
            "CHANGED stock file web_app",
        ])

    def test_private_inventory_is_exclusive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / "private"
            directory.mkdir(mode=0o700)
            destination = directory / "state.json"
            write_private(destination, {"format": 2})
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ValueError, "new"):
                write_private(destination, {"format": 2})
            directory.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "0700"):
                write_private(directory / "other.json", {"format": 2})

    def test_capture_refuses_insecure_identity_before_ssh(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            identity = Path(temporary) / "ssh-key"
            identity.write_text("synthetic")
            identity.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "private regular file"):
                capture("root@192.168.8.1", identity)


if __name__ == "__main__":
    unittest.main()
