"""Learning loop: offline eval / holdout gate with a judge model, canary, promote / withdraw (block 18)."""

from __future__ import annotations

import json
import os
import tempfile
import types
import unittest
from unittest import mock

from line import codes
from line.contracts import E_ATTEMPT, E_RUN, E_UNIT, Attempt, Run, Unit, to_dict
from line.learn import LEARN_KINDS, LESSON_CANARY, LESSON_JUDGED, LESSON_PROMOTED, LESSON_WITHDRAWN
from line.learn.evalgate import (arm, arm_stats, bounds, decide, expire, holdout_cases, judge, publish,
                                 record_outcome)
from line.learn.lstore import LearnStore
from line.tests.fakes import FakeLlm, make_fakes

LID = "L-test"


def cfg(**kw):
    base = dict(model="m-main", model_alt="m-alt", agent_version="line-t", workroot="", learn_enabled=True,
                learn_min_sample=30, learn_harm_min_sample=10, learn_max_sample=120, learn_margin=0.05,
                learn_canary_ratio=0.2, learn_holdback_ratio=0.1, learn_eval_path="")
    base.update(kw)
    return types.SimpleNamespace(**base)


def lesson(ls, status="candidate", **kw):
    le = {"key": {"role": "builder", "step": "build", "stack": "python"}, "fingerprint": "fp-1",
          "code": codes.TEST_FAIL, "symptom": "A stored item has no id after reload",
          "cause": "ids are not written", "fix": "Persist the id field with every item.",
          "text": "A stored item has no id after reload -> Persist the id field with every item.",
          "evidence": ["R1:3"], "provenance": {"source_run": "R1", "runs": ["R1"]}, "status": status,
          "version": 1, "created_ms": 1000}
    le.update(kw)
    return ls.put("lesson", LID, le)


def past_run(store, run, outcome="failed", code=codes.TEST_FAIL, fp="fp-1", n=1, fixer=0):
    store.put(E_RUN, run, Run(run, "p", state="green"), run=run)
    store.put(E_UNIT, "%s:U1" % run, Unit("U1", run, title="store", state="merged", fixer_gen=fixer), run=run)
    a = to_dict(Attempt("U1", n, outcome=outcome, code=code if outcome == "failed" else "", fingerprint=fp,
                        detail={"evidence": "KeyError id"}))
    a["run"] = run
    store.put(E_ATTEMPT, "%s:U1#%d" % (run, n), a, run=run)


class HoldoutTests(unittest.TestCase):
    def test_excludes_source_run_and_splits_relevant_and_controls(self):
        f = make_fakes()
        ls = LearnStore("")
        le = lesson(ls)
        past_run(f.store, "R1")                     # the lesson's own run: never a holdout case
        past_run(f.store, "R2")                     # relevant: same code
        past_run(f.store, "R3", outcome="verified")  # control: first attempt passed
        past_run(f.store, "R4", fixer=1)            # a fixer unit: other role
        cases = holdout_cases(f.store, le)
        self.assertEqual([(c["case"], c["kind"]) for c in cases], [("R2:U1#1", "relevant"), ("R3:U1#1", "control")])
        self.assertIn("KeyError", cases[0]["input"])

    def test_non_build_keys_have_no_holdout(self):
        f = make_fakes()
        ls = LearnStore("")
        le = lesson(ls, key={"role": "planner", "step": "plan", "stack": "python"})
        past_run(f.store, "R2")
        self.assertEqual(holdout_cases(f.store, le), [])


class JudgeTests(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.ls = LearnStore("")
        past_run(self.f.store, "R2")
        past_run(self.f.store, "R3", outcome="verified")

    def _judge(self, answer, c=None):
        llm = FakeLlm({("eval_judge", LID): [answer]})
        lesson(self.ls)
        with mock.patch.object(codes, "EVENT_KINDS", codes.EVENT_KINDS | set(LEARN_KINDS)):
            self.f.store.put(E_RUN, "R1", Run("R1", "p", state="green"), run="R1")
            d = judge(self.f.store, llm, self.ls, LID, c or cfg())
        return d, llm

    def test_approve_goes_to_canary_and_judge_is_not_the_distiller_model(self):
        d, llm = self._judge({"verdict": "approve", "safety_ok": True, "reason": "ok",
                              "cases": [{"case": "R2:U1#1", "effect": "helps"},
                                        {"case": "R3:U1#1", "effect": "neutral"}]})
        self.assertEqual(d["verdict"], "approve", d)
        self.assertEqual(llm.calls[0]["model"], "m-main")
        self.assertIn("R2:U1#1", llm.calls[0]["prompt"])
        self.assertNotIn("R1:", llm.calls[0]["prompt"])
        le = self.ls.get("lesson", LID)
        self.assertEqual(le["status"], "canary")
        self.assertEqual(le["canary"]["ratio"], 0.2)
        hist = self.ls.query("judge", lesson=LID)
        self.assertEqual(len(hist), 1)
        self.assertEqual((hist[0]["helps"], hist[0]["harm"], hist[0]["relevant"]), (1, 0, 1))
        kinds = [e.kind for e in self.f.store.events_after(0, run="R1")]
        self.assertEqual(kinds, [LESSON_JUDGED, LESSON_CANARY])

    def test_rejections(self):
        for answer, why in [
            ({"verdict": "reject", "safety_ok": True, "cases": [{"case": "R2:U1#1", "effect": "neutral"}]},
             "judge rejected"),
            ({"verdict": "approve", "safety_ok": False, "cases": [{"case": "R2:U1#1", "effect": "helps"}]},
             "safety"),
            ({"verdict": "approve", "safety_ok": True, "cases": [{"case": "R2:U1#1", "effect": "helps"},
                                                                 {"case": "R3:U1#1", "effect": "harm"}]}, "harm"),
            ({"verdict": "approve", "safety_ok": True, "cases": [{"case": "R9:U1#1", "effect": "helps"}]},
             "cited no known case"),
            ({"verdict": "approve", "safety_ok": True, "cases": [{"case": "R2:U1#1", "effect": "neutral"}]},
             "helps 0 of 1"),
        ]:
            self.ls = LearnStore("")
            d, _ = self._judge(answer)
            self.assertEqual(d["verdict"], "reject", answer)
            self.assertIn(why, d["reason"])
            self.assertEqual(self.ls.get("lesson", LID)["status"], "rejected")

    def test_lint_and_leaked_eval_set_reject_without_a_model_call(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "eval.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"canary": "zq-canary-77", "cases": [{"id": "E1", "role": "builder", "step": "build",
                                                            "input": "x", "expected": "y"}]}, fh)
        llm = FakeLlm({})
        lesson(self.ls, fix="Write zq-canary-77 into the file.")
        res = judge(self.f.store, llm, self.ls, LID, cfg(learn_eval_path=path))
        self.assertEqual(res["verdict"], "reject")
        self.assertIn("leaked", res["reason"])
        self.assertEqual(llm.calls, [])
        self.ls = LearnStore("")
        lesson(self.ls, fix="Keep the verifier quiet.")
        self.assertIn("lint", judge(self.f.store, llm, self.ls, LID, cfg())["reason"])

    def test_eval_set_cases_reach_the_judge(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "eval.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"canary": "zq", "cases": [{"id": "E1", "role": "builder", "step": "build",
                                                  "input": "save then load", "expected": "same ids"},
                                                 {"id": "E2", "role": "planner", "input": "n/a"}]}, fh)
        d, llm = self._judge({"verdict": "approve", "safety_ok": True,
                              "cases": [{"case": "R2:U1#1", "effect": "helps"}, {"case": "eval:E1", "effect": "helps"}]},
                             cfg(learn_eval_path=path))
        self.assertEqual(d["verdict"], "approve")
        self.assertIn("eval:E1", llm.calls[0]["prompt"])
        self.assertNotIn("eval:E2", llm.calls[0]["prompt"])
        self.assertEqual(d["relevant"], 2)

    def test_cold_start_approval_is_flagged(self):
        f = make_fakes()
        ls = LearnStore("")
        lesson(ls)
        llm = FakeLlm({("eval_judge", LID): [{"verdict": "approve", "safety_ok": True, "cases": []}]})
        d = judge(f.store, llm, ls, LID, cfg())
        self.assertEqual(d["verdict"], "approve")
        self.assertTrue(d["cold_start"])

    def test_judge_error_keeps_candidate(self):
        lesson(self.ls)
        d = judge(self.f.store, FakeLlm({}), self.ls, LID, cfg())
        self.assertEqual(d["verdict"], "error")
        self.assertEqual(self.ls.get("lesson", LID)["status"], "candidate")


class CanaryTests(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.ls = LearnStore("")
        self.f.store.put(E_RUN, "R1", Run("R1", "p", state="green"), run="R1")

    def _fill(self, treat_ok, treat_n, control_ok, control_n):
        t = c = 0
        i = 0
        while t < treat_n or c < control_n:
            unit = "U%d" % i
            i += 1
            side = arm(self.ls, self.ls.get("lesson", LID), "R1", unit, cfg())
            if side == "treat" and t < treat_n:
                record_outcome(self.ls, LID, "R1", unit, t < treat_ok)
                t += 1
            elif side == "control" and c < control_n:
                record_outcome(self.ls, LID, "R1", unit, c < control_ok)
                c += 1

    def test_arms_are_stable_and_follow_the_ratio(self):
        le = lesson(self.ls, status="canary")
        sides = [arm(self.ls, le, "R1", "U%d" % i, cfg()) for i in range(1000)]
        share = sides.count("treat") / 1000.0
        self.assertTrue(0.15 < share < 0.25, share)
        self.assertEqual(arm(self.ls, le, "R1", "U7", cfg()), sides[7])
        self.assertEqual(arm(self.ls, lesson(self.ls, status="candidate"), "R1", "U1", cfg()), "")
        self.assertIsNone(record_outcome(self.ls, LID, "R9", "U1", True))   # no arm, no outcome

    def test_promote_when_non_inferior_with_enough_sample(self):
        lesson(self.ls, status="canary")
        self._fill(29, 30, 24, 30)
        with mock.patch.object(codes, "EVENT_KINDS", codes.EVENT_KINDS | set(LEARN_KINDS)):
            d = decide(self.f.store, self.ls, LID, cfg(), run="R1", rag=self.f.rag)
        self.assertEqual(d["action"], "promote", d)
        self.assertEqual(self.ls.get("lesson", LID)["status"], "active")
        self.assertEqual(self.f.rag.records[("lesson", LID)][0]["status"], "active")
        self.assertEqual([e.kind for e in self.f.store.events_after(0, run="R1")], [LESSON_PROMOTED])

    def test_keep_below_min_sample(self):
        lesson(self.ls, status="canary")
        self._fill(20, 20, 10, 20)
        self.assertEqual(decide(self.f.store, self.ls, LID, cfg())["action"], "keep")

    def test_rollback_on_harm_before_min_sample(self):
        lesson(self.ls, status="canary")
        self._fill(2, 12, 11, 12)
        with mock.patch.object(codes, "EVENT_KINDS", codes.EVENT_KINDS | set(LEARN_KINDS)):
            d = decide(self.f.store, self.ls, LID, cfg(), run="R1")
        self.assertEqual((d["action"], d["reason"]), ("withdraw", "harm"))
        self.assertEqual(self.ls.get("lesson", LID)["status"], "withdrawn")
        evs = self.f.store.events_after(0, run="R1", kinds=[LESSON_WITHDRAWN])
        self.assertEqual(evs[0].body["reason"], "harm")

    def test_not_promoted_when_worse_than_control(self):
        lesson(self.ls, status="canary")
        self._fill(28, 30, 29, 30)      # non-inferior within the margin, but below control
        self.assertEqual(decide(self.f.store, self.ls, LID, cfg())["action"], "keep")

    def test_inconclusive_at_max_sample(self):
        lesson(self.ls, status="canary")
        self._fill(20, 40, 24, 40)
        d = decide(self.f.store, self.ls, LID, cfg(learn_max_sample=40))
        self.assertEqual((d["action"], d.get("reason")), ("withdraw", "inconclusive"))

    def test_active_lesson_keeps_a_holdback_and_rolls_back_on_harm(self):
        le = lesson(self.ls, status="active")
        sides = [arm(self.ls, le, "R2", "U%d" % i, cfg()) for i in range(1000)]
        self.assertTrue(0.05 < sides.count("control") / 1000.0 < 0.15)
        self.ls = LearnStore("")
        lesson(self.ls, status="active")
        self._fill(3, 15, 14, 15)
        self.assertEqual(decide(self.f.store, self.ls, LID, cfg())["action"], "withdraw")

    def test_bounds(self):
        st = {"treat": {"n": 0, "ok": 0, "rate": 0.0}, "control": {"n": 0, "ok": 0, "rate": 0.0}}
        self.assertEqual(bounds(st), (0.0, -1.0, 1.0))
        lesson(self.ls, status="canary")
        self._fill(10, 10, 10, 10)
        diff, lo, hi = bounds(arm_stats(self.ls, LID))
        self.assertEqual(diff, 0.0)
        self.assertLess(lo, 0.0)
        self.assertGreater(hi, 0.0)

    def test_ttl_expiry_and_publish_degrades(self):
        lesson(self.ls, status="active", proven_ms=0)
        self.f.rag.down = True
        self.assertFalse(publish(self.f.rag, self.ls.get("lesson", LID)))
        out = expire(self.f.store, self.ls, cfg(learn_ttl_days=1), rag=self.f.rag, clock_ms=2 * 86_400_000)
        self.assertEqual(out, [LID])
        self.assertEqual(self.ls.get("lesson", LID)["status"], "expired")
        self.assertFalse(publish(None, {"id": "x"}))


if __name__ == "__main__":
    unittest.main()
