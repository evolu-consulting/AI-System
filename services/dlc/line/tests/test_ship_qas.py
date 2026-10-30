"""QAS runner + fixer (block 17)."""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest

from line import codes
from line.config import load_config
from line.contracts import E_ACC_TEST, E_ESCALATION, E_QAS, E_RUN, E_UNIT, AccTest, Run, Unit
from line.ship.deploy import write_current
from line.ship.fixer import Fixer
from line.ship.qas_runner import FLAKY, GREEN, RED, REGRESSION, QasRunner, verdict
from line.tests.fakes import make_fakes


class Scripted:
    """Case runner answering repeat i from script[i] (test name -> bool)."""

    def __init__(self, script):
        self.script = script
        self.calls = []

    def __call__(self, workdir, names):
        self.calls.append(list(names))
        i = min(len([c for c in self.calls if c]) - 1, len(self.script) - 1)
        return {n: self.script[i].get(n, True) for n in names}


def setup_run(store):
    store.put(E_RUN, "R1", Run("R1", "pack", state="qas", spec_hash="h1"), run="R1")
    for fid in ("F1", "F2", "F3"):
        tid = "T_%s" % fid
        store.put(E_ACC_TEST, tid, AccTest(tid, fid, fid + ".C1", "spec.md#L1-1", "tests/test_%s.py" % fid.lower(),
                                           name="tests.test_%s.T.test_c1" % fid.lower()), run="R1")
    store.put(E_UNIT, "U1", Unit("U1", "R1", state="merged", wave=1, claims=["a.py"], f_items=["F1"], tests=["T_F1"]), run="R1")
    store.put(E_UNIT, "U2", Unit("U2", "R1", state="merged", wave=2, claims=["b.py", "c.py"], f_items=["F2"],
                                 tests=["T_F2"]), run="R1")
    store.put(E_UNIT, "U3", Unit("U3", "R1", state="merged", wave=2, claims=["c.py", "d.py"], f_items=["F2", "F3"],
                                 tests=["T_F3"]), run="R1")


class QasRunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-qas-")
        self.qas = os.path.join(self.tmp, "qas")
        os.makedirs(os.path.join(self.qas, "blue"))
        write_current(self.qas, {"color": "blue", "sha": "abc", "run": "R1", "ts_ms": 1})
        self.f = make_fakes()
        self.store = self.f.store
        setup_run(self.store)
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_verdict_rule(self):
        self.assertEqual(verdict([True] * 3), GREEN)
        self.assertEqual(verdict([False] * 3), RED)
        self.assertEqual(verdict([True, False, True]), FLAKY)

    def test_green_red_flaky(self):
        t1, t2, t3 = "tests.test_f1.T.test_c1", "tests.test_f2.T.test_c1", "tests.test_f3.T.test_c1"
        runner = Scripted([{t1: True, t2: False, t3: True},
                           {t1: True, t2: False, t3: False},
                           {t1: True, t2: False, t3: True}])
        rep = QasRunner(self.store, self.cfg, qas_root=self.qas, case_runner=runner, include_regression=False).run("R1")
        self.assertEqual(len(runner.calls), 3)
        v = {i.f_item: i for i in rep.items}
        self.assertEqual((v["F1"].verdict, v["F1"].runs), (GREEN, [True, True, True]))
        self.assertEqual((v["F2"].verdict, v["F2"].code, v["F2"].runs), (RED, codes.QAS_RED, [False] * 3))
        self.assertEqual(v["F2"].failing, [t2])
        self.assertEqual((v["F3"].verdict, v["F3"].code), (FLAKY, codes.FLAKY))
        self.assertEqual(v["F3"].runs, [True, False, True])
        self.assertEqual(v["F3"].quarantined, [t3])
        self.assertFalse(rep.all_green)
        self.assertEqual(rep.qas_dir, os.path.join(self.qas, "blue"))
        evs = self.store.events_after(0, kinds=[codes.QAS_RESULT])
        self.assertEqual(sorted(e.body["f_item"] for e in evs), ["F1", "F2", "F3"])
        self.assertEqual(self.store.get(E_QAS, "R1:F3")["verdict"], "flaky")
        self.assertEqual(self.store.get(E_QAS, "R1:F3")["quarantined"], [t3])
        self.assertFalse(os.path.exists(os.path.join(self.qas, ".lock")))

    def test_all_green(self):
        rep = QasRunner(self.store, self.cfg, qas_root=self.qas, case_runner=Scripted([{}]),
                        include_regression=False).run("R1")
        self.assertTrue(rep.all_green)
        self.assertEqual([i.verdict for i in rep.items], [GREEN] * 3)

    def test_real_runner_with_regression(self):
        live = os.path.join(self.qas, "blue")
        os.makedirs(os.path.join(live, "tests"))
        files = {
            "tests/__init__.py": "",
            "tests/test_f1.py": "import unittest\nclass T(unittest.TestCase):\n    def test_c1(self): pass\n",
            "tests/test_f2.py": "import unittest\nclass T(unittest.TestCase):\n    def test_c1(self): self.fail('x')\n",
            "tests/test_f3.py": "import unittest\nclass T(unittest.TestCase):\n    def test_c1(self): pass\n",
            "tests/test_old.py": "import unittest\nclass R(unittest.TestCase):\n    def test_keep(self): pass\n",
        }
        for rel, text in files.items():
            with open(os.path.join(live, rel), "w", encoding="utf-8") as fh:
                fh.write(text)
        rep = QasRunner(self.store, self.cfg, qas_root=self.qas).run("R1", repeats=2)
        v = {i.f_item: i.verdict for i in rep.items}
        self.assertEqual(v, {"F1": GREEN, "F2": RED, "F3": GREEN, REGRESSION: GREEN})
        reg = [i for i in rep.items if i.f_item == REGRESSION][0]
        self.assertEqual(list(reg.tests), ["tests.test_old.R.test_keep"])

    def test_missing_acceptance_test_is_red(self):
        os.makedirs(os.path.join(self.qas, "blue", "tests"), exist_ok=True)
        rep = QasRunner(self.store, self.cfg, qas_root=self.qas, include_regression=False).run("R1", repeats=1)
        self.assertEqual({i.verdict for i in rep.items}, {RED})


class FixerTest(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.store = self.f.store
        setup_run(self.store)
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, fixer_generations=2)
        self.fx = Fixer(self.store, self.cfg)
        self.red = {"f_item": "F2", "runs": [False] * 3, "failing": ["tests.test_f2.T.test_c1"], "quarantined": [],
                    "tests": {"tests.test_f2.T.test_c1": [False] * 3}}

    def test_red_f_item_spawns_fixer_then_escalates_at_cap(self):
        o1 = self.fx.on_red("R1", self.red, qas_dir="/q/blue")
        self.assertFalse(o1.escalated)
        u = o1.unit
        self.assertEqual(u["id"], "FX-F2-g1")
        self.assertEqual((u["state"], u["fixer_gen"], u["f_items"], u["wave"]), ("ready", 1, ["F2"], 3))
        self.assertEqual(u["claims"], ["b.py", "c.py", "d.py"])
        self.assertEqual(u["tests"], ["T_F2"])
        self.assertEqual(u["detail"]["evidence"]["failing"], ["tests.test_f2.T.test_c1"])
        self.assertEqual(sorted(u["detail"]["origin_units"]), ["U2", "U3"])
        ev = self.store.events_after(0, kinds=[codes.UNIT_STATE])[-1]
        self.assertEqual((ev.env.unit, ev.body["to"], ev.body["fixer_gen"]), ("FX-F2-g1", "ready", 1))

        # the g1 fixer merged but F2 is red again: generation 2
        o2 = self.fx.on_red("R1", self.red)
        self.assertEqual((o2.unit["id"], o2.unit["fixer_gen"]), ("FX-F2-g2", 2))
        self.assertEqual(self.store.get(E_UNIT, "FX-F2-g2")["wave"], 4)

        o3 = self.fx.on_red("R1", self.red)
        self.assertTrue(o3.escalated)
        self.assertEqual(o3.generation, 2)
        self.assertIsNone(self.store.get(E_UNIT, "FX-F2-g3"))
        esc = self.store.get(E_ESCALATION, "R1:F2:fixer")
        self.assertEqual(esc["code"], codes.QAS_RED)
        ev = self.store.events_after(0, kinds=[codes.ESCALATED])
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0].body["f_item"], "F2")

    def test_handle_report_only_red(self):
        from line.ship.qas_runner import FItemResult, QasReport
        rep = QasReport("R1", 3, [FItemResult("F1", GREEN, [True] * 3), FItemResult("F3", FLAKY, [True, False, True]),
                                  FItemResult("F2", RED, [False] * 3, codes.QAS_RED)])
        out = self.fx.handle("R1", rep)
        self.assertEqual([o.f_item for o in out], ["F2"])
        self.assertEqual(out[0].unit["id"], "FX-F2-g1")

    def test_red_without_implementing_unit_escalates(self):
        o = self.fx.on_red("R1", {"f_item": REGRESSION, "runs": [False] * 3})
        self.assertTrue(o.escalated)


if __name__ == "__main__":
    unittest.main()
