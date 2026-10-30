"""Import check of the temporary RITA panel (Master/ui/line_board.py). Skipped without Flet.

The GUI is never launched; only the module import and the offline fetch path are checked.
"""

from __future__ import annotations

import importlib.util
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PANEL = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "Master", "ui", "line_board.py"))

try:
    import flet  # noqa: F401
    HAS_FLET = True
except ImportError:
    HAS_FLET = False


@unittest.skipUnless(os.path.isfile(PANEL), "RITA panel not in this checkout")
class RitaPanelTest(unittest.TestCase):
    def test_no_forbidden_names(self):
        with open(PANEL, encoding="utf-8") as fh:
            self.assertIsNone(re.search(r"\bKH\b|Knowledge\s*Hub|stage\s+F\b", fh.read(), re.I))

    @unittest.skipUnless(HAS_FLET, "flet not installed")
    def test_import_and_offline_fetch(self):
        os.environ["LINE_URL"] = "http://127.0.0.1:9"     # nothing listens on the discard port
        try:
            spec = importlib.util.spec_from_file_location("line_board_panel", PANEL)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            self.assertTrue(callable(mod.show_line_board))
            self.assertIsNone(mod.fetch_board(timeout=0.5))
        finally:
            os.environ.pop("LINE_URL", None)


if __name__ == "__main__":
    unittest.main()
