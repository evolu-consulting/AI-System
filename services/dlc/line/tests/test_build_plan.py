"""S5 plan side: graph validation, waves, critical path, planner retry, scheduler order."""

from __future__ import annotations

import unittest

from line import codes
from line.build import graph as G
from line.build import planner, scheduler
from line.codes import LineError
from line.config import load_config
from line.contracts import (
    E_GRAPH, E_UNIT, AccTest, Criterion, Digest, FItem, Unit, UnitState, to_dict,
)
from line.tests.fakes import make_fakes


def U(id, deps=(), claims=None, size="M", contract=False, f_items=(), tests=(), state="pending", **kw):
    return Unit(id=id, run="R1", deps=list(deps), claims=list(claims if claims is not None else [id.lower() + ".py"]),
                size=size, contract=contract, f_items=list(f_items), tests=list(tests), state=state, **kw)


def cfg(**kw):
    return load_config(env={}, line_json=None, rag_local_json=None, **kw)


def digest():
    return Digest(pack_version="v1", variant="R", f_items=[
        FItem("F1", "add and list", criteria=[Criterion("F1.C1", "F1", "add stores", "s#L1-2", "q")]),
        FItem("F2", "done and remove", criteria=[Criterion("F2.C1", "F2", "unknown id exit 1", "s#L3-4", "q")]),
    ])


def acc_tests():
    return [AccTest("T_F1_C1", "F1", "F1.C1", "s#L1-2", "tests/test_f1.py", "tests.test_f1.T.test_c1"),
            AccTest("T_F2_C1", "F2", "F2.C1", "s#L3-4", "tests/test_f2.py", "tests.test_f2.T.test_c1")]


GOOD_PLAN = {"units": [
    {"id": "U1", "title": "storage contract", "f_items": [], "claims": ["todo/contract.py"], "deps": [],
     "tests": [], "size": "S", "contract": True},
    {"id": "U2", "title": "add/list", "f_items": ["F1"], "claims": ["todo/add.py"], "deps": [],
     "tests": ["T_F1_C1"], "size": "M"},
    {"id": "U3", "title": "done/remove", "f_items": ["F2"], "claims": ["todo/done.py"], "deps": [],
     "tests": ["T_F2_C1"], "size": "L"},
    {"id": "U4", "title": "cli wiring", "f_items": ["F2"], "claims": ["todo/cli.py"], "deps": ["U3"],
     "tests": [], "size": "S"},
]}


class ValidateTest(unittest.TestCase):
    def test_valid_graph(self):
        units = planner.parse_units(GOOD_PLAN, "R1")
        self.assertEqual(G.validate(units, f_items=["F1", "F2"], tests=acc_tests()), [])

    def test_cycle_rejected(self):
        units = [U("U1", ["U2"], f_items=["F1"], tests=["t1"]), U("U2", ["U1"])]
        self.assertIn(codes.GRAPH_CYCLE, G.validate(units))
        self.assertTrue(any("cycle" in v["message"] for v in G.violations(units)))
        with self.assertRaises(ValueError):
            G.waves(units)

    def test_unknown_dep_and_duplicate_rejected(self):
        self.assertEqual(G.validate([U("U1", ["U9"])]), [codes.GRAPH_CYCLE])
        self.assertEqual(G.validate([U("U1"), U("U1", claims=["x.py"])]), [codes.GRAPH_CYCLE])

    def test_oversize_rejected(self):
        big = U("U1", claims=["f%d.py" % i for i in range(9)])
        self.assertEqual(G.validate([big]), [codes.UNIT_TOO_BIG])
        self.assertEqual(G.validate([U("U1", claims=["f%d.py" % i for i in range(8)])]), [])
        self.assertEqual(G.validate([big], max_files=9), [])
        self.assertEqual(G.validate([U("U1", size="XL")]), [codes.UNIT_TOO_BIG])

    def test_fitem_without_tests_rejected(self):
        units = [U("U1", f_items=["F1"], tests=[])]
        self.assertEqual(G.validate(units), [codes.TEST_UNTRACED])
        # known tests: a test of another F-item does not cover F1
        units = [U("U1", f_items=["F1"], tests=["T_F2_C1"]), U("U2", f_items=["F2"], claims=["b.py"])]
        self.assertIn(codes.TEST_UNTRACED, G.validate(units, tests=acc_tests()))
        # an F-item of the digest with no unit, and a test with no owner
        ok = [U("U1", f_items=["F1"], tests=["T_F1_C1"])]
        msgs = [v["message"] for v in G.violations(ok, f_items=["F1", "F2"], tests=acc_tests())]
        self.assertTrue(any("F2 has no unit" in m for m in msgs), msgs)
        self.assertTrue(any("T_F2_C1 has no unit" in m for m in msgs), msgs)

    def test_contract_must_come_first(self):
        units = [U("U1"), U("U2", ["U1"], contract=True)]
        self.assertEqual(G.validate(units), [codes.GRAPH_CYCLE])
        # a contract that a non-contract must wait for is fine; contracts take wave 1
        units = [U("U1"), U("U2", contract=True)]
        self.assertEqual(G.validate(units), [])
        self.assertEqual(G.waves(units), [["U2"], ["U1"]])

    def test_overlapping_claims_need_dependency(self):
        units = [U("U1", claims=["svc/*.py"]), U("U2", claims=["svc/api.py"])]
        self.assertEqual(G.validate(units), [codes.CLAIM_VIOLATION])
        units[1].deps = ["U1"]
        self.assertEqual(G.validate(units), [])


class WavesAndPathTest(unittest.TestCase):
    def test_waves_and_critical_path(self):
        g = G.finish(planner_graph())
        self.assertEqual(g.waves, [["U1"], ["U2", "U3"], ["U4"]])
        self.assertEqual({u.id: u.wave for u in g.units}, {"U1": 1, "U2": 2, "U3": 2, "U4": 3})
        # weights S1 M2 L4: U1(1)+U3(4)+U4(1) = 6 beats U1+U2 = 3
        self.assertEqual(g.critical_path, ["U1", "U3", "U4"])

    def test_critical_path_weighted_by_size(self):
        units = [U("A", size="L"), U("B", size="S"), U("C", ["B"], size="S", claims=["c.py"])]
        self.assertEqual(G.critical_path(units), ["A"])          # 4 > 1 + 1
        units[0].size = "S"
        self.assertEqual(G.critical_path(units), ["B", "C"])


def planner_graph():
    from line.contracts import Graph
    return Graph("R1", planner.parse_units(GOOD_PLAN, "R1"))


class PlannerTest(unittest.TestCase):
    def test_plan_stores_graph_and_emits_valid(self):
        f = make_fakes(llm_script={("planner", "plan"): GOOD_PLAN})
        g = planner.plan(digest(), acc_tests(), "", f.llm, f.store, run="R1", cfg=cfg())
        self.assertEqual(g.critical_path, ["U1", "U3", "U4"])
        ev = f.store.events_after(0, kinds=[codes.GRAPH_VALID])
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0].body["waves"], [["U1"], ["U2", "U3"], ["U4"]])
        self.assertEqual(ev[0].env.spec_hash, "v1")
        self.assertEqual(f.store.get(E_GRAPH, "R1")["critical_path"], ["U1", "U3", "U4"])
        rows = f.store.query(E_UNIT, run="R1")
        self.assertEqual([r["state"] for r in rows], ["pending"] * 4)
        self.assertEqual(f.store.get(E_UNIT, "U4")["wave"], 3)
        prompt = f.llm.calls[0]["prompt"]
        self.assertIn("T_F2_C1", prompt)
        self.assertIn("at most 8", prompt)

    def test_plan_retries_once_with_violations(self):
        bad = {"units": [dict(GOOD_PLAN["units"][1], tests=[]), *GOOD_PLAN["units"][2:3],
                         dict(GOOD_PLAN["units"][3])]}
        f = make_fakes(llm_script={("planner", "plan"): bad, ("planner", "plan-retry"): GOOD_PLAN})
        g = planner.plan(digest(), acc_tests(), "", f.llm, f.store, run="R1", cfg=cfg())
        self.assertEqual(len(g.units), 4)
        self.assertEqual([c["key"] for c in f.llm.calls], ["plan", "plan-retry"])
        self.assertIn("TEST_UNTRACED", f.llm.calls[1]["prompt"])

    def test_plan_invalid_twice_raises(self):
        cyc = {"units": [dict(GOOD_PLAN["units"][1], deps=["U3"]), dict(GOOD_PLAN["units"][2], deps=["U2"])]}
        f = make_fakes(llm_script={"planner": cyc})
        with self.assertRaises(LineError) as cm:
            planner.plan(digest(), acc_tests(), "", f.llm, f.store, run="R1", cfg=cfg())
        self.assertEqual(cm.exception.code, codes.GRAPH_CYCLE)
        self.assertTrue(cm.exception.detail["violations"])
        self.assertEqual(f.store.events_after(0, kinds=[codes.GRAPH_VALID]), [])


class SchedulerTest(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.cfg = cfg()
        units = [
            U("U1", size="S", contract=True, state="merged"),
            U("U2", size="S", state="ready", detail={"ready_ms": 300}),       # unlocks U4
            U("U3", size="L", state="ready", detail={"ready_ms": 500}),       # critical path
            U("U4", ["U2"], size="S", state="pending"),
            U("U5", size="S", state="ready", detail={"ready_ms": 200}),
            U("U6", size="S", state="ready", detail={"ready_ms": 100}),       # waited longest
        ]
        for u in units:
            self.f.store.put(E_UNIT, u.id, to_dict(u), run="R1")
        g = G.finish(planner_graph().__class__("R1", units))
        self.f.store.put(E_GRAPH, "R1", to_dict(g), run="R1")
        self.assertEqual(g.critical_path, ["U1", "U3"])

    def test_order_critical_then_unlocks_then_wait(self):
        got = [u.id for u in scheduler.next_ready("R1", self.f.store, self.cfg, limit=10)]
        self.assertEqual(got, ["U3", "U2", "U6", "U5"])

    def test_capacity_respects_leased(self):
        self.f.store.transition(E_UNIT, "U6", UnitState.LEASED, UnitState.READY)
        got = [u.id for u in scheduler.next_ready("R1", self.f.store, self.cfg)]
        self.assertEqual(got, ["U3", "U2"])          # max_parallel_units 3, one leased

    def test_promote_when_deps_merged(self):
        self.assertEqual(scheduler.promote("R1", self.f.store, self.cfg), [])
        row = self.f.store.get(E_UNIT, "U2")
        row["state"] = "merged"
        self.f.store.put(E_UNIT, "U2", row, run="R1")
        self.assertEqual(scheduler.promote("R1", self.f.store, self.cfg), ["U4"])
        self.assertEqual(self.f.store.get(E_UNIT, "U4")["state"], "ready")
        ev = self.f.store.events_after(0, kinds=[codes.UNIT_STATE])
        self.assertEqual(ev[-1].body, {"from": "pending", "to": "ready"})

    def test_non_contract_waits_for_contracts(self):
        f = make_fakes()
        for u in (U("C1", contract=True, state="ready"), U("A", state="pending")):
            f.store.put(E_UNIT, u.id, to_dict(u), run="R2")
        self.assertEqual([u.id for u in scheduler.next_ready("R2", f.store, self.cfg, limit=5)], ["C1"])


if __name__ == "__main__":
    unittest.main()
