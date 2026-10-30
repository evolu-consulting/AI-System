"""line.runtime.hide_child_consoles: a console-less Windows engine starts its children without a window."""

from __future__ import annotations

import os
import subprocess
import unittest

from line import runtime


@unittest.skipUnless(os.name == "nt", "Windows only")
class HideChildConsolesTest(unittest.TestCase):
    def setUp(self):
        self.seen = []
        saved = subprocess.Popen.__init__
        self.addCleanup(setattr, subprocess.Popen, "__init__", saved)
        self.addCleanup(lambda: subprocess.Popen.__dict__.get("_dlc_no_window") and delattr(subprocess.Popen,
                                                                                             "_dlc_no_window"))
        subprocess.Popen.__init__ = lambda _self, *a, **kw: self.seen.append(kw.get("creationflags", 0))

    def test_children_get_no_window_unless_they_ask_for_a_console(self):
        self.assertTrue(runtime.hide_child_consoles(has_console=False))
        self.assertFalse(runtime.hide_child_consoles(has_console=False))   # once
        subprocess.Popen(["git", "status"])
        subprocess.Popen(["git", "status"], creationflags=0x00000200)       # CREATE_NEW_PROCESS_GROUP kept
        subprocess.Popen(["cmd"], creationflags=runtime.CREATE_NEW_CONSOLE)
        subprocess.Popen(["x"], creationflags=runtime.DETACHED_PROCESS)
        self.assertEqual(self.seen, [runtime.CREATE_NO_WINDOW, runtime.CREATE_NO_WINDOW | 0x00000200,
                                     runtime.CREATE_NEW_CONSOLE, runtime.DETACHED_PROCESS])

    def test_with_a_console_nothing_changes(self):
        self.assertFalse(runtime.hide_child_consoles(has_console=True))
        subprocess.Popen(["git", "status"])
        self.assertEqual(self.seen, [0])


if __name__ == "__main__":
    unittest.main()
