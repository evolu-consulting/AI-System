"""A project's cost (dollars, tokens in and out over all model calls of its runs) and whether it needs a person."""

from __future__ import annotations

import unittest

from line import projects
from line.contracts import E_ESCALATION, E_LLM_CALL, E_RUN
from line.tests.fakes import make_fakes


class ProjectUsageTest(unittest.TestCase):
    def setUp(self):
        self.st = make_fakes().store

    def call(self, cid, run, usd, i, o, cr=0, cw=0):
        self.st.put(E_LLM_CALL, cid, {"id": cid, "run": run, "usd": usd,
                                      "usage": {"input": i, "output": o, "cacheRead": cr, "cacheWrite": cw}}, run=run)

    def test_usage_adds_every_call_of_every_run(self):
        self.call("c1", "R1", 0.5, 10, 200, cr=1000, cw=90)
        self.call("c2", "R1", 0.25, 5, 100)
        self.call("c3", "R2", 1.0, 1, 50)
        self.call("c4", "R9", 9.0, 9, 9)                     # another project's run: not counted
        u = projects.usage_of(self.st, [{"id": "R1"}, {"id": "R2"}])
        self.assertEqual(u, {"usd": 1.75, "tokens_in": 10 + 1000 + 90 + 5 + 1, "tokens_out": 350})
        self.assertEqual(projects.usage_of(self.st, []), {"usd": 0.0, "tokens_in": 0, "tokens_out": 0})

    def test_node_tokens_count_like_project_usage(self):
        from line import runview
        self.assertEqual(runview._tokens([]), (0, 0))
        calls = [{"usage": {"input": 10, "output": 200, "cacheRead": 1000, "cacheWrite": 90}},
                 {"usage": {"input": 5, "output": 100}}, {"role": "x"}]
        self.assertEqual(runview._tokens(calls), (10 + 1000 + 90 + 5, 300))

    def test_progress_counts_complete_nodes_over_all_runs(self):
        from unittest import mock
        states = {"R1": ["done"] * 7 + ["skipped", "done"],                  # green: 9 of 9
                  "R2": ["done", "done", "failed"] + ["pending"] * 6}       # failed early: 2 of 9
        with mock.patch("line.runview.nodes", side_effect=lambda st, rid: [{"state": s} for s in states[rid]]) as n:
            projects._node_counts.clear()
            p = projects.progress_of(self.st, [{"id": "R1", "state": "green"}, {"id": "R2", "state": "building"}])
            self.assertEqual(p, {"done": 11, "total": 18, "pct": 61})
            projects.progress_of(self.st, [{"id": "R1", "state": "green"}, {"id": "R2", "state": "building"}])
            self.assertEqual([c.args[1] for c in n.call_args_list], ["R1", "R2", "R2"])   # a finished run: once
        self.assertEqual(projects.progress_of(self.st, []), {"done": 0, "total": 0, "pct": 0})

    def test_attention(self):
        att = projects.attention_of
        self.assertEqual(att(self.st, None, None), {"needed": False, "why": ""})
        self.assertFalse(att(self.st, {"id": "R1", "state": "building", "detail": {}}, None)["needed"])
        self.assertEqual(att(self.st, {"id": "R1", "state": "planning",
                                       "detail": {"hook_hold": {"name": "approval gate"}}}, None)["why"],
                         "held by hook approval gate")
        self.assertEqual(att(self.st, {"id": "R1", "state": "building", "detail": {"paused": {"by": "demo"}}},
                             None)["why"], "stopped by demo")
        self.assertEqual(att(self.st, {"id": "R1", "state": "parked", "detail": {}}, None)["why"],
                         "waiting for answers")
        self.st.put(E_ESCALATION, "R2:e", {"id": "R2:e", "run": "R2", "code": "SMOKE_FAIL"}, run="R2")
        self.assertEqual(att(self.st, None, {"id": "R2", "state": "escalated"}),
                         {"needed": True, "why": "last run failed: SMOKE_FAIL"})
        self.assertFalse(att(self.st, None, {"id": "R3", "state": "green"})["needed"])
        # a failed run does not count while a newer process runs fine
        self.assertFalse(att(self.st, {"id": "R4", "state": "building", "detail": {}},
                             {"id": "R4", "state": "building"})["needed"])


if __name__ == "__main__":
    unittest.main()
