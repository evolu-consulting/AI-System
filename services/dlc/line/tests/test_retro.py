"""The calibration retro (line.retro): the case gets the actual outcome, findings are counted in the persona, and a
finding confirmed twice rewrites the persona rule it blames (never a protected one)."""

from __future__ import annotations

import json
import types
import unittest
from unittest import mock

from line import retro
from line.config import load_config


class FakeKh:
    def __init__(self):
        self.rows, self.rules, self.deleted = {}, {}, []

    def __call__(self, cfg, method, path, body=None):
        if path.startswith("/policy/plan"):
            proj = path.split("project=")[-1].replace("+", " ").replace("%20", " ")
            return {"rules": [dict(r, project=p) for (p, s), r in self.rules.items() if p == proj]}
        if path == "/policy/rule/set":
            self.rules[(body["project"], body["sub_action"])] = {"sub_action": body["sub_action"], "seq": body["seq"],
                                                                 "content": body["content"]}
            return {}
        if path == "/policy/rule/delete":
            self.deleted.append(body["sub_action"])
            self.rules.pop((body["project"], body["sub_action"]), None)
            return {}
        if path == "/vector/add":
            vid = body.get("id") or "h%d" % len(self.rows)
            self.rows[vid] = {"vector_id": vid, "source_text": body["text"], "metadata": body["metadata"]}
            return {"vector_id": vid}
        if path == "/vector/scroll":
            if "ids" in body:
                return {"hits": [self.rows[i] for i in body["ids"] if i in self.rows]}
            want = (body.get("filter") or {}).get("kind")
            return {"hits": [r for r in self.rows.values() if r["metadata"].get("project") == body["project"]
                             and (not want or r["metadata"].get("kind") == want)]}
        raise AssertionError(path)


class RetroTest(unittest.TestCase):
    def setUp(self):
        self.kh = FakeKh()
        for t, new in ((retro, "_kh"),):
            p = mock.patch.object(t, new, self.kh)
            p.start()
            self.addCleanup(p.stop)
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli")
        self.kh.rules[("agent-sizer", "ui fields")] = {"sub_action": "ui fields", "seq": 12,
                                                       "content": "a new visible field is requirement L"}
        self.kh.rules[("agent-sizer", "level")] = {"sub_action": "level", "seq": 9, "content": "level map"}

    def pipe(self, run):
        self.kh.rows["sz_" + run.lower().replace("-", "_")] = {
            "vector_id": "sz_" + run.lower().replace("-", "_"), "source_text": "SIZING CASE (enhancement): level 3",
            "metadata": {"project": "notes", "kind": "sizing-case", "summary": "requirement L"}}
        return types.SimpleNamespace(run=run, log=lambda m: None)

    def verdict(self, fid=""):
        return {"verdict": "over", "actual_size": "S", "case_lesson": "a date under the title is S",
                "findings": [{"action": "confirm" if fid else "new", "id": fid,
                              "title": "Rule 'ui fields' sizes one visible field as L",
                              "evidence": "3 files, +40 lines", "cause": "rule ui fields",
                              "rule_change": {"op": "rewrite", "sub_action": "ui fields",
                                              "content": "a visible field on one screen is requirement S"}}]}

    def test_size_of(self):
        self.assertEqual([retro.size_of(3, 40), retro.size_of(19, 822), retro.size_of(34, 1851)], ["S", "M", "L"])

    def test_a_finding_confirmed_twice_rewrites_the_rule_it_blames(self):
        fx = {"actual": {"files": 3, "added": 40, "deleted": 2, "size": "S"}, "build_rounds": 1}
        out = retro.apply(self.cfg, self.pipe("R1"), self.verdict(), fx, "agent-sizer", "notes")
        fid = out["findings"][0]["id"]
        self.assertEqual((out["findings"][0]["confirmed"], out["changes"]), (1, []))
        self.assertIn("ACTUAL S", self.kh.rows["sz_r1"]["source_text"])
        self.assertEqual(self.kh.rows["sz_r1"]["metadata"]["sizing_verdict"], "over")
        out = retro.apply(self.cfg, self.pipe("R2"), self.verdict(fid), fx, "agent-sizer", "notes")
        self.assertEqual(out["findings"][0], {"persona": "agent-sizer", "id": fid, "action": "confirm", "confirmed": 2,
                                              "status": "applied"})
        self.assertEqual(self.kh.rules[("agent-sizer", "ui fields")]["content"],
                         "a visible field on one screen is requirement S")
        self.assertTrue(any(r["metadata"].get("kind") == retro.HISTORY_KIND for r in self.kh.rows.values()))
        self.assertEqual(self.kh.rows[fid]["metadata"]["runs"], "R1,R2")

    def test_a_protected_rule_is_never_changed(self):
        v = self.verdict()
        v["findings"][0]["rule_change"] = {"op": "rewrite", "sub_action": "level", "content": "x"}
        fx = {"actual": {}, "build_rounds": 1}
        retro.apply(self.cfg, self.pipe("R1"), v, fx, "agent-sizer", "notes")
        fid = retro._finding_id("agent-sizer:" + v["findings"][0]["title"])
        v["findings"][0].update(action="confirm", id=fid)
        out = retro.apply(self.cfg, self.pipe("R2"), v, fx, "agent-sizer", "notes")
        self.assertIn("protected", out["changes"][0])
        self.assertEqual(self.kh.rules[("agent-sizer", "level")]["content"], "level map")

    def test_the_retro_fixes_its_own_rule_and_keeps_its_verdicts(self):
        self.kh.rules[("agent-retro", "right is a result too")] = {"sub_action": "right is a result too", "seq": 6,
                                                                   "content": "green in one round is always right"}
        own = {"action": "new", "title": "My rule calls every one-round green run right",
               "evidence": "run R1 level 3, measured S", "cause": "rule 'right is a result too'",
               "rule_change": {"op": "rewrite", "sub_action": "right is a result too",
                               "content": "judge by the measured size, not by green"}}
        fx = {"actual": {"files": 3, "added": 40, "deleted": 2, "size": "S"}, "build_rounds": 1,
              "predicted": {"level": 3}}
        out = retro.apply(self.cfg, self.pipe("R1"), {"verdict": "right", "self_findings": [own]}, fx,
                          "agent-sizer", "notes")
        fid = out["findings"][0]["id"]
        retro.apply(self.cfg, self.pipe("R2"), {"verdict": "over", "self_findings": [dict(own, action="confirm",
                                                                                         id=fid)]}, fx,
                    "agent-sizer", "notes")
        self.assertEqual(self.kh.rules[("agent-retro", "right is a result too")]["content"],
                         "judge by the measured size, not by green")
        self.assertEqual([v["verdict"] for v in retro.earlier_verdicts(self.cfg)], ["right", "over"])

    def test_a_finding_goes_to_the_persona_it_names_and_only_for_an_agent_of_this_run(self):
        self.kh.rules[("agent-reviewer", "hot paths break things")] = {"sub_action": "hot paths break things",
                                                                       "seq": 3, "content": "old"}
        self.kh.rules[("agent-reviewer", "the request only")] = {"sub_action": "the request only", "seq": 1,
                                                                 "content": "kept"}
        miss = {"persona": "agent-reviewer", "action": "new", "title": "Passed a per-call HTTP client on a hot path",
                "evidence": "review pass, QAS load failed", "cause": "rule 'hot paths break things'",
                "rule_change": {"op": "rewrite", "sub_action": "hot paths break things", "content": "new"}}
        guard = dict(miss, title="Reviewer rule on request scope", rule_change={
            "op": "rewrite", "sub_action": "the request only", "content": "x"})
        ghost = dict(miss, persona="agent-supervisor", title="no supervisor in this run")
        fx = {"actual": {}, "build_rounds": 2, "agents": {"solo_reviewer": {"misses_per_round": [0], "personas": ["agent-reviewer"]}}}
        out = retro.apply(self.cfg, self.pipe("R1"), {"verdict": "right", "findings": [miss, guard, ghost]}, fx,
                          "agent-sizer", "notes")
        self.assertEqual({f["persona"] for f in out["findings"]}, {"agent-reviewer"})
        self.assertEqual(out["dropped"], ["agent-supervisor: not in this run"])
        ids = [f["id"] for f in out["findings"]]
        out = retro.apply(self.cfg, self.pipe("R2"), {"verdict": "right", "findings": [
            dict(miss, action="confirm", id=ids[0]), dict(guard, action="confirm", id=ids[1])]}, fx,
            "agent-sizer", "notes")
        self.assertEqual(self.kh.rules[("agent-reviewer", "hot paths break things")]["content"], "new")
        self.assertEqual(self.kh.rules[("agent-reviewer", "the request only")]["content"], "kept")
        self.assertTrue(any("protected" in c for c in out["changes"]))

    def test_parse_and_findings_text(self):
        self.assertEqual(retro.parse('noise {"verdict": "right", "findings": []} end')["verdict"], "right")
        with mock.patch.object(retro, "findings", lambda cfg, p: [{"id": "pf_1", "status": "open", "confirmed": 1,
                                                                   "contradicted": 0, "title": "t"}]):
            self.assertIn("[pf_1] confirmed 1", retro.findings_text(self.cfg))


if __name__ == "__main__":
    unittest.main()
