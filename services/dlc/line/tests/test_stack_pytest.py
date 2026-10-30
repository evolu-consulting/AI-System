"""The python-pytest stack: detection, the repository's own test command, the summary line."""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from unittest import mock

from line import stacks
from line.stacks import python_pytest


class PytestStackTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="pytest-stack-")
        self.addCleanup(shutil.rmtree, self.d, True)
        os.makedirs(os.path.join(self.d, "tests"))

    def test_a_conftest_makes_it_a_pytest_repo(self):
        self.assertEqual(stacks.detect(self.d).name, "python-unittest")
        open(os.path.join(self.d, "tests", "conftest.py"), "w").close()
        self.assertEqual(stacks.detect(self.d).name, "python-pytest")

    def test_the_repositorys_own_command_runs_the_whole_suite(self):
        st = python_pytest.PythonPytest()
        with mock.patch.dict(os.environ, {"LINE_TEST_CMD": "python scripts/run_tests.py"}):
            self.assertEqual(st.argv([])[1:], ["scripts/run_tests.py"])
            self.assertIn("pytest", st.argv(["tests/test_a.py"]))
        with mock.patch.dict(os.environ, {"LINE_TEST_CMD": ""}):
            self.assertEqual(st.argv([])[1:3], ["-m", "pytest"])

    def test_the_summary_line_gives_ran_and_failures(self):
        out = "....F\nFAILED tests/test_a.py::test_x - assert 1 == 2\n=== 1 failed, 2579 passed, 511 skipped in 63.1s ==="
        with mock.patch.object(python_pytest, "run", lambda argv, cwd, t, env: {"rc": 1, "output": out,
                                                                               "timeout": False}):
            r = python_pytest.PythonPytest().run(self.d, [])
        self.assertEqual((r["ran"], r["rc"]), (2580, 1))
        self.assertEqual(r["failures"], [{"test": "tests/test_a.py::test_x", "kind": "FAIL"}])


if __name__ == "__main__":
    unittest.main()
