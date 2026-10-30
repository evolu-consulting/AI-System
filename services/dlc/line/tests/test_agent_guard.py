"""The PreToolUse guard agents' shell commands pass through (line.agent_guard)."""

from __future__ import annotations

import io
import json
import os
import unittest
from unittest import mock

from line import agent_guard

CWD = os.path.abspath(os.path.join(os.sep, "dlc", "work", "R1", "U1"))


class GuardTest(unittest.TestCase):
    def refused(self, cmd):
        return bool(agent_guard.check(cmd, CWD))

    def test_push_only_on_own_branches(self):
        for cmd in ("git push", "git push origin main", "git push origin HEAD:main", "git push -f origin master",
                    "git commit -m x && git push origin master", "git push origin"):
            self.assertTrue(self.refused(cmd), cmd)
        for cmd in ("git push origin dlc/feature-x", "git push -u origin fix/abc", "git status"):
            self.assertFalse(self.refused(cmd), cmd)

    def test_recursive_delete_stays_in_the_working_folder(self):
        for cmd in ("rm -rf ../other", "rm -rf /", "rm -rf ~", r"rm -rf C:\Windows", r"Remove-Item -Recurse -Force C:\Users\x",
                    r"rmdir /s /q ..\..", "rm -r -f build ../../x"):
            self.assertTrue(self.refused(cmd), cmd)
        for cmd in ("rm -rf build", r"Remove-Item -Recurse -Force .\dist", "rm -rf node_modules dist", "rm file.txt"):
            self.assertFalse(self.refused(cmd), cmd)

    def test_no_production_deploys(self):
        for cmd in ("cf push ticketing-prod", "cf target -s prod && cf push app", "npm run deploy:prod",
                    "gcloud run deploy svc --project my-prd", "helm upgrade api ./chart -n production"):
            self.assertTrue(self.refused(cmd), cmd)
        for cmd in ("cf push ticketing-qa", "npm run deploy -- --env qa", "pytest -q", "echo production notes"):
            self.assertFalse(self.refused(cmd), cmd)

    def test_hook_protocol(self):
        call = {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}, "cwd": CWD}
        err = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO(json.dumps(call))), mock.patch("sys.stderr", err):
            self.assertEqual(agent_guard.main(), 2)
        self.assertIn("DLC guard", err.getvalue())
        call = {"tool_name": "Read", "tool_input": {"file_path": "x"}, "cwd": CWD}
        with mock.patch("sys.stdin", io.StringIO(json.dumps(call))):
            self.assertEqual(agent_guard.main(), 0)

    def test_runs_as_the_hook_command(self):
        # exactly how Claude CLI calls it in source mode: the file as a script, the call on stdin
        import subprocess
        import sys
        call = {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}, "cwd": CWD}
        p = subprocess.run([sys.executable, agent_guard.__file__], input=json.dumps(call), capture_output=True, text=True)
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn("DLC guard", p.stderr)


if __name__ == "__main__":
    unittest.main()
