"""Strong-model judge, decision log, later-run grading, rollback (line/review/judge.py)."""

from __future__ import annotations

import os
import unittest
from typing import Any, Dict
from unittest import mock

from line import codes, contracts
from line.contracts import E_ACC_TEST, E_UNIT, UnitState
from line.review import _common as C
from line.review import judge
from line.ship.qas_runner import FItemResult, QasReport
from line.tests import fakes
from line.tests.test_review_reviewer import QUOTE, RUN, World

GOOD = {"choice": "continue", "rationale": "the spec asks for exactly this",
        "quotes": [{"span_id": "spec.md#L3-4", "quote": QUOTE}], "instructions": ""}
CASE = {"signals": [{"name": "scope_words", "evidence": {"words": ["popup"]}}]}


def answer(**kw: Any) -> Dict[str, Any]:
    a = dict(GOOD)
    a.update(kw)
    return a


def report(**verdicts: str) -> QasReport:
    return QasReport(RUN, 3, [FItemResult(f, v, [v == "green"] * 3, failing=[] if v == "green" else ["T_%s_C1" % f])
                              for f, v in verdicts.items()])


class Base(unittest.TestCase):
    def world(self, **kw: Any) -> World:
        w = World(self, judge_enabled=True, **kw)
        self.log = judge.DecisionLog.for_ctx(w.ctx)
        return w


class DecideTest(Base):
    def test_valid_decision_is_recorded_pending(self):
        w = self.world()
        w.llm.script[("judge", "U1.drift.1")] = answer()
        d = judge.decide_drift(w.ctx, "U1", CASE)
        self.assertEqual((d["choice"], d["status"], d["quote_ok"]), ("continue", "pending", True))
        self.assertEqual(d["quotes"][0]["span_id"], "spec.md#L3-4")
        self.assertEqual(d["expect"], judge.EXPECT["continue"])
        self.assertEqual(d["spec_hash"], "PV1")
        self.assertEqual(self.log.backend, "store")        # E_DECISION is registered (contracts.W4_ENTITIES)
        self.assertEqual(self.log.get(d["id"])["case"], CASE)
        self.assertIn(C.KIND_JUDGE_DECISION, w.kinds())
        self.assertEqual(w.llm.calls[-1]["model"], "claude-opus-5-5")

    def test_rejections_become_stop(self):
        cases = [
            (answer(quotes=[{"quote": "a quote the spec never says"}]), "no_valid_quote"),
            (answer(choice="rewrite everything"), "not in"),
            (answer(choice="redirect", instructions="skip the tests for now"), "unsafe"),
            (answer(choice="redirect", instructions="edit tests/test_f1.py to expect 1"), "locked test"),
            (answer(choice="redirect", instructions="disable the verifier"), "unsafe"),
            (codes.LineError(codes.LLM_ERROR, "down"), "llm_error"),
        ]
        for i, (ans, why) in enumerate(cases):
            w = self.world()
            w.store.put(E_ACC_TEST, "T_F1_C1", {"id": "T_F1_C1", "path": "tests/test_f1.py", "locked": True,
                                                "run": RUN}, run=RUN)
            w.llm.script[("judge", "U1.drift.1")] = ans
            d = judge.decide_drift(w.ctx, "U1", CASE)
            self.assertEqual((d["choice"], d["status"]), ("stop", "rejected"), (i, d["reason"]))
            self.assertIn(why, d["reason"], i)

    def test_spec_gap_routes_to_spec_question(self):
        w = self.world()
        w.llm.script[("judge", "U1.drift.1")] = answer(spec_gap=True)
        d = judge.decide_drift(w.ctx, "U1", CASE)
        self.assertEqual((d["choice"], d["route"]), ("stop", "spec_question"))

    def test_max_decisions_stops_without_model_call(self):
        w = self.world(judge_max_decisions=2)
        w.llm.script["judge"] = answer()
        judge.decide_drift(w.ctx, "U1", CASE)
        judge.decide_drift(w.ctx, "U1", CASE)
        calls = len(w.llm.calls)
        d = judge.decide_drift(w.ctx, "U1", CASE)
        self.assertEqual(len(w.llm.calls), calls)
        self.assertEqual((d["choice"], d["reason"], d["id"]), ("stop", "max_decisions", "R1:U1:drift:3"))

    def test_history_of_graded_decisions_reaches_the_prompt(self):
        w = self.world()
        self.log.put({"id": "R0:U9:drift:1", "run": "R0", "unit": "U9", "kind": "drift", "status": "wrong",
                      "choice": "continue", "case": {"signals": [{"name": "scope_words"}]}, "model": "m",
                      "rationale": "FREE TEXT NOT FOR HISTORY", "ts_ms": 1})
        self.log.put({"id": "R0:U9:dispute:1", "run": "R0", "unit": "U9", "kind": "dispute", "status": "right",
                      "choice": "builder", "case": {}, "ts_ms": 2})
        w.llm.script[("judge", "U1.drift.1")] = answer()
        judge.decide_drift(w.ctx, "U1", CASE)
        prompt = w.llm.calls[-1]["prompt"]
        self.assertIn('"outcome": "wrong"', prompt)
        self.assertNotIn("FREE TEXT NOT FOR HISTORY", prompt)
        self.assertNotIn('"choice": "builder"', prompt)    # other kind

    def test_store_backend_when_entity_registered(self):
        w = World(self, judge_enabled=True)
        ents = contracts.ENTITIES | {C.E_DECISION}
        with mock.patch.object(contracts, "ENTITIES", ents), mock.patch.object(fakes, "ENTITIES", ents):
            log = judge.DecisionLog(w.store, "")
            self.assertEqual(log.backend, "store")
            log.put({"id": "x", "run": RUN, "kind": "drift", "ts_ms": 1})
            log.update("x", status="right")
            self.assertEqual(w.store.get(C.E_DECISION, "x")["status"], "right")
            self.assertEqual([r["id"] for r in log.query(status="right")], ["x"])


class GradeTest(Base):
    def decided(self, w: World, choice: str = "continue", unit_state: str = UnitState.MERGED.value) -> Dict[str, Any]:
        w.llm.script[("judge", "U1.drift.1")] = answer(choice=choice, instructions="print the id only")
        d = judge.decide_drift(w.ctx, "U1", CASE)
        row = w.unit()
        row["state"] = unit_state
        w.store.put(E_UNIT, "U1", row, run=RUN)
        return d

    def test_green_grades_right(self):
        w = self.world()
        d = self.decided(w)
        g = judge.on_qas_report(w.ctx, report(F1="green", F2="red"))
        self.assertEqual(g.right, [d["id"]])
        self.assertEqual(self.log.get(d["id"])["status"], "right")
        self.assertEqual(g.accuracy["accuracy"], 1.0)
        self.assertIn(C.KIND_DECISION_GRADED, w.kinds())

    def test_red_on_same_f_item_rolls_back_with_fixer_evidence(self):
        w = self.world()
        d = self.decided(w)
        rep = report(F1="red")
        g = judge.on_qas_report(w.ctx, rep)
        self.assertEqual(g.wrong, [d["id"]])
        rec = self.log.get(d["id"])
        self.assertEqual(rec["status"], "wrong")
        ev = g.fixer_evidence["F1"][0]
        self.assertEqual((ev["decision"], ev["failing"]), (d["id"], ["T_F1_C1"]))
        self.assertEqual(ev["quotes"][0]["quote"], QUOTE)
        self.assertEqual(rec["rollback"]["decision"], d["id"])
        self.assertEqual(g.accuracy["accuracy"], 0.0)
        # the fixer unit gets the evidence
        w.add_unit("FX-F1-g1", UnitState.READY.value)
        from line.ship.fixer import FixerOutcome
        done = judge.attach_fixer_evidence(w.ctx, [FixerOutcome("F1", unit=w.unit("FX-F1-g1"), generation=1)], g)
        self.assertEqual(done, ["FX-F1-g1"])
        self.assertEqual(w.unit("FX-F1-g1")["detail"]["judge_evidence"][0]["decision"], d["id"])

    def test_flaky_and_unmerged_stay_pending_stop_is_unattributable(self):
        w = self.world()
        d = self.decided(w)
        judge.on_qas_report(w.ctx, report(F1="flaky"))
        self.assertEqual(self.log.get(d["id"])["status"], "pending")
        row = w.unit()
        row["state"] = UnitState.VERIFIED.value
        w.store.put(E_UNIT, "U1", row, run=RUN)
        judge.on_qas_report(w.ctx, report(F1="green"))
        self.assertEqual(self.log.get(d["id"])["status"], "pending")
        w2 = self.world()
        d2 = self.decided(w2, choice="stop")
        judge.on_qas_report(w2.ctx, report(F1="green"))
        self.assertEqual(judge.DecisionLog.for_ctx(w2.ctx).get(d2["id"])["status"], "unattributable")

    def test_later_run_on_same_spec_grades_earlier_decision(self):
        w = self.world()
        d = self.decided(w)
        later = C.Ctx(w.store, w.cfg, w.llm, "R2", pv=w.pv, digest=w.digest, decisions=self.log)
        g = judge.on_qas_report(later, QasReport("R2", 3, [FItemResult("F1", "red", [False] * 3, failing=["t"])]))
        self.assertEqual(g.wrong, [d["id"]])
        self.assertEqual(self.log.get(d["id"])["graded_by_run"], "R2")

    def test_run_end_closes_pending(self):
        w = self.world()
        d = self.decided(w, unit_state=UnitState.FAILED.value)
        g = judge.on_run_end(w.ctx, "escalated")
        self.assertEqual(g.unattributable, [d["id"]])

    def test_disabled_hooks_are_noops(self):
        w = World(self)
        self.assertEqual(judge.on_qas_report(w.ctx, report(F1="red")).wrong, [])
        self.assertEqual(judge.on_run_end(w.ctx, "green").right, [])


class AccuracyTest(Base):
    def test_old_or_other_version_weighs_half(self):
        w = self.world()
        now = 10 * judge.OLD_MS
        self.log.put({"id": "a", "kind": "drift", "status": "right", "ts_ms": now, "judge_version": "v2"})
        self.log.put({"id": "b", "kind": "drift", "status": "wrong", "ts_ms": 1, "judge_version": "v2"})
        self.log.put({"id": "c", "kind": "dispute", "status": "pending", "ts_ms": now})
        acc = judge.accuracy(self.log, now_ms=now, version="v2")
        self.assertEqual((acc["graded"], acc["right"], acc["accuracy"]), (2, 1, 0.5))
        self.assertEqual(acc["weighted_accuracy"], round(1 / 1.5, 4))
        self.assertEqual(acc["by_kind"], {"drift": 0.5, "dispute": None})

    def test_unsafe_reason(self):
        self.assertEqual(judge.unsafe_reason("remove show_popup and print the id"), "")
        self.assertIn("unsafe", judge.unsafe_reason("add @unittest.skip to the slow case"))
        self.assertIn("unsafe", judge.unsafe_reason("put the password in config"))
        self.assertIn("locked", judge.unsafe_reason("change tests\\test_f1.py", ["tests/test_f1.py"]))


if __name__ == "__main__":
    unittest.main()
