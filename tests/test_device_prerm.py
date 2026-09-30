"""Exercise the touchscreen removal fallback without a complete install."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


PRERM = Path(__file__).resolve().parents[1] / "packaging/device-ui/control/prerm"


class DevicePrermTests(unittest.TestCase):
    def test_partial_install_restores_stock_screen_without_toggle_script(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            services = root / "etc/init.d"
            services.mkdir(parents=True)
            log = root / "services.log"
            for name in ("homebutton", "citydash", "gl_screen"):
                service = services / name
                service.write_text(
                    "#!/bin/sh\n"
                    f"echo '{name}' \"$1\" >> \"$FIPS_TEST_SERVICE_LOG\"\n"
                    "if [ \"$1\" = start ] && [ \"${FIPS_TEST_STOCK_FAIL:-}\" = yes ]; then exit 1; fi\n"
                )
                service.chmod(0o755)
            script = root / "prerm"
            script.write_text(PRERM.read_text().replace("/etc/init.d/", f"{services}/"))
            script.chmod(0o755)
            env = os.environ | {"FIPS_TEST_SERVICE_LOG": str(log)}

            completed = subprocess.run(["sh", str(script)], env=env, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(log.read_text().splitlines(), [
                "homebutton stop", "homebutton disable", "citydash stop",
                "citydash disable", "gl_screen enable", "gl_screen start",
                "gl_screen status",
            ])

            log.unlink()
            failed = subprocess.run(["sh", str(script)], env=env | {"FIPS_TEST_STOCK_FAIL": "yes"},
                                    capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertNotIn("gl_screen status", log.read_text())


if __name__ == "__main__":
    unittest.main()
