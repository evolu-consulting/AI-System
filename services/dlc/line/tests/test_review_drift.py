"""Drift signals + handling ladder (line/review/drift.py)."""

from __future__ import annotations

import unittest
from typing import Any, Dict

from line.contracts import E_ATTEMPT, E_ESCALATION, E_UNIT, Gate, UnitState
from line.review import _common as C
from line.review import drift
from line.tests.test_review_reviewer import PATCH, QUOTE, RUN, World

OUTSIDE_PATCH = PATCH + """diff --git a/app/extra.py b/app/extra.py
new file mode 100644
--- /dev/null
+++ b/app/extra.py
@@ -0,0 +1,1 @@
+X = 1
"""


def metrics(**kw: Any) -> Dict[str, Any]:
    m = {"n": 1, "files": 1, "outside": [], "diff_lines": 10, "passed": 0, "total": 2, "ok": False, "code": "",
         "fingerprint": "", "failing": [], "usd": 0.0, "submitted": False, "tests_edited": [], "added_text": ""}
    m.update(kw)
    return m


def fail_gate(fp: str = "fp1") -> Gate:
    return Gate(False, "TEST_FAIL", fp, {"passed": 0, "failures": [{"test": "tests.test_f1.T.test_c1"}]})


class SignalsTest(unittest.TestCase):
    def names(self, cur, prev=(), spec="") -> list:
        return sorted(s.name for s in drift.signals(cur, list(prev), spec))

    def test_quiet_attempt(self):
        self.assertEqual(self.names(metrics(passed=2, ok=True, submitted=True)), [])

    def test_outside_claims_trend(self):
        self.assertEqual(self.names(metrics(outside=["a.py"])), ["outside_claims"])
        s = drift.signals(metrics(outside=["a.py", "b.py"]), [metrics(outside=["a.py"])], "")
        self.assertEqual([(x.name, x.weight) for x in s], [("outside_claims", 2)])
        self.assertEqual(self.names(metrics(outside=["a.py"]), [metrics(outside=["a.py", "b.py"])]), [])

    def test_tests_flat_while_diff_grows(self):
        prev = [metrics(passed=1, diff_lines=20)]
        self.assertEqual(self.names(metrics(passed=1, diff_lines=80), prev), ["tests_flat"])
        self.assertEqual(self.names(metrics(passed=1, diff_lines=22), prev), [])
        self.assertEqual(self.names(metrics(passed=2, diff_lines=80), prev), [])

    def test_repeat_failure_by_fingerprint_or_tests(self):
        prev = [metrics(code="TEST_FAIL", fingerprint="x", failing=["t1"])]
        self.assertIn("repeat_failure", self.names(metrics(code="TEST_FAIL", fingerprint="x"), prev))
        self.assertIn("repeat_failure", self.names(metrics(code="TEST_FAIL", fingerprint="y", failing=["t1"]), prev))
        self.assertNotIn("repeat_failure", self.names(metrics(code="TEST_FAIL", fingerprint="y", failing=["t2"]), prev))

    def test_cost_rising(self):
        prev = [metrics(usd=0.1), metrics(usd=0.12)]
        self.assertIn("cost_rising", self.names(metrics(usd=0.2), prev))
        self.assertNotIn("cost_rising", self.names(metrics(usd=0.13), prev))

    def test_done_without_test_delta(self):
        self.assertEqual(self.names(metrics(submitted=True, passed=0)), ["done_no_delta"])
        self.assertEqual(self.names(metrics(submitted=True, passed=1), [metrics(passed=1)]), ["done_no_delta"])
        self.assertEqual(self.names(metrics(submitted=True, passed=2), [metrics(passed=1)]), [])

    def test_scope_words_not_in_spec(self):
        code = 'show_popup("Saved!")\nsend_email(user)'
        self.assertEqual(drift.scope_words(code, "The add command stores a todo."), ["popup", "email"])
        self.assertEqual(drift.scope_words(code, "On save a popup confirms it; an e-mail is sent."), ["email"])
        self.assertEqual(drift.scope_words("def add(title): pass", "spec"), [])

    def test_scope_words_ignore_import_statements(self):
        # regression (real run): every Python diff raised scope_words ["import"] from its import lines
        code = "import json\nfrom todo.store import Store\n    import os\nm = __import__('x')\n"
        self.assertEqual(drift.scope_words(code, "The add command stores a todo."), [])
        self.assertEqual(drift.scope_words(code + "def import_csv(path): pass\n", "spec"), ["import"])

    def test_test_files_edited(self):
        self.assertEqual(self.names(metrics(tests_edited=["tests/test_f2.py"])), ["test_files_edited"])

    def test_next_level_never_jumps_over_judge(self):
        self.assertEqual(drift.next_level(0, 0, 2), 0)
        self.assertEqual(drift.next_level(0, 1, 2), drift.NOTE)
        self.assertEqual(drift.next_level(2, 1, 2), 2)
        self.assertEqual(drift.next_level(1, 2, 2), drift.NUDGE)
        self.assertEqual(drift.next_level(1, 4, 2), drift.REVIEWER)
        self.assertEqual(drift.next_level(3, 9, 2), drift.JUDGE)
        self.assertEqual(drift.next_level(4, 2, 2), drift.STOP)


class LadderTest(unittest.TestCase):
    def world(self, **kw: Any) -> World:
        w = World(self, drift_enabled=True, drift_threshold=2, **kw)
        w.store.transition(E_UNIT, "U1", UnitState.READY, UnitState.VERIFIED)   # verify failed -> ready
        return w

    def test_disabled_is_noop(self):
        w = World(self)
        out = drift.on_attempt(w.ctx, "U1", 1, fail_gate(), diff={"paths": [], "patch": ""})
        self.assertEqual(out.action, "skip")
        self.assertNotIn("drift", w.unit()["detail"])

    def test_ladder_note_reviewer_then_stop_without_judge(self):
        w = self.world()
        d = {"paths": ["app/todo.py", "app/extra.py"], "patch": OUTSIDE_PATCH}
        # popup is not in the spec (+2), extra.py outside claims (+1), done without delta (+1) -> +2 levels
        out1 = drift.on_attempt(w.ctx, "U1", 1, fail_gate(), diff=d, builder_outcome="SUBMIT", usd=0.1)
        self.assertEqual(sorted(s.name for s in out1.signals), ["done_no_delta", "outside_claims", "scope_words"])
        self.assertEqual((out1.level, out1.action), (drift.NUDGE, "nudge"))
        self.assertIn("popup", out1.nudge)
        self.assertIn("app/extra.py", drift.nudge_for(w.store, "U1"))
        out2 = drift.on_attempt(w.ctx, "U1", 2, fail_gate(), diff=d, builder_outcome="SUBMIT", usd=0.1)
        self.assertIn("repeat_failure", [s.name for s in out2.signals])
        self.assertEqual((out2.level, out2.action), (drift.STOP, "stop"))   # judge step, judge off -> stop
        self.assertFalse(out2.proceed)
        u = w.unit()
        self.assertEqual(u["state"], UnitState.FAILED.value)
        self.assertEqual(w.store.get(E_ESCALATION, "%s:U1" % RUN)["code"], C.DRIFT_STOP)
        self.assertEqual([m["n"] for m in u["detail"]["drift"]["metrics"]], [1, 2])
        self.assertIn(C.KIND_DRIFT_SIGNAL, w.kinds())

    def test_reviewer_step_forces_review(self):
        w = self.world()
        C.set_unit_detail(w.ctx, "U1", drift={"level": drift.NUDGE, "metrics": []})
        out = drift.on_attempt(w.ctx, "U1", 1, fail_gate(), diff={"paths": ["app/extra.py"], "patch": ""},
                               usd=0.0)
        self.assertEqual(out.action, "reviewer")
        self.assertTrue(w.unit()["detail"]["drift"]["force_review"])

    def test_note_only_for_weak_signal(self):
        w = self.world()
        out = drift.on_attempt(w.ctx, "U1", 1, Gate(True, "", "", {"passed": 1}),
                               diff={"paths": ["app/extra.py"], "patch": ""}, builder_outcome="SUBMIT")
        self.assertEqual((out.action, out.level, out.proceed), ("note", drift.NOTE, True))

    def _judge_world(self, answer: Any) -> World:
        w = World(self, drift_enabled=True, drift_threshold=2, judge_enabled=True)
        C.set_unit_detail(w.ctx, "U1", drift={"level": drift.REVIEWER, "metrics": []})
        w.llm.script[("judge", "U1.drift.1")] = answer
        return w

    def test_judge_redirect_sends_back_with_ruling(self):
        w = self._judge_world({"choice": "redirect", "rationale": "the spec has no popup",
                               "quotes": [{"quote": "The add command stores a todo and prints its id."}],
                               "instructions": "remove show_popup; print the id only"})
        out = drift.on_attempt(w.ctx, "U1", 1, Gate(True, "", "", {"passed": 1}), diff=w.diff, usd=0.0)
        self.assertEqual(out.action, "judge:redirect")
        self.assertFalse(out.proceed)
        u = w.unit()
        self.assertEqual(u["state"], UnitState.READY.value)
        self.assertIn("remove show_popup", u["detail"]["nudge"])
        self.assertEqual(u["detail"]["drift"]["level"], drift.REVIEWER)
        self.assertIn("remove show_popup", w.store.get(E_ATTEMPT, "U1#1")["detail"]["evidence"])
        prompt = w.llm.calls[-1]["prompt"]
        self.assertIn("scope_words", prompt)
        self.assertIn(QUOTE, prompt)
        self.assertNotIn("BUILDER CONVERSATION", prompt)

    def test_judge_continue_keeps_unit(self):
        w = self._judge_world({"choice": "continue", "rationale": "false alarm",
                               "quotes": [{"quote": QUOTE}]})
        out = drift.on_attempt(w.ctx, "U1", 1, Gate(True, "", "", {"passed": 1}), diff=w.diff, usd=0.0)
        self.assertEqual((out.action, out.proceed), ("judge:continue", True))
        self.assertEqual(w.unit()["state"], UnitState.VERIFIED.value)

    def test_judge_spec_gap_stops(self):
        w = self._judge_world({"choice": "continue", "rationale": "spec silent", "quotes": [{"quote": QUOTE}],
                               "spec_gap": True})
        out = drift.on_attempt(w.ctx, "U1", 1, Gate(True, "", "", {"passed": 1}), diff=w.diff, usd=0.0)
        self.assertEqual(out.action, "stop")
        esc = w.store.get(E_ESCALATION, "%s:U1" % RUN)
        self.assertEqual(esc["detail"]["route"], "spec_question")


if __name__ == "__main__":
    unittest.main()
