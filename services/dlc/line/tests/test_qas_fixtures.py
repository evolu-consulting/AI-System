"""QAS collector runs class / module fixtures (regression 2026-10-12).

A generated web-app acceptance test started its server in setUpClass. The collector ran each TestCase with
t.run(), which skips setUpClass, so every QAS run was red although the same test passed with unittest.
"""

from __future__ import annotations

import os
import tempfile
import textwrap
import unittest

from line.ship import qas_runner


def _write(root: str, rel: str, text: str) -> None:
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(textwrap.dedent(text))


class QasFixtureTests(unittest.TestCase):
    def test_set_up_class_runs(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            _write(d, "tests/__init__.py", "")
            _write(d, "tests/acceptance/__init__.py", "")
            _write(d, "tests/acceptance/test_f1.py", """
                import unittest

                class TestF1(unittest.TestCase):
                    port = None

                    @classmethod
                    def setUpClass(cls):
                        cls.port = 8123

                    def test_c1(self):
                        self.assertEqual(self.port, 8123)

                    def test_c2(self):
                        self.assertIsNotNone(self.port)
            """)
            res = qas_runner.default_case_runner(d, ["tests.acceptance.test_f1"])
            self.assertEqual(res, {"tests.acceptance.test_f1.TestF1.test_c1": True,
                                   "tests.acceptance.test_f1.TestF1.test_c2": True})

    def test_failing_class_fixture_is_red(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            _write(d, "tests/__init__.py", "")
            _write(d, "tests/acceptance/__init__.py", "")
            _write(d, "tests/acceptance/test_f2.py", """
                import unittest

                class TestF2(unittest.TestCase):
                    @classmethod
                    def setUpClass(cls):
                        raise RuntimeError("server did not start")

                    def test_c1(self):
                        pass
            """)
            res = qas_runner.default_case_runner(d, ["tests.acceptance.test_f2"])
            self.assertFalse(any(res.values()))
            self.assertIn("tests.acceptance.test_f2.TestF2.test_c1", res)


if __name__ == "__main__":
    unittest.main()
