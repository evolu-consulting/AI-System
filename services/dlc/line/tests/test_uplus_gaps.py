"""Block 7: gap checklist + assumption register (understand_plus.gaps)."""

from __future__ import annotations

import unittest

from line import codes
from line.understand_plus import gaps
from line.understand_plus._common import E_ASSUMPTION, GAPS_CHECKED
from line.tests.test_uplus_support import events, line_of, world


def slots_answer(w, **over):
    """Model answer: F1 covers input/output with good quotes, F2 covers input; the rest are gaps."""
    f1, f2 = w.heads["F1"], w.heads["F2"]
    f1_slots = [
        {"slot": "input", "status": "covered", "span_id": f1.id, "quote": line_of(f1, "credit limit")},
        {"slot": "output", "status": "covered", "span_id": f1.id, "quote": "this text is not in the spec"},
        {"slot": "errors", "status": "gap", "assumption": "A failed order prints an error and nothing is stored.",
         "category": "none", "span_refs": [f1.id, "nope.md#L1-2"]},
        {"slot": "persistence", "status": "gap", "assumption": "Cancelled orders are deleted after 30 days, also paid ones.",
         "category": "none", "span_refs": [f1.id], "alternatives": ["Paid orders are kept"]},
        {"slot": "permissions", "status": "gap", "assumption": "Any signed-in clerk may do it.", "category": "none"},
        {"slot": "colour", "status": "gap", "assumption": "x"},
    ]
    f2_slots = [
        {"slot": "input", "status": "covered", "span_id": f2.id, "quote": line_of(f2, "VIP")},
        {"slot": "permissions", "status": "gap", "assumption": "Any signed-in clerk may do it.", "category": "permission"},
    ]
    ans = {"f_items": [{"id": "F1", "slots": f1_slots}, {"id": "F2", "slots": f2_slots}, {"id": "F9", "slots": []}]}
    ans.update(over)
    return ans


class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.w = world(self)

    def test_every_slot_answered_and_quotes_checked(self):
        v = gaps.validate(slots_answer(self.w), self.w.pv, self.w.digest)
        f1 = v["slots"]["F1"]
        self.assertEqual(list(f1), list(gaps.SLOT_NAMES))          # all 7 slots, none silent
        self.assertEqual(f1["input"]["status"], "covered")
        self.assertEqual(f1["output"]["status"], "gap")             # quote not in span -> gap
        self.assertEqual(f1["output"]["reason"], "quote_unmatched")
        self.assertEqual(f1["units"]["reason"], "not_answered")     # model left it out -> code placeholder
        self.assertIn("no behaviour is assumed", f1["units"]["assumption"])
        self.assertEqual(f1["errors"]["span_refs"], [self.w.heads["F1"].id])   # unknown span ref dropped
        reasons = {(d.get("f_item"), d.get("reason")) for d in v["dropped"]}
        self.assertIn(("F9", "unknown_f_item"), reasons)
        self.assertIn(("F1", "unknown_slot"), reasons)
        self.assertIn(("F1", "unknown_span_ref"), reasons)
        self.assertTrue(any(d.get("code") == codes.QUOTE_UNMATCHED for d in v["dropped"]))

    def test_sensitivity_is_upgraded_by_code(self):
        v = gaps.validate(slots_answer(self.w), self.w.pv, self.w.digest)
        f1 = v["slots"]["F1"]
        self.assertFalse(f1["errors"]["sensitive"])
        self.assertEqual(f1["persistence"]["categories"], ["deletion"])    # model said none; keyword says deletion
        self.assertEqual(f1["permissions"]["categories"], ["permission"])  # permissions slot is always sensitive
        self.assertTrue(v["slots"]["F2"]["limits"]["sensitive"] is False)


class CheckGapsTest(unittest.TestCase):
    def setUp(self):
        self.w = world(self)
        self.w.f.llm.add("gaps", slots_answer(self.w), key="gaps")

    def run_check(self):
        return gaps.check_gaps(self.w.pv, self.w.digest, self.w.f.llm, store=self.w.f.store, run=self.w.run,
                               cfg=self.w.ctx.cfg)

    def test_register_and_question_drafts(self):
        res = self.run_check()
        reg = gaps.register(self.w.f.store, self.w.run)
        self.assertEqual(res["covered"], 2)
        self.assertEqual(res["gaps"], 12)
        self.assertEqual([r["aid"] for r in reg][:3], ["ASSUMED-1", "ASSUMED-2", "ASSUMED-3"])
        states = {(r["f_item"], r["slot"]): r["state"] for r in reg}
        self.assertEqual(states[("F1", "errors")], gaps.ACCEPTED)       # not sensitive: recorded, not asked
        self.assertEqual(states[("F1", "persistence")], gaps.PROPOSED)  # deletion: a person decides
        self.assertEqual(states[("F2", "permissions")], gaps.PROPOSED)
        # same slot + same assumption text on F1 and F2 -> ONE question covering both
        perm = [q for q in res["questions"] if "who may do it" in q["decision"]]
        self.assertEqual(len(perm), 1)
        self.assertEqual(perm[0]["f_items"], ["F1", "F2"])
        self.assertEqual(len(perm[0]["refs"]), 2)
        for q in res["questions"]:
            self.assertEqual(q["recommended"], "accept")
            self.assertTrue(2 <= len(q["options"]) <= 4)
            self.assertTrue(q["evidence"][0]["quote"])
        ev = events(self.w.f.store, GAPS_CHECKED)
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0].body["covered"], 2)

    def test_rerun_keeps_ids_and_does_not_redraft_asked(self):
        self.run_check()
        n = len(self.w.f.store.query(E_ASSUMPTION, run=self.w.run))
        for r in self.w.f.store.query(E_ASSUMPTION, run=self.w.run):
            if r["state"] == gaps.PROPOSED:
                self.w.f.store.put(E_ASSUMPTION, r["id"], dict(r, question="Q1"), run=self.w.run)
        res = self.run_check()
        self.assertEqual(len(self.w.f.store.query(E_ASSUMPTION, run=self.w.run)), n)
        self.assertEqual(res["questions"], [])

    def test_bad_answer_is_schema_error(self):
        self.w.f.llm.script[("gaps", "gaps")] = ["not json"]
        with self.assertRaises(Exception) as cm:
            self.run_check()
        self.assertEqual(getattr(cm.exception, "code", ""), codes.SCHEMA_INVALID)


if __name__ == "__main__":
    unittest.main()
