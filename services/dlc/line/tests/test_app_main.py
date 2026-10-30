"""The built application's entry (line.app_main): its output is UTF-8 even where PYTHON* variables are ignored."""

from __future__ import annotations

import os
import subprocess
import sys
import unittest

SDLC = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Utf8OutputTest(unittest.TestCase):
    def test_a_check_mark_reaches_a_pipe_without_pythonioencoding(self):
        # -I ignores PYTHON* variables, like the PyInstaller build: the QAS smoke (`dlc suite` through a pipe)
        # died on a test runner's check mark with cp1252 (runs R20261025-123732-8c48, -124714-1c99)
        code = ("import sys; sys.path.insert(0, %r); from line.app_main import _utf8_output; _utf8_output(); "
                "print('\\u2713 ok')" % SDLC)
        env = {k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}
        cp = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, env=env, timeout=60)
        self.assertEqual(cp.returncode, 0, cp.stderr.decode("utf-8", "replace"))
        self.assertEqual(cp.stdout.decode("utf-8").strip(), "✓ ok")


if __name__ == "__main__":
    unittest.main()
