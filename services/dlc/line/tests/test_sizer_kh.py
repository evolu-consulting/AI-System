"""The change sizer's knowledge comes from the store (RAG System): the rubric is a policy plan, earlier runs are precedents."""

from __future__ import annotations

import os
import shutil
import tempfile
import types
import unittest
from unittest import mock

from line.config import load_config
from line.contracts import E_RUN, Run
from line.tests.fakes import make_fakes
from line.understand import sizer


class FakeKh:
    def __init__(self, plan=None):
        self.plan, self.rows, self.calls = plan or [], {}, []

    def __call__(self, cfg, method, path, body=None):
        self.calls.append(path.split("?")[0])
        if path.startswith("/policy/plan"):
            return {"rules": self.plan}
        if path == "/vector/add":
            self.rows[body["id"]] = {"vector_id": body["id"], "source_text": body["text"], "metadata": body["metadata"]}
            return {"vector_id": body["id"]}
        if path == "/vector/query":
            return {"hits": [dict(r, score=0.8) for r in self.rows.values()]}
        if path == "/vector/scroll":
            return {"hits": [self.rows[i] for i in body["ids"] if i in self.rows]}
        raise AssertionError(path)


class SizerKnowledgeTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="sizer-kh-")
        self.pack = os.path.join(self.d, "pack")
        os.makedirs(self.pack)
        with open(os.path.join(self.pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("Add tags to notes, with a tag filter.")
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli")
        self.kh = FakeKh([{"seq": 2, "sub_action": "level 2", "content": "one feature of a small app"},
                          {"seq": 1, "sub_action": "level 1", "content": "a text or a style"}])
        for target, new in ((sizer, "_kh"), (sizer, "_kh_on")):
            p = mock.patch.object(target, new, self.kh if new == "_kh" else (lambda cfg: True))
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_the_rubric_comes_from_the_store_and_falls_back_to_the_built_in_one(self):
        r = sizer.rubric(self.cfg, "notes")
        self.assertEqual(r["source"], "kh")
        self.assertLess(r["text"].index("level 1"), r["text"].index("level 2"))     # in rule order
        self.kh.plan = []
        self.assertEqual(sizer.rubric(self.cfg)["source"], "builtin")
        self.assertEqual(sizer.rubric(self.cfg)["text"], sizer.BUILTIN)

    def test_the_persona_replaces_every_project_and_the_project_overrides_per_rule(self):
        every = [{"project": "every project", "seq": 1, "sub_action": "level 1", "content": "generic"}]
        mine = [{"project": "agent-sizer", "seq": 1, "sub_action": "surfaces", "content": "count surfaces"},
                {"project": "agent-sizer", "seq": 2, "sub_action": "bugs", "content": "persona bugs"}]
        own = [{"project": "pacific", "seq": 1, "sub_action": "bugs", "content": "pacific bugs are M"}]
        plans = {"every project": every, "agent-sizer": every + mine, "pacific": every + own, "notes": every}
        with mock.patch.object(sizer, "_plan", lambda cfg, p: plans[p]):
            text = sizer.rubric(self.cfg, "pacific")["text"]
            self.assertEqual([l.split(":")[0].strip() for l in text.splitlines()], ["surfaces", "bugs"])
            self.assertIn("pacific bugs are M", text)
            self.assertNotIn("generic", text)
            self.assertIn("persona bugs", sizer.rubric(self.cfg, "notes")["text"])
            cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli", sizer_persona="")
            self.assertEqual(sizer.rubric(cfg, "notes")["text"], "  level 1: generic")

    def test_a_finished_run_becomes_a_precedent_for_the_next_one(self):
        f = make_fakes()
        detail = {"flow": "enhancement", "rag_project": "notes", "spent_usd": 3.88,
                  "sizing": {"level": 3, "lane": "small", "by": "agent", "reasons": ["data model change"]},
                  "escalation": {"code": "BLOCKED_OUTSIDE_CLAIMS"}}
        f.store.put(E_RUN, "R1", Run("R1", self.pack, state="escalated", detail=detail), run="R1")
        pipe = types.SimpleNamespace(store=f.store, run="R1", cfg=self.cfg, pack=self.pack, log=lambda m: None)
        vid = sizer.record_case(pipe)
        meta = self.kh.rows[vid]["metadata"]
        self.assertEqual((meta["kind"], meta["project"], meta["level"], meta["outcome"]),
                         ("sizing-case", "notes", 3, "escalated BLOCKED_OUTSIDE_CLAIMS"))
        cases = sizer.precedents(self.cfg, "Add tags to notes", "notes")
        self.assertEqual([(c["level"], c["outcome"]) for c in cases], [(3, "escalated BLOCKED_OUTSIDE_CLAIMS")])
        self.assertIn("level 3 (small): escalated", sizer.precedents_text(cases))

    def test_the_sizer_prompt_carries_rubric_and_precedents(self):
        self.kh.rows["sz_old"] = {"vector_id": "sz_old", "source_text": "x", "metadata": {
            "kind": "sizing-case", "level": 2, "lane": "solo", "outcome": "green", "usd": 1.35, "summary": "tags"}}
        f = make_fakes()
        f.store.put(E_RUN, "R2", Run("R2", self.pack, state="admitted", detail={"flow": "enhancement"}), run="R2")
        seen = []
        llm = types.SimpleNamespace(complete=lambda role, prompt, **kw: seen.append(prompt) or types.SimpleNamespace(
            text='{"level": 2, "risk": "low"}', usd=0.01))
        empty = os.path.join(self.d, "empty")
        os.makedirs(empty)
        pipe = types.SimpleNamespace(store=f.store, run="R2", cfg=self.cfg, pack=self.pack, repo=empty, llm=llm,
                                     log=lambda m: None)
        out = sizer.run(pipe)
        self.assertEqual((out["level"], out["rubric"], out["precedents"][0]["outcome"]), (2, "kh", "green"))
        self.assertIn("one feature of a small app", seen[0])
        self.assertIn("SIMILAR EARLIER REQUESTS", seen[0])


if __name__ == "__main__":
    unittest.main()
