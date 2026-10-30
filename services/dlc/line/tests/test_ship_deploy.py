"""Dev QAS deploy (block 16): blue/green export, smoke, pointer switch, windows, lock."""

from __future__ import annotations

import datetime as dt
import os
import shutil
import tempfile
import unittest

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import E_DEPLOY, E_RUN, Run
from line.ship.deploy import Deployer, in_windows, qas_lock, read_current
from line.tests.fakes import make_fakes
from line.tests.test_ship_merge import HAS_GIT, commit, make_repo, sh

SMOKE_OK = "import unittest\nclass S(unittest.TestCase):\n    def test_up(self):\n        import app\n        self.assertTrue(app.X)\n"
SMOKE_RED = "import unittest\nclass S(unittest.TestCase):\n    def test_up(self):\n        self.fail('down')\n"


def at(h: int, m: int = 0):
    return lambda: dt.datetime(2026, 10, 11, h, m)


class WindowTest(unittest.TestCase):
    def test_windows(self):
        self.assertTrue(in_windows([], dt.datetime(2026, 1, 1, 3, 0)))
        self.assertTrue(in_windows(["09:00-10:00"], dt.datetime(2026, 1, 1, 9, 30)))
        self.assertFalse(in_windows(["09:00-10:00"], dt.datetime(2026, 1, 1, 10, 0)))
        self.assertTrue(in_windows(["22:00-02:00"], dt.datetime(2026, 1, 1, 1, 0)))
        self.assertTrue(in_windows(["22:00-02:00"], dt.datetime(2026, 1, 1, 23, 0)))
        self.assertFalse(in_windows(["22:00-02:00"], dt.datetime(2026, 1, 1, 12, 0)))
        with self.assertRaises(LineError) as cm:
            in_windows(["9-10"], dt.datetime(2026, 1, 1, 9, 0))
        self.assertEqual(cm.exception.code, codes.CONFIG_INVALID)

    def test_lock_is_exclusive(self):
        root = tempfile.mkdtemp(prefix="line-lock-")
        try:
            with qas_lock(root, "a"):
                with self.assertRaises(LineError) as cm:
                    with qas_lock(root, "b"):
                        pass
                self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
            with qas_lock(root, "c"):     # released after use
                pass
        finally:
            shutil.rmtree(root, ignore_errors=True)


@unittest.skipUnless(HAS_GIT, "git not installed")
class DeployTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-dep-")
        self.repo = make_repo(self.tmp, {"app.py": "X = 1\n", "tests/__init__.py": "", "tests/test_smoke.py": SMOKE_OK})
        self.f = make_fakes()
        self.store = self.f.store
        self.store.put(E_RUN, "R1", Run("R1", "pack", state="qas", spec_hash="h1"), run="R1")
        self.qas = os.path.join(self.tmp, "qas")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def dep(self, windows=None, now=at(12)):
        cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=self.tmp,
                          deploy_windows=windows or [])
        return Deployer(self.store, self.repo, cfg, qas_root=self.qas, now_fn=now)

    def done_events(self):
        return self.store.events_after(0, kinds=[codes.DEPLOY_DONE])

    def test_green_deploy_switches_pointer_then_alternates_colors(self):
        d = self.dep()
        r1 = d.deploy("R1")
        self.assertTrue(r1.deployed, r1)
        self.assertEqual(r1.color, "blue")
        cur = read_current(self.qas)
        self.assertEqual((cur["color"], cur["sha"]), ("blue", sh(self.repo, "rev-parse", "main")))
        self.assertTrue(os.path.isfile(os.path.join(self.qas, "blue", "app.py")))
        self.assertFalse(os.path.exists(os.path.join(self.qas, ".lock")))
        self.assertEqual(d.deploy("R1").reason, "already_live")      # same (run, sha): no second deploy
        commit(self.repo, {"app.py": "X = 2\n"}, "v2")
        r2 = d.deploy("R1")
        self.assertEqual(r2.color, "green")
        self.assertEqual(read_current(self.qas)["color"], "green")
        self.assertEqual(self.store.get(E_DEPLOY, "R1:blue")["state"], "idle")
        self.assertEqual(self.store.get(E_DEPLOY, "R1:green")["state"], "live")
        evs = self.done_events()
        self.assertEqual(len(evs), 2)
        self.assertTrue(all(e.body["ok"] for e in evs))
        self.assertEqual(evs[0].env.spec_hash, "h1")

    def test_smoke_fail_keeps_old_color(self):
        d = self.dep()
        self.assertTrue(d.deploy("R1").deployed)
        blue_sha = read_current(self.qas)["sha"]
        commit(self.repo, {"tests/test_smoke.py": SMOKE_RED}, "break smoke")
        r = d.deploy("R1")
        self.assertFalse(r.deployed)
        self.assertEqual(r.reason, "smoke_fail")
        self.assertEqual(r.gate.code, codes.SMOKE_FAIL)
        self.assertEqual(r.color, "blue")
        cur = read_current(self.qas)
        self.assertEqual((cur["color"], cur["sha"]), ("blue", blue_sha))
        self.assertEqual(self.store.get(E_DEPLOY, "R1:green")["state"], "failed")
        last = self.done_events()[-1]
        self.assertFalse(last.body["ok"])
        self.assertEqual(last.body["code"], codes.SMOKE_FAIL)
        self.assertEqual(last.body["live"], "blue")

    def test_first_deploy_smoke_fail_leaves_no_pointer(self):
        commit(self.repo, {"tests/test_smoke.py": SMOKE_RED}, "break smoke")
        r = self.dep().deploy("R1")
        self.assertEqual(r.reason, "smoke_fail")
        self.assertIsNone(read_current(self.qas))

    def test_closed_window_blocks_unless_urgent_or_human(self):
        d = self.dep(windows=["09:00-10:00"], now=at(12))
        r = d.deploy("R1")
        self.assertFalse(r.deployed)
        self.assertEqual(r.reason, "window_closed")
        self.assertIsNone(read_current(self.qas))
        self.assertEqual(self.done_events(), [])
        self.assertTrue(d.deploy("R1", urgent=True).deployed)
        commit(self.repo, {"app.py": "X = 3\n"}, "v3")
        self.assertTrue(d.deploy("R1", human=True).deployed)
        self.assertTrue(self.done_events()[-1].body["human"])

    def test_open_window_deploys(self):
        self.assertTrue(self.dep(windows=["11:30-12:30"], now=at(12)).deploy("R1").deployed)

    def test_dev_waits_for_queue_drain(self):
        d = self.dep(windows=[])
        self.assertEqual(d.deploy("R1", queue_drained=False).reason, "queue_not_drained")
        self.assertTrue(d.deploy("R1", queue_drained=True).deployed)

    def test_custom_smoke_command(self):
        cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=self.tmp)
        d = Deployer(self.store, self.repo, cfg, qas_root=self.qas,
                     smoke_cmd=["python", "-c", "import sys; sys.exit(3)"])
        self.assertEqual(d.deploy("R1").reason, "smoke_fail")

    def test_busy_lock_refuses(self):
        d = self.dep()
        with qas_lock(self.qas, "qas-runner"):
            with self.assertRaises(LineError) as cm:
                d.deploy("R1")
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)


if __name__ == "__main__":
    unittest.main()
