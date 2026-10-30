"""The spec-design library (line.specdesign): context tags, one card per problem with a solution per context,
recall into a prompt block, and retain after a green run."""

from __future__ import annotations

import json
import types
import unittest
from unittest import mock

from line import specdesign as sd
from line.config import load_config


class FakeKh:
    """/vector/add, /vector/scroll, /vector/query of one project; query scores by shared words."""

    def __init__(self):
        self.rows = {}

    def __call__(self, cfg, method, path, body=None):
        if path == "/vector/add":
            self.rows[body["id"]] = {"vector_id": body["id"], "source_text": body["text"], "metadata": body["metadata"]}
            return {"status": "ok"}
        if path == "/vector/scroll":
            return {"hits": [self.rows[i] for i in body["ids"] if i in self.rows]}
        if path == "/vector/query":
            q = set(body["text"].lower().split())
            hits = []
            for r in self.rows.values():
                w = set(r["source_text"].lower().split())
                hits.append(dict(r, score=len(q & w) / max(len(q), 1)))      # share of the query's words
            return {"hits": sorted(hits, key=lambda h: -h["score"])[:body["k"]]}
        raise AssertionError(path)


def cfg():
    return load_config(env={}, line_json=None, rag_local_json=None, llm="cli", spec_design="1")


class ContextTest(unittest.TestCase):
    def test_tags_and_overlap(self):
        tags = sd.tags_from({"domain": "Note taking", "constraints": ["no sign-in", "single user"], "stack": "react",
                             "flow": "new", "project": "", "other": "x"})
        self.assertEqual(tags, ["constraint:no-sign-in", "constraint:single-user", "domain:note-taking", "flow:new",
                                "stack:react"])
        self.assertEqual(sd.tags_from({"audience": "developers running a bug-fix exercise locally"}),
                         ["audience:developers-running-bug"])              # at most 3 words, filler dropped
        self.assertEqual(sd.overlap(["a:x", "b:y"], ["a:x", "b:y"]), 1.0)
        self.assertAlmostEqual(sd.overlap(["a:x", "b:y"], ["a:x", "c:z"]), 1 / 3)
        self.assertAlmostEqual(sd.overlap(["audience:internal-staff"], ["audience:internal-users"]), 1 / 3)


class VariantTest(unittest.TestCase):
    def test_same_context_counts_a_use_and_another_context_adds_a_solution(self):
        web = ["app:web-crud", "audience:internal", "stack:react"]
        v, action = sd.add_variant([], web, "OR + match-all switch", "R1", "t1")
        self.assertEqual(action, "variant")
        v, action = sd.add_variant(v, web + ["domain:notes"], "OR + match-all switch", "R2", "t2")
        self.assertEqual((action, len(v), v[0]["uses"], v[0]["runs"]), ("used", 1, 2, ["R1", "R2"]))
        v, action = sd.add_variant(v, ["app:sap-fiori", "audience:enterprise", "stack:ui5"], "AND, per SAP filter bar",
                                   "R3", "t3")
        self.assertEqual((action, len(v)), ("variant", 2))     # same problem, other context: both answers kept


class LibraryTest(unittest.TestCase):
    def setUp(self):
        self.kh = FakeKh()
        p = mock.patch.object(sd, "call", self.kh)
        p.start()
        self.addCleanup(p.stop)
        self.c = cfg()
        f = mock.patch.object(sd, "RECALL_FLOOR", 0.3)       # the fake scores by shared words, not by meaning
        f.start()
        self.addCleanup(f.stop)
        h = mock.patch.object(sd, "enabled", lambda c: True)
        h.start()
        self.addCleanup(h.stop)

    def pipe(self, run, ctx, answer, project="p1"):
        detail = {"flow": "enhancement", "project": project, "sizing": {"context": ctx}}
        rows = {run: {"detail": detail}}
        store = types.SimpleNamespace(get=lambda e, i: rows.get(i))

        def set_detail(**kw):
            rows[run]["detail"] = dict(rows[run]["detail"], **kw)
        llm = types.SimpleNamespace(complete=lambda role, prompt, **kw: types.SimpleNamespace(text=answer, usd=0.01,
                                                                                            prompt=prompt))
        return types.SimpleNamespace(store=store, run=run, cfg=self.c, repo="", llm=llm, log=lambda m: None,
                                     _set_detail=set_detail, _charge_stage=lambda: None), rows

    def test_retain_then_recall_then_a_second_context_adds_a_variant(self):
        trait = {"traits": [{"id": "new", "problem": "filter spec says both any selected tag and narrows as more "
                             "tags are selected", "applies_when": "multi-select filter with contradictory wording",
                             "solution": "OR by default plus a match-all switch, recorded in Decisions"}]}
        p1, _ = self.pipe("R1", {"app": "web crud", "audience": "internal"}, json.dumps(trait))
        out = sd.retain(p1, "tags filter any selected tags narrows", ["any vs all: OR + switch"], "enhancement")
        self.assertEqual([c["action"] for c in out["cards"]], ["added"])
        cid = out["cards"][0]["id"]
        self.assertTrue(cid.startswith("sd_"))

        spec = "multi-select filter: show notes with any of the selected tags; narrows as more tags are selected"
        p2, rows = self.pipe("R2", {"app": "fiori list", "audience": "enterprise"},
                             json.dumps({"traits": [dict(trait["traits"][0], id=cid,
                                                         solution="AND, as the SAP filter bar does")]}),
                             project="p2")
        cards = sd.for_run(p2, spec)
        self.assertEqual([c["id"] for c in cards], [cid])
        text = sd.block(cards, sd.context_of(p2))
        self.assertIn("OR by default", text)
        self.assertIn("project:p2", text)                       # this request's context is shown to the agent
        out2 = sd.retain(p2, spec, ["reused %s, adapted to AND" % cid], "enhancement")
        self.assertEqual(out2["cards"], [{"id": cid, "action": "variant"}])
        self.assertEqual(out2["reused"], [cid])
        meta = self.kh.rows[cid]["metadata"]
        self.assertEqual([v["solution"][:3] for v in meta["variants"]], ["OR ", "AND"])
        self.assertEqual(meta["uses"], 2)
        self.assertIn("SOLUTIONS:", self.kh.rows[cid]["source_text"])

    def test_a_lesson_is_recalled_as_it_is_and_covers_the_same_trait(self):
        text = "LESSON LEARNED [Testing & QA]: tags filter any selected narrows Fix: OR plus a match-all switch"
        self.kh.rows["vec_lesson1"] = {"vector_id": "vec_lesson1", "source_text": text,
                                       "metadata": {"kind": "lesson", "project": "lesson-learned"}}
        p, _ = self.pipe("R4", {"app": "web crud"}, json.dumps({"traits": [{
            "id": "vec_lesson1", "problem": "tags filter any selected narrows", "solution": "OR plus a switch"}]}))
        cards = sd.for_run(p, "tags filter any selected narrows")
        self.assertEqual(cards[0]["id"], "vec_lesson1")
        self.assertIn("LESSON: LESSON LEARNED", sd.block(cards, []))
        out = sd.retain(p, "tags filter any selected narrows", [], "enhancement")
        self.assertEqual(out["cards"], [{"id": "vec_lesson1", "action": "covered"}])
        self.assertEqual(sorted(self.kh.rows), ["vec_lesson1"])            # nothing stored twice

    def test_off_or_broken_store_never_raises(self):
        with mock.patch.object(sd, "enabled", lambda c: False):
            self.assertEqual(sd.recall(self.c, "x"), [])
        with mock.patch.object(sd, "call", side_effect=RuntimeError("down")):
            self.assertEqual(sd.recall(self.c, "x"), [])
            p, _ = self.pipe("R3", {}, '{"traits": [{"problem": "p", "solution": "s"}]}')
            self.assertIn("down", sd.retain(p, "x", [], "new")["error"])


if __name__ == "__main__":
    unittest.main()
