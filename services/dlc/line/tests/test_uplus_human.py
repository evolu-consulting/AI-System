"""Human question / answer store, addendum vN.k and reminders (understand_plus.human / addendum)."""

from __future__ import annotations

import datetime as dt
import unittest

from line import codes
from line.codes import LineError
from line.contracts import E_FITEM, E_PACK, E_RUN, PackVersion, from_dict
from line.understand_plus import human
from line.understand_plus._common import (E_ADDENDUM, E_ASSUMPTION, HUMAN_ANSWERED, HUMAN_QUESTION, HUMAN_REMINDER,
                                          RUN_PARKED, RUN_UNPARKED, SPEC_ADDENDUM, add_workdays)
from line.tests.test_uplus_support import events, world


def draft(w, i, f_item="F1", **kw):
    sp = w.heads[f_item]
    aid = "%s:ASSUMED-%d" % (w.run, i)
    w.f.store.put(E_ASSUMPTION, aid, {"id": aid, "aid": "ASSUMED-%d" % i, "run": w.run, "f_item": f_item,
                                      "state": "proposed", "text": "assumption %d" % i}, run=w.run)
    d = {"kind": "assumption", "decision": "Decision %d?" % i,
         "options": [{"id": "accept", "text": "Accept %d" % i, "impact": "tests follow"},
                     {"id": "alt1", "text": "Other rule %d" % i, "impact": "tests follow the other rule"}],
         "recommended": "accept", "evidence": [{"span_id": sp.id, "quote": sp.text.split("\n")[0]}],
         "f_items": [f_item], "refs": [{"entity": E_ASSUMPTION, "id": aid}]}
    d.update(kw)
    return d


class SchemaTest(unittest.TestCase):
    def setUp(self):
        self.w = world(self)

    def test_question_needs_every_field(self):
        good = draft(self.w, 1)
        self.assertEqual(human.validate_question(good), [])
        bad = dict(good, options=good["options"][:1], recommended="nope", evidence=[])
        errs = human.validate_question(bad)
        self.assertTrue(any(e.startswith("options") for e in errs))
        self.assertIn("recommended", errs)
        self.assertIn("evidence", errs)
        no_impact = dict(good, options=[{"id": "a", "text": "x"}, {"id": "b", "text": "y", "impact": "z"}], recommended="a")
        self.assertTrue(human.validate_question(no_impact))
        r = human.ask_round(self.w.f.store, self.w.run, [bad], cfg=self.w.ctx.cfg)
        self.assertEqual(r["asked"], [])
        self.assertEqual(len(r["rejected"]), 1)

    def test_workdays(self):
        fri = int(dt.datetime(2026, 10, 9, 10, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
        mon = int(dt.datetime(2026, 10, 12, 10, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
        tue = int(dt.datetime(2026, 10, 13, 10, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
        self.assertEqual(add_workdays(fri, 1), mon)
        self.assertEqual(add_workdays(fri, 2), tue)
        sat = int(dt.datetime(2026, 10, 10, 15, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
        self.assertEqual(add_workdays(sat, 1), int(dt.datetime(2026, 10, 13, 0, 0, tzinfo=dt.timezone.utc).timestamp() * 1000))


class RoundTest(unittest.TestCase):
    def setUp(self):
        self.w = world(self)
        self.st = self.w.f.store

    def ask(self, n=5, **kw):
        drafts = [draft(self.w, i, "F1" if i % 2 else "F2") for i in range(1, n + 1)]
        r = human.ask_round(self.st, self.w.run, drafts, cfg=self.w.ctx.cfg, pack_version=self.w.pv.version, **kw)
        human.park(self.st, self.w.run, f_items=["F1", "F2"], questions=r["asked"] + r["held"],
                   pack_version=self.w.pv.version, cfg=self.w.ctx.cfg)
        return r

    def test_one_round_with_cap_of_three_open(self):
        r = self.ask(5)
        self.assertEqual(r["asked"], ["Q1", "Q2", "Q3"])
        self.assertEqual(r["held"], ["Q4", "Q5"])
        ev = events(self.st, HUMAN_QUESTION)
        self.assertEqual(len(ev), 1)                        # ONE batched round
        self.assertEqual(ev[0].body["held"], ["Q4", "Q5"])
        a1 = self.st.get(E_ASSUMPTION, "%s:ASSUMED-1" % self.w.run)
        self.assertEqual((a1["question"], a1["state"]), ("Q1", "proposed"))   # asked, not yet answered
        res = human.answer_question(self.st, self.w.run, "Q1", "accept", "ana", cfg=self.w.ctx.cfg)
        self.assertEqual(res["released"], ["Q4"])
        self.assertEqual(res["remaining"], 4)
        self.assertIsNone(res["addendum"])
        self.assertTrue(human.is_parked(self.st, self.w.run))
        # asking the same decisions again does not create new questions
        again = human.ask_round(self.st, self.w.run, [draft(self.w, 2, "F2")], cfg=self.w.ctx.cfg)
        self.assertEqual(again["duplicates"], ["Q2"])

    def test_answer_errors(self):
        self.ask(1)
        with self.assertRaises(LineError) as cm:
            human.answer_question(self.st, self.w.run, "Q9", "accept", "ana")
        self.assertEqual(cm.exception.code, codes.NOT_FOUND)
        with self.assertRaises(LineError) as cm:
            human.answer_question(self.st, self.w.run, "Q1", "maybe", "ana")
        self.assertEqual(cm.exception.code, codes.SCHEMA_INVALID)
        with self.assertRaises(LineError) as cm:
            human.answer_question(self.st, self.w.run, "Q1", {"option": "other"}, "ana")
        self.assertEqual(cm.exception.code, codes.SCHEMA_INVALID)
        with self.assertRaises(LineError) as cm:
            human.answer_question(self.st, self.w.run, "Q1", "accept", "")
        self.assertEqual(cm.exception.code, codes.SCHEMA_INVALID)
        human.answer_question(self.st, self.w.run, "Q1", {"option": "other", "text": "Paid orders stay forever"}, "ana")
        with self.assertRaises(LineError) as cm:
            human.answer_question(self.st, self.w.run, "Q1", "accept", "ana")
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)

    def test_all_answers_make_addendum_and_unpark(self):
        self.ask(2)
        human.answer_question(self.st, self.w.run, "Q1", "accept", "ana", cfg=self.w.ctx.cfg)
        res = human.answer_question(self.st, self.w.run, "Q2", {"option": "other", "text": "Use rule Z"}, "bo",
                                    cfg=self.w.ctx.cfg)
        self.assertEqual(res["addendum"], "v1.1")
        self.assertTrue(res["resume"])
        self.assertFalse(human.is_parked(self.st, self.w.run))
        run = self.st.get(E_RUN, self.w.run)
        self.assertEqual(run["spec_hash"], res["version"])
        self.assertEqual(run["detail"]["spec_hash_base"], self.w.pv.version)
        npv = from_dict(PackVersion, self.st.get(E_PACK, res["version"]))
        self.assertIn("addendum/v1.1.md", npv.files)
        self.assertEqual(len(npv.spans), len(self.w.pv.spans) + 3)   # title + one span per answer
        q2span = next(sp for sp in npv.spans if sp.heading.startswith("Q2"))
        self.assertIn("Answer: Use rule Z", q2span.text)
        a1 = self.st.get(E_ASSUMPTION, "%s:ASSUMED-1" % self.w.run)
        self.assertEqual(a1["state"], "answered")
        self.assertEqual(a1["addendum"], "v1.1")
        self.assertTrue(a1["addendum_span"].startswith("addendum/v1.1.md#L"))
        self.assertTrue(self.st.get(E_FITEM, "%s:F1" % self.w.run)["stale"])
        self.assertTrue(self.st.get(E_FITEM, "%s:F2" % self.w.run)["stale"])
        kinds = [e.kind for e in events(self.st, run=self.w.run)]
        for k in (RUN_PARKED, HUMAN_ANSWERED, SPEC_ADDENDUM, RUN_UNPARKED):
            self.assertIn(k, kinds)
        self.assertLess(kinds.index(SPEC_ADDENDUM), kinds.index(RUN_UNPARKED))
        # a second round of the same run gets v1.2 on top of v1.1
        human.ask_round(self.st, self.w.run, [draft(self.w, 7)], cfg=self.w.ctx.cfg, pack_version=res["version"])
        res2 = human.answer_question(self.st, self.w.run, "Q3", "alt1", "ana", cfg=self.w.ctx.cfg)
        self.assertEqual(res2["addendum"], "v1.2")
        npv2 = from_dict(PackVersion, self.st.get(E_PACK, res2["version"]))
        self.assertIn("addendum/v1.1.md", npv2.files)
        self.assertIn("addendum/v1.2.md", npv2.files)

    def test_answered_fingerprint_is_not_asked_again(self):
        self.ask(1)
        human.answer_question(self.st, self.w.run, "Q1", "accept", "ana", cfg=self.w.ctx.cfg)
        base = self.st.get(E_RUN, self.w.run)["detail"]["spec_hash_base"]
        # another run on the same base pack: the addendum answers it
        r = human.ask_round(self.st, "r2", [draft(self.w, 1, "F1")], cfg=self.w.ctx.cfg, base_version=base)
        self.assertEqual(r["asked"], [])
        self.assertEqual(r["reused"][0]["source"], "v1.1")
        self.assertEqual(len(self.st.query(E_ADDENDUM)), 1)

    def test_reminders_never_answer(self):
        self.ask(1)
        q = self.st.get("human_question", "%s:Q1" % self.w.run)
        self.w.f.clock.t = q["remind_ms"] + 1
        rem = human.check_timeouts(self.st, self.w.run, cfg=self.w.ctx.cfg)
        self.assertEqual([r["to"] for r in rem], ["owner"])
        self.assertEqual(human.check_timeouts(self.st, self.w.run, cfg=self.w.ctx.cfg), [])
        self.w.f.clock.t = q["due_ms"] + 1
        rem = human.check_timeouts(self.st, None, cfg=self.w.ctx.cfg)
        self.assertEqual([(r["to"], r["overdue"]) for r in rem], [("lead", True)])
        self.assertEqual(self.st.get("human_question", "%s:Q1" % self.w.run)["state"], "open")
        self.assertTrue(human.is_parked(self.st, self.w.run))
        self.assertEqual(len(events(self.st, HUMAN_REMINDER)), 2)

    def test_dry_auto_answers_recommended(self):
        self.w.ctx.cfg.dry_human = "auto"
        self.ask(4)
        out = human.dry_answer_all(self.st, self.w.run, cfg=self.w.ctx.cfg)
        self.assertEqual(len(out), 4)
        self.assertEqual(out[-1]["addendum"], "v1.1")
        for q in human.questions(self.st, self.w.run):
            self.assertEqual(q["answer"]["option"], "accept")
            self.assertEqual(q["answer"]["who"], "dry-auto")

    def test_api(self):
        self.ask(2)
        got = human.api_questions(self.st, self.w.run)
        self.assertTrue(got["parked"])
        self.assertEqual([q["qid"] for q in got["questions"]], ["Q1", "Q2"])
        st, body = human.api_answers(self.st, self.w.run, {"qid": "Q1", "option": "nope", "who": "ana"})
        self.assertEqual(st, 400)
        st, body = human.api_answers(self.st, self.w.run, {"qid": "Q7", "option": "accept", "who": "ana"})
        self.assertEqual(st, 404)
        st, body = human.api_answers(self.st, self.w.run, {"who": "ana", "answers": [
            {"qid": "Q1", "option": "accept"}, {"qid": "Q2", "option": "alt1"}]}, cfg=self.w.ctx.cfg)
        self.assertEqual(st, 200)
        self.assertEqual(body["remaining"], 0)
        self.assertEqual(body["addendum"], "v1.1")
        self.assertTrue(body["resume"])
        self.assertEqual(len(events(self.st, SPEC_ADDENDUM)), 1)   # one addendum for the batch
        st, body = human.api_answers(self.st, self.w.run, {"qid": "Q1", "option": "accept", "who": "ana"})
        self.assertEqual(st, 409)


class _Res:
    def __init__(self, data):
        self.data, self.text = data, ""


class _Llm:
    """Answers per qid from a table; records the prompts it saw."""
    def __init__(self, table):
        self.table, self.prompts = table, []

    def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
        self.prompts.append((role, key, model, prompt))
        got = self.table.get(key)
        if isinstance(got, Exception):
            raise got
        return _Res(got)


class _Rag:
    def __init__(self):
        self.lines = []

    def retrieve(self, role, step, stack, max_chars, query=""):
        self.query = query
        return [{"text": "Project finding: the team keeps the old exit code for scripts."}]

    def write_worklog(self, subject, text, idem_key=""):
        self.lines.append((subject, text, idem_key))
        return "vec_1"


class DecideTest(unittest.TestCase):
    """human_mode=decide (owner decision 2026-10-11): the model decides, every decision lands in the worklog."""

    def setUp(self):
        self.w = world(self)
        self.st = self.w.f.store
        drafts = [draft(self.w, 1), draft(self.w, 2, "F2")]
        r = human.ask_round(self.st, self.w.run, drafts, cfg=self.w.ctx.cfg, pack_version=self.w.pv.version)
        human.park(self.st, self.w.run, f_items=["F1", "F2"], questions=r["asked"], pack_version=self.w.pv.version,
                   cfg=self.w.ctx.cfg)

    def test_mode_setting(self):
        self.assertEqual(human.human_mode(None, {}), "ask")
        self.assertEqual(human.human_mode(None, {"LINE_HUMAN_MODE": "decide"}), "decide")
        self.assertEqual(human.human_mode(None, {"LINE_HUMAN_MODE": "bogus"}), "ask")

    def test_model_decides_and_every_decision_is_logged(self):
        llm = _Llm({"Q1": {"option": "alt1", "reason": "the spec keeps the old rule"},
                    "Q2": {"option": "accept", "reason": "matches the quote"}})
        rag = _Rag()
        res = human.decide_all(self.st, self.w.run, llm, rag=rag, cfg=self.w.ctx.cfg)
        self.assertEqual([(r["qid"], r["answer"]["option"], r["fallback"]) for r in res],
                         [("Q1", "alt1", False), ("Q2", "accept", False)])
        self.assertEqual(human.pending(self.st, self.w.run), [])
        self.assertFalse(human.is_parked(self.st, self.w.run))           # the round closed and unparked
        self.assertEqual(res[-1]["addendum"], "v1.1")
        q1 = self.st.get(human.E_QUESTION, "%s:Q1" % self.w.run)
        self.assertTrue(q1["answer"]["who"].startswith("model:"))
        self.assertEqual(len(rag.lines), 2)
        subject, text, key = rag.lines[0]
        self.assertEqual(subject, human.WORKLOG_SUBJECT)
        for part in ("Q1", "Decision 1?", "alt1", "the spec keeps the old rule", "accept=Accept 1"):
            self.assertIn(part, text)
        self.assertEqual(key, "hq-%s-Q1" % self.w.run)
        ev = events(self.st, codes.HUMAN_DECIDED)
        self.assertEqual([e.body["qid"] for e in ev], ["Q1", "Q2"])
        self.assertTrue(all(e.body["worklog"] for e in ev))
        self.assertIn("Project finding", llm.prompts[0][3])               # project knowledge reaches the model
        self.assertIn("RECOMMENDED: accept", llm.prompts[0][3])

    def test_invalid_answer_falls_back_to_recommended_and_says_so(self):
        llm = _Llm({"Q1": {"option": "nope", "reason": "?"}, "Q2": LineError(codes.LLM_ERROR, "down", {})})
        rag = _Rag()
        res = human.decide_all(self.st, self.w.run, llm, rag=rag, cfg=self.w.ctx.cfg)
        self.assertEqual([(r["answer"]["option"], r["fallback"]) for r in res], [("accept", True), ("accept", True)])
        self.assertIn("recommended option was taken", rag.lines[0][1])
        self.assertEqual(human.pending(self.st, self.w.run), [])

    def test_no_worklog_port_still_decides(self):
        res = human.decide_all(self.st, self.w.run, _Llm({"Q1": {"option": "accept", "reason": "r"},
                                                          "Q2": {"option": "accept", "reason": "r"}}),
                               rag=None, cfg=self.w.ctx.cfg)
        self.assertEqual(len(res), 2)
        self.assertFalse(any(r["worklog"] for r in res))


if __name__ == "__main__":
    unittest.main()
