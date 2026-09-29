"""Exercise the actual CGI boundary without a router or administrator secrets."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

CGI = Path(__file__).resolve().parents[1] / "packaging/web-ui/files/www/cgi-bin/gl-sdk4-ui-fips"


class AuthenticationTests(unittest.TestCase):
    def invoke(self, headers=None, group="root", session_ok=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "ubus").write_text("#!/bin/sh\n" + ("printf '{}'\n" if session_ok else "exit 1\n"))
            (root / "jsonfilter").write_text("#!/bin/sh\nprintf '%s' '" + group + "'\n")
            # The real backend path is fixed in the CGI. Intercept timeout only in
            # this fixture to prove successful authorization reaches execution.
            (root / "timeout").write_text("#!/bin/sh\nprintf '%s' '{\"status\":\"ok\",\"executed\":true}'\n")
            for path in root.iterdir():
                path.chmod(0o755)
            env = {"PATH": str(root) + ":" + os.environ["PATH"], "REQUEST_METHOD": "POST",
                   "CONTENT_TYPE": "application/json", "CONTENT_LENGTH": "22",
                   "HTTP_X_GL_ADMIN_TOKEN": "a" * 32}
            env.update(headers or {})
            return subprocess.run(["/bin/sh", str(CGI)], input='{"operation":"status"}',
                                  text=True, env=env, capture_output=True, timeout=10).stdout

    def test_admin_session_reaches_backend(self):
        self.assertIn('"executed":true', self.invoke())

    def test_missing_expired_and_non_admin_sessions_do_not_execute(self):
        for response in (self.invoke({"HTTP_X_GL_ADMIN_TOKEN": ""}),
                         self.invoke(session_ok=False), self.invoke(group="guest")):
            self.assertNotIn("executed", response)
            self.assertIn('"status":"error"', response)

    def test_shell_injection_in_token_does_not_execute(self):
        self.assertIn("401", self.invoke({"HTTP_X_GL_ADMIN_TOKEN": "$(reboot)" + "a" * 23}))

    def test_cross_origin_form_and_get_do_not_execute(self):
        self.assertIn("415", self.invoke({"CONTENT_TYPE": "application/x-www-form-urlencoded"}))
        self.assertIn("405", self.invoke({"REQUEST_METHOD": "GET"}))

    def test_oversized_and_malformed_lengths_do_not_execute(self):
        for length in ("32769", "999999999999999999", "$(reboot)", ""):
            self.assertNotIn("executed", self.invoke({"CONTENT_LENGTH": length}))


if __name__ == "__main__":
    unittest.main()
