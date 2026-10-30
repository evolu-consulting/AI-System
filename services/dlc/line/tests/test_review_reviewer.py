"""Clean-context reviewer + noise filter (line/review/reviewer.py)."""

from __future__ import annotations

import shutil
import tempfile
import unittest
from typing import Any, Dict, Optional
from unittest import mock

from line import codes, contracts
from line.config import load_config
from line.contracts import (
    E_ATTEMPT, E_ESCALATION, E_GATE, E_UNIT, Criterion, Digest, FItem, PackVersion, Span, Unit, UnitState, to_dict,
)
from line.llm import load_prompt
from line.review import _common as C
from line.review import reviewer
from line.tests.fakes import FakeLlm, make_fakes

RUN = "R1"
F1_TEXT = "The add command stores a todo and prints its id.\nAn empty title is rejected with exit code 2."
F2_TEXT = "The list command prints every todo, one per line, oldest first."
QUOTE = "An empty title is rejected with exit code 2."

PATCH = """diff --git a/app/todo.py b/app/todo.py
new file mode 100644
--- /dev/null
+++ b/app/todo.py
@@ -0,0 +1,6 @@
+def add(title):
+    if title == "":
+        raise SystemExit(1)
+    show_popup("Saved!")
+    return 1
+
"""


def finding(**kw: Any) -> Dict[str, Any]:
    f = {"severity": "major", "file": "app/todo.py", "line": 3, "issue": "empty title exits 1, spec says 2",
         "spec_quote": QUOTE, "span_id": "spec.md#L3-4", "fix": "exit with code 2"}
    f.update(kw)
    return f


class World:
    """Fake store + LLM + a frozen pack with two F-items and a verified unit U1 (F1)."""

    def __init__(self, test: unittest.TestCase, **cfg_kw: Any):
        self.tmp = tempfile.mkdtemp(prefix="review-")
        test.addCleanup(shutil.rmtree, self.tmp, True)
        p = mock.patch.object(codes, "EVENT_KINDS", codes.EVENT_KINDS | frozenset(C.NEW_EVENT_KINDS))
        p.start()
        test.addCleanup(p.stop)
        self.f = make_fakes()
        self.store = self.f.store
        self.llm: FakeLlm = self.f.llm
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=self.tmp)
        for k, v in cfg_kw.items():
            setattr(self.cfg, k, v)
        s1 = Span("spec.md#L3-4", "spec.md", 3, 4, "F1 Add", F1_TEXT, "s1")
        s2 = Span("spec.md#L6-6", "spec.md", 6, 6, "F2 List", F2_TEXT, "s2")
        self.pv = PackVersion("PV1", "todo", "/pack", {"spec.md": "x"}, [s1, s2])
        self.digest = Digest("PV1", "R", [
            FItem("F1", "Add", ["spec.md#L3-4"], F1_TEXT[:20],
                  [Criterion("F1.C1", "F1", "empty title is rejected", "spec.md#L3-4", QUOTE, then="exit 2")]),
            FItem("F2", "List", ["spec.md#L6-6"], F2_TEXT[:20]),
        ])
        self.diff = {"paths": ["app/todo.py"], "patch": PATCH}
        self.add_unit("U1", UnitState.VERIFIED.value)
        self.ctx = C.Ctx(self.store, self.cfg, self.llm, RUN, pv=self.pv, digest=self.digest)

    def add_unit(self, uid: str, state: str, f_items=("F1",), attempt: int = 1, model: str = "claude-opus-5-5",
                 claims=("app/todo.py",)) -> None:
        u = Unit(uid, RUN, "add command", state, 1, list(claims), [], list(f_items), ["T_F1_C1"], attempt=attempt,
                 model=model)
        self.store.put(E_UNIT, uid, to_dict(u), run=RUN)
        self.store.put(E_ATTEMPT, "%s#%d" % (uid, attempt),
                       {"unit": uid, "n": attempt, "run": RUN, "outcome": "verified", "code": "",
                        "detail": {"final": "BUILDER CONVERSATION: I think the popup is nice", "passed": 1}},
                       run=RUN)
        self.store.put(E_GATE, "%s#%d:verify" % (uid, attempt),
                       {"gate": {"ok": True, "code": "", "fingerprint": "", "detail": {"passed": 1}},
                        "unit": uid, "attempt": attempt, "name": "verify", "run": RUN}, run=RUN)

    def unit(self, uid: str = "U1") -> Dict[str, Any]:
        return self.store.get(E_UNIT, uid)

    def kinds(self) -> list:
        return [e.kind for e in self.store.events_after(0)]


class FilterTest(unittest.TestCase):
    def setUp(self):
        self.w = World(self)
        self.spans = self.w.pv.spans[:1]

    def test_drops_noise_and_keeps_grounded_findings(self):
        raw = [
            finding(),                                                     # kept
            finding(spec_quote=""),                                        # no quote
            finding(spec_quote="exit code 3 is used"),                     # quote not in spec
            finding(spec_quote="exit"),                                    # too short
            finding(file="app/other.py"),                                  # file not in diff
            finding(line=60),                                              # line outside hunks
            finding(severity="blocker"),                                   # bad severity
            finding(issue="empty title exits 1, spec says 2 "),            # duplicate (same file + issue)
            "not a finding",
        ]
        kept, dropped = reviewer.filter_findings(raw, self.spans, PATCH, ["app/todo.py"], 10)
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["span_id"], "spec.md#L3-4")
        reasons = sorted(d["reason"] for d in dropped)
        self.assertEqual(reasons, ["bad_severity", "duplicate", "malformed", "no_quote", "no_quote", "no_quote",
                                   "outside_diff", "outside_diff"])

    def test_cap_keeps_most_severe_and_normalises(self):
        raw = [finding(severity="minor", issue="m%d" % i, line=i + 1) for i in range(4)]
        raw.append(finding(severity="CRITICAL", issue="crash", line="5", file="b/app/todo.py"))
        kept, dropped = reviewer.filter_findings(raw, self.spans, PATCH, ["app/todo.py"], 2)
        self.assertEqual([f["severity"] for f in kept], ["critical", "minor"])
        self.assertEqual(kept[0]["line"], 5)
        self.assertEqual(len([d for d in dropped if d["reason"] == "over_cap"]), 3)

    def test_quote_matching_ignores_whitespace_and_case(self):
        self.assertEqual(C.quote_span("an EMPTY title  is rejected\nwith exit code 2", self.spans), "spec.md#L3-4")
        self.assertEqual(C.quote_span("prints every todo", self.spans), "")

    def test_parse_patch_new_side_lines(self):
        fp = C.parse_patch(PATCH)["app/todo.py"]
        self.assertEqual(fp.hunks, [(1, 6)])
        self.assertEqual(fp.added[2], (3, "        raise SystemExit(1)"))
        self.assertTrue(fp.touches(9))
        self.assertFalse(fp.touches(10))


class PacketTest(unittest.TestCase):
    def test_clean_context_only(self):
        w = World(self, review_enabled=True)
        w.llm.script[("reviewer", "U1.1")] = {"findings": []}
        reviewer.review(w.ctx, "U1", 1, diff=w.diff)
        prompt = w.llm.calls[-1]["prompt"]
        self.assertIn(QUOTE, prompt)                       # the unit's F-item span
        self.assertIn("show_popup", prompt)                # the diff
        self.assertIn("passed: 1 of 1", prompt)            # server test result
        self.assertIn("claims (files it may write): app/todo.py", prompt)
        self.assertNotIn("BUILDER CONVERSATION", prompt)   # never the builder's conversation
        self.assertNotIn(F2_TEXT, prompt)                  # only the unit's F-item spans
        pk = reviewer.build_packet(w.ctx, "U1", 1, diff=w.diff)
        blob = repr(to_dict(pk.contract)) + repr(pk.tests)
        for word in ("final", "evidence", "nudge"):
            self.assertNotIn(word, blob)

    def test_reviewer_model_differs_from_builder(self):
        w = World(self)
        u = contracts.from_dict(Unit, w.unit())
        self.assertEqual(reviewer.review_model(w.ctx, u), w.cfg.model_alt)
        u.model = w.cfg.model_alt
        self.assertEqual(reviewer.review_model(w.ctx, u), w.cfg.model)
        w.cfg.review_model = "m-x"
        self.assertEqual(reviewer.review_model(w.ctx, u), "m-x")

    def test_prompts_render(self):
        for role in ("reviewer", "judge"):
            text = load_prompt(role, unit_id="U1", spec="S", kind="drift")
            self.assertIn('"', text)
            self.assertNotIn("{unit_id}", text)


class HookTest(unittest.TestCase):
    def test_disabled_is_noop(self):
        w = World(self)
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertEqual((out.action, out.proceed), ("skip", True))
        self.assertEqual(w.llm.calls, [])

    def test_pass_on_minor_findings(self):
        w = World(self, review_enabled=True)
        w.llm.script[("reviewer", "U1.1")] = {"findings": [finding(severity="minor")], "summary": "ok"}
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertTrue(out.proceed)
        self.assertEqual(out.action, "pass")
        self.assertEqual(w.unit()["state"], UnitState.VERIFIED.value)
        row = w.store.get(E_GATE, "U1#1:review")
        self.assertTrue(row["gate"]["ok"])
        self.assertIn(C.KIND_REVIEW_DONE, w.kinds())

    def test_block_sends_back_with_evidence(self):
        w = World(self, review_enabled=True)
        w.llm.script[("reviewer", "U1.1")] = {"findings": [finding(), finding(spec_quote="made up quote here")]}
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertFalse(out.proceed)
        self.assertEqual((out.action, out.code), ("sent_back", C.REVIEW_BLOCK))
        u = w.unit()
        self.assertEqual(u["state"], UnitState.READY.value)
        self.assertEqual(u["detail"]["review"]["rounds"], 1)
        att = w.store.get(E_ATTEMPT, "U1#1")
        self.assertEqual(att["code"], C.REVIEW_BLOCK)
        self.assertIn(QUOTE, att["detail"]["evidence"])
        self.assertIn("app/todo.py:3", att["detail"]["evidence"])
        gate = w.store.get(E_GATE, "U1#1:review")
        self.assertEqual(gate["gate"]["code"], C.REVIEW_BLOCK)
        self.assertEqual(len(gate["dropped"]), 1)
        self.assertIn(codes.UNIT_REQUEUED, w.kinds())

    def test_second_block_without_judge_stops_unit(self):
        w = World(self, review_enabled=True, review_max_rounds=2)
        w.llm.script["reviewer"] = {"findings": [finding()]}
        reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        w.store.transition(E_UNIT, "U1", UnitState.LEASED, UnitState.READY)
        w.store.transition(E_UNIT, "U1", UnitState.SUBMITTED, UnitState.LEASED)
        w.store.transition(E_UNIT, "U1", UnitState.VERIFIED, UnitState.SUBMITTED)
        out = reviewer.on_verified(w.ctx, "U1", 2, diff=w.diff)
        self.assertEqual(out.action, "stopped")
        self.assertEqual(w.unit()["state"], UnitState.FAILED.value)
        esc = w.store.get(E_ESCALATION, "%s:U1" % RUN)
        self.assertEqual(esc["code"], C.REVIEW_BLOCK)

    def test_drift_forced_review_runs_when_disabled(self):
        w = World(self)
        C.set_unit_detail(w.ctx, "U1", drift={"force_review": True, "level": 3})
        w.llm.script[("reviewer", "U1.1")] = {"findings": []}
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertEqual(out.action, "pass")
        self.assertFalse(w.unit()["detail"]["drift"]["force_review"])

    def test_llm_error_does_not_block(self):
        w = World(self, review_enabled=True)
        w.llm.script["reviewer"] = codes.LineError(codes.LLM_ERROR, "down")
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertTrue(out.proceed)
        self.assertIn("LLM_ERROR", out.result.error)


class DisputeTest(unittest.TestCase):
    def _world(self, judge_answer: Any) -> World:
        w = World(self, review_enabled=True, review_max_rounds=1, judge_enabled=True)
        w.llm.script["reviewer"] = {"findings": [finding()]}
        w.llm.script[("judge", "U1.dispute.1")] = judge_answer
        return w

    def test_judge_overrules_reviewer(self):
        w = self._world({"choice": "builder", "rationale": "spec allows it",
                         "quotes": [{"span_id": "spec.md#L3-4", "quote": "The add command stores a todo"}]})
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertEqual(out.action, "judged_pass")
        self.assertTrue(out.proceed)
        self.assertEqual(w.unit()["state"], UnitState.VERIFIED.value)
        self.assertEqual(out.decision["status"], "pending")
        self.assertEqual(w.llm.calls[-1]["model"], "claude-opus-5-5")
        self.assertNotIn("BUILDER CONVERSATION", w.llm.calls[-1]["prompt"])

    def test_judge_fix_sends_back_with_ruling(self):
        w = self._world({"choice": "fix", "rationale": "spec says 2",
                         "quotes": [{"quote": QUOTE}], "instructions": "exit with code 2 on empty title"})
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertEqual(out.action, "judged_fix")
        self.assertEqual(w.unit()["state"], UnitState.READY.value)
        self.assertIn("exit with code 2", w.store.get(E_ATTEMPT, "U1#1")["detail"]["evidence"])

    def test_unquoted_ruling_stops(self):
        w = self._world({"choice": "builder", "rationale": "fine", "quotes": [{"quote": "whatever I like"}]})
        out = reviewer.on_verified(w.ctx, "U1", 1, diff=w.diff)
        self.assertEqual(out.action, "judged_stop")
        self.assertEqual(out.decision["status"], "rejected")
        self.assertEqual(w.unit()["state"], UnitState.FAILED.value)


class NoiseStatsTest(unittest.TestCase):
    def test_fixed_ratio(self):
        w = World(self)
        f1 = dict(finding(), id="a")
        w.store.put(E_GATE, "U1#1:review", {"name": "review", "unit": "U1", "attempt": 1, "run": RUN, "raw": 4,
                                            "kept": [f1], "gate": {"ok": False, "detail": {"findings": [f1]}}}, run=RUN)
        w.store.put(E_GATE, "U1#2:review", {"name": "review", "unit": "U1", "attempt": 2, "run": RUN, "raw": 1,
                                            "kept": [], "gate": {"ok": True, "detail": {}}}, run=RUN)
        s = reviewer.noise_stats(w.store, RUN)
        self.assertEqual((s["reviews"], s["raw"], s["kept"], s["fixed"]), (2, 5, 1, 1))
        self.assertEqual(s["fixed_ratio"], 1.0)
        self.assertEqual(s["noise_ratio"], 0.8)


if __name__ == "__main__":
    unittest.main()
