"""Pipeline hooks of understand_plus: on_understood / parked / on_tick / on_green."""

from __future__ import annotations

import types
import unittest

from line.contracts import E_PACK, E_RUN, PackVersion, from_dict, to_dict
from line.store import SqliteStore
from line import understand_plus as up
from line.understand_plus import human
from line.understand_plus._common import E_PARK, HUMAN_QUESTION, RUN_PARKED, RUN_UNPARKED, SPEC_ADDENDUM
from line.tests.test_uplus_conflicts import judge
from line.tests.test_uplus_support import cfg, events, line_of, make_digest, make_pack, register_uplus, world


def script(w):
    f1, f2 = w.heads["F1"], w.heads["F2"]
    covered = lambda sp, needle: {"status": "covered", "span_id": sp.id, "quote": line_of(sp, needle)}
    slots = lambda sp, needle: [dict(covered(sp, needle), slot=n) for n in
                                ("input", "output", "errors", "limits", "units", "persistence")]
    w.f.llm.add("gaps", {"f_items": [
        {"id": "F1", "slots": slots(f1, "credit") + [{"slot": "permissions", "status": "gap",
                                                     "assumption": "Every clerk may do it.", "category": "permission"}]},
        {"id": "F2", "slots": slots(f2, "VIP") + [{"slot": "permissions", "status": "gap",
                                                  "assumption": "Every clerk may do it.", "category": "permission"}]},
    ]}, key="gaps")
    w.f.llm.add("conflicts", {"claims": [
        {"entity": "order", "attribute": "shipping time", "outcome": "ship within 3 days", "f_item": "F1",
         "span_id": f1.id, "quote": "Orders ship within 3 days."},
        {"entity": "order", "attribute": "shipping time", "outcome": "ship within 5 days", "f_item": "F2",
         "span_id": f2.id, "quote": "Orders ship within 5 days."}], "links": []}, key="extract")
    w.f.llm.add("conflicts", judge("contradiction"), key="judge")


class HookTest(unittest.TestCase):
    def test_disabled_is_a_noop(self):
        w = world(self, uplus_enabled=False)
        self.assertEqual(up.on_understood(w.ctx, w.pv, w.digest), {"status": "off"})
        self.assertEqual(up.on_tick(w.ctx), [])
        self.assertEqual(up.on_green(w.ctx), {"status": "off"})
        self.assertFalse(up.parked(w.ctx))
        self.assertEqual(w.f.llm.calls, [])

    def test_disabled_by_default_without_config_key(self):
        from unittest import mock
        with mock.patch.dict("os.environ", {"LINE_UPLUS": ""}):
            self.assertFalse(up.enabled(types.SimpleNamespace()))
        with mock.patch.dict("os.environ", {"LINE_UPLUS": "1"}):
            self.assertTrue(up.enabled(types.SimpleNamespace()))

    def test_park_answer_resume(self):
        w = world(self)
        script(w)
        res = up.on_understood(w.ctx, w.pv, w.digest)
        self.assertEqual(res["status"], "waiting_human")
        self.assertEqual(res["questions"], ["Q1", "Q2"])          # one permission question (F1+F2) + one conflict
        self.assertEqual(res["f_items"], ["F1", "F2"])
        self.assertTrue(up.parked(w.ctx))
        self.assertEqual(len(events(w.f.store, HUMAN_QUESTION)), 1)
        self.assertEqual(len(events(w.f.store, RUN_PARKED)), 1)
        # a resumed driver with nothing answered stays parked and calls no model
        n = len(w.f.llm.calls)
        self.assertEqual(up.on_understood(w.ctx, w.pv, w.digest)["status"], "waiting_human")
        self.assertEqual(len(w.f.llm.calls), n)
        st, body = human.api_answers(w.f.store, w.run, {"who": "po", "answers": [
            {"qid": "Q1", "option": "accept"}, {"qid": "Q2", "option": "keep_b"}]}, cfg=w.ctx.cfg)
        self.assertEqual((st, body["addendum"], body["resume"]), (200, "v1.1", True))
        self.assertFalse(up.parked(w.ctx))
        x1 = w.f.store.get("conflict", "%s:X1" % w.run)
        self.assertEqual((x1["state"], x1["answer"]["option"], x1["addendum"]), ("resolved", "keep_b", "v1.1"))
        perm = [a for a in w.f.store.query("assumption", run=w.run) if a["slot"] == "permissions"]
        self.assertEqual({a["state"] for a in perm}, {"answered"})
        npv = from_dict(PackVersion, w.f.store.get(E_PACK, w.f.store.get(E_RUN, w.run)["spec_hash"]))
        dg = make_digest(npv, w.heads)
        res = up.on_understood(w.ctx, npv, dg)                      # same answers again: nothing re-asked
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["round"]["asked"] if "round" in res else [], [])
        self.assertEqual(len(events(w.f.store, SPEC_ADDENDUM)), 1)
        self.assertEqual(len(events(w.f.store, RUN_UNPARKED)), 1)

    def test_dry_auto_refreezes(self):
        w = world(self, dry_human="auto")
        script(w)
        res = up.on_understood(w.ctx, w.pv, w.digest)
        self.assertEqual(res["status"], "refrozen")
        self.assertNotEqual(res["pv"].version, w.pv.version)
        self.assertTrue(any(sp.path == "addendum/v1.1.md" for sp in res["pv"].spans))
        self.assertFalse(up.parked(w.ctx))
        self.assertEqual(up.on_understood(w.ctx, res["pv"], make_digest(res["pv"], w.heads))["status"], "ok")

    def test_tick_and_green(self):
        w = world(self)
        script(w)
        up.on_understood(w.ctx, w.pv, w.digest)
        q = w.f.store.get("human_question", "%s:Q1" % w.run)
        w.f.clock.t = q["due_ms"] + 1
        self.assertEqual(sorted(r["to"] for r in up.on_tick(w.ctx) if r["qid"] == "Q1"), ["lead", "owner"])
        self.assertTrue(up.parked(w.ctx))                           # deadline passed: still waiting, no default
        out = up.on_green(w.ctx)
        self.assertEqual((out["status"], out["written"]), ("ok", 2))


class SqliteStoreTest(unittest.TestCase):
    def test_round_on_the_real_store(self):
        register_uplus(self)
        st = SqliteStore(":memory:")
        pv, heads = make_pack()
        st.put(E_PACK, pv.version, to_dict(pv))
        st.put(E_RUN, "r9", {"id": "r9", "pack_path": "", "state": "understanding", "spec_hash": pv.version, "detail": {}})
        sp = heads["F1"]
        d = {"kind": "assumption", "decision": "Who may cancel?", "recommended": "a", "f_items": ["F1"], "refs": [],
             "options": [{"id": "a", "text": "Anyone", "impact": "x"}, {"id": "b", "text": "Admins", "impact": "y"}],
             "evidence": [{"span_id": sp.id, "quote": line_of(sp, "credit")}]}
        c = cfg()
        r = human.ask_round(st, "r9", [d], cfg=c, pack_version=pv.version)
        human.park(st, "r9", f_items=["F1"], questions=r["asked"], pack_version=pv.version, cfg=c)
        self.assertTrue(human.is_parked(st, "r9"))
        out = human.answer_question(st, "r9", "Q1", "b", "po", cfg=c)
        self.assertEqual(out["addendum"], "v1.1")
        self.assertFalse(st.get(E_PARK, "r9")["parked"])
        self.assertEqual(st.get(E_RUN, "r9")["spec_hash"], out["version"])


if __name__ == "__main__":
    unittest.main()
