"""line.decisions: every person's decision at a gate is kept on disk (the spec's history), in the project's knowledge store,
in the living spec of the change, and reaches the retro as a positive or negative signal per agent persona."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import types
import unittest
from unittest import mock

from line import decisions, gatechat, gates, personas, retro
from line.contracts import E_RUN
from line.llm import make_llm
from line.pipeline import Pipeline
from line.ship._util import git
from line.tests import test_gates as TG
from line.tests.test_retro import FakeKh


class DecisionLedgerTest(unittest.TestCase):
    setUp = TG.GatedFlowTest.setUp
    _start = TG.GatedFlowTest._start
    _drive = TG.GatedFlowTest._drive
    _decide = TG.GatedFlowTest._decide

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def _kh(self):
        self.kh = FakeKh()
        for name, val in (("_kh", self.kh), ("_kh_on", lambda cfg: True)):
            p = mock.patch.object(decisions, name, val)
            p.start()
            self.addCleanup(p.stop)

    def _pipe(self, store, c, run):
        p = Pipeline(store, c, llm=make_llm(c, store, backend=self.backend))
        row = store.get(E_RUN, run)
        p.run = run
        p._setup(row)
        p.repo = row["detail"]["target"]
        return p

    def _pack(self):
        return self.store.get(E_RUN, self.run)["pack_path"]

    def _rows(self):
        return {k: r for k, r in self.kh.rows.items() if r["metadata"].get("kind") == decisions.KIND}

    def test_every_decision_is_kept_on_disk_in_kh_in_the_change_and_for_the_retro(self):
        self._kh()
        self._start(TG.Team(TG.CODE, TG.FIXED))
        out = gatechat.post(self.store, self.cfg, self.run, "spec", {"message": "Còn số âm thì sao?", "who": "ann"},
                            start=lambda fn: None)
        gatechat.answer(self.store, self.cfg, self.run, "spec", out["messages"][1]["id"], make_pipe=self._pipe)
        res = gates.decide(self.store, self.cfg, self.run, "spec", {
            "decision": "approve", "answers": [{"artifact": "spec", "id": "Q2", "ok": False, "text": "no floats"},
                                               {"artifact": "spec", "id": "Q3", "ok": True}]}, "ann")
        self.assertEqual(res["recorded"], {"disk": True, "store": "queued"})   # the click never waits for the store
        decisions.flush()
        self._drive()

        e = decisions.entries(self._pack())[0]                    # on disk, at once
        self.assertEqual((e["gate"], e["round"], e["decision"], e["signal"]), ("spec", 1, "approve", "mixed"))
        self.assertEqual((e["agreed"], e["changed"], e["chat_corrections"]), (1, 1, 1))
        self.assertEqual(e["personas"], ["agent-spec-analyst"])
        q2 = next(p for p in e["points"] if p["id"] == "Q2")
        self.assertEqual((q2["question"], q2["answer"], q2["text"]), ("floats too?", "changed", "no floats"))
        with open(os.path.join(self._pack(), e["documents"]["spec"]), encoding="utf-8") as fh:
            self.assertIn("negatives too", fh.read())             # the spec as the person approved it
        with open(os.path.join(self._pack(), decisions.DIR, "history.md"), encoding="utf-8") as fh:
            readable = fh.read()
        self.assertIn("CHANGED: no floats", readable)
        self.assertIn("Còn số âm thì sao?", readable)

        row = self._rows()["gd_%s_spec_r1" % self.run.lower().replace("-", "_")]     # in the project's store
        self.assertEqual((row["metadata"]["signal"], row["metadata"]["personas"]), ("mixed", "agent-spec-analyst"))
        self.assertIn("CHANGED -> no floats", row["source_text"])
        self.assertIn("CHAT PERSON: Còn số âm thì sao?", row["source_text"])

        self._decide("plan", "revise", target="tests", note="add a boundary case")
        row = self._decide("plan", "approve")
        self.assertEqual(row["detail"]["gate"]["name"], "final", row["detail"].get("escalation"))
        sig = [(x["gate"], x["round"], x["signal"]) for x in decisions.entries(self._pack())]
        self.assertEqual(sig, [("spec", 1, "mixed"), ("plan", 1, "negative"), ("plan", 2, "positive")])
        cp = git(self.target, "show", "main:.dlc/changes/%s/decisions.md" % self.run, check=False)
        self.assertEqual(cp.returncode, 0, cp.stderr)               # the living spec carries its decisions
        self.assertIn("add a boundary case", cp.stdout)
        self.assertIn("CHANGED: no floats", cp.stdout)

        row = self._decide("final", "hold", note="D1: correct; round 1 was a missing sign")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        last = decisions.entries(self._pack())[-1]
        self.assertEqual((last["signal"], last["personas"]), ("negative", ["agent-solo"]))   # a hold is negative
        self.assertEqual(row["detail"]["gated"]["history_commit"], "committed")     # the final decision too, on main
        cp = git(self.target, "show", "main:.dlc/changes/%s/decisions.md" % self.run, check=False)
        self.assertIn("missing sign", cp.stdout)
        self.assertEqual(git(self.target, "log", "-1", "--format=%s", "main").stdout.strip(),
                         "line %s: decisions at the gates" % self.run)
        self.assertEqual(git(self.target, "status", "--porcelain").stdout.strip(), "")

        v = decisions.view(self.store, self.run)                                # what the run page shows
        self.assertEqual([x["decision"] for x in v["entries"]], ["approve", "revise", "approve", "hold"])
        self.assertIn("missing sign", v["markdown"])
        doc = decisions.view(self.store, self.run, v["entries"][0]["documents"]["spec"])
        self.assertIn("negatives too", doc["text"])
        for bad in ("../pack.json", "history/../spec.md", "spec.md", "history/decisions.jsonl"):
            with self.assertRaises(KeyError):
                decisions.view(self.store, self.run, bad)
        self.assertIsNone(decisions.view(self.store, "R-NONE"))
        decisions.flush()
        self.assertEqual(len(self._rows()), 4)

        taken = decisions.retro_facts(self.store, self.run)                     # what the retro reads
        c = decisions.counts(taken)
        self.assertEqual((c["agent-spec-analyst"]["mixed"], c["agent-spec-analyst"]["points_changed"]), (1, 1))
        self.assertEqual((c["agent-test-author"]["negative"], c["agent-test-author"]["positive"]), (1, 1))
        self.assertEqual(c["agent-solo"]["negative"], 1)
        self.assertEqual(taken[0]["chat_corrections"], ["Còn số âm thì sao?"])
        fx = retro.facts(types.SimpleNamespace(store=self.store, run=self.run, repo=self.target, cfg=self.cfg))
        self.assertEqual(fx["human_signal"], c)
        project = decisions.project_of(self.cfg, row["detail"])
        before = decisions.earlier(self.cfg, project, ["agent-solo"], "R-LATER")      # what a later run sees
        self.assertEqual((before["agent-solo"]["negative"], before["agent-solo"]["runs"]), (1, 1))
        self.assertIn("missing sign", before["agent-solo"]["latest_not_approved_as_proposed"][0]["said"])
        self.assertEqual(decisions.earlier(self.cfg, project, ["agent-solo"], self.run), {})   # never its own run

        self.kh.rows.clear()                                        # the store was down: run end writes them again
        self.assertEqual(decisions.sync(self.cfg, self.store, self.run), 4)
        self.assertEqual(len(self._rows()), 4)

    def test_while_another_run_builds_the_next_change_carries_the_final_decision(self):
        self._start(TG.Team(TG.CODE, TG.FIXED))
        self._decide("spec", "approve")
        self._decide("plan", "approve")
        git(self.target, "branch", "line/R-OTHER/solo")               # another run of the repository builds on main
        row = self._decide("final", "deploy")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        self.assertEqual(row["detail"]["gated"]["history_commit"], "later: another run builds on main")
        cp = git(self.target, "show", "main:.dlc/changes/%s/decisions.md" % self.run)
        self.assertNotIn("deploy by", cp.stdout)                       # main has the history as merged

        later = os.path.join(self.work, "later")                       # the next run's change brings it up to date
        git(self.target, "worktree", "add", "-q", "--detach", later, "main")
        r = gates._resolved_of(row["detail"])
        out = gates._histories_behind(types.SimpleNamespace(run="R-OTHER", store=self.store), r, later)
        self.assertEqual(len(out), 1)
        with open(out[0], encoding="utf-8") as fh:
            self.assertIn("DEPLOY by tester", fh.read())
        self.assertEqual(gates._histories_behind(types.SimpleNamespace(run="R-OTHER", store=self.store), r, later), [])

    def test_a_run_cancelled_at_a_gate_still_teaches_the_agents(self):
        from line.pipeline import learn_after_stop
        from line.statemachine import StateMachine
        self._kh()
        self._start(TG.Team(TG.CODE, TG.FIXED))
        self._decide("spec", "revise", note="the whole card, not only the colours")
        decisions.flush()
        self.kh.rows.clear()
        StateMachine(self.store, "", "").escalate_run(self.run, "CANCELLED", "cancelled: no longer needed", {})
        for name, val in (("enabled", lambda cfg: True), ("_kh", self.kh)):
            p = mock.patch.object(retro, name, val)
            p.start()
            self.addCleanup(p.stop)
        out = learn_after_stop(self._pipe(self.store, self.cfg, self.run))
        self.assertEqual(out["synced"], 1)                             # the person's decision reaches the store
        self.assertTrue(out["retro"]["started"], out)                  # and the retro runs without a sizing

    def test_without_a_store_the_disk_still_keeps_every_decision(self):
        self._start(TG.Team(TG.CODE, TG.FIXED))
        res = gates.decide(self.store, self.cfg, self.run, "spec", {"decision": "revise", "note": "too narrow"}, "ann")
        self.assertEqual(res["recorded"], {"disk": True, "store": False})
        with open(os.path.join(self._pack(), decisions.DIR, decisions.LEDGER), encoding="utf-8") as fh:
            e = json.loads(fh.readline())
        self.assertEqual((e["decision"], e["signal"], e["note"]), ("revise", "negative", "too narrow"))
        self.assertTrue(os.path.isfile(os.path.join(self._pack(), e["documents"]["spec"])))

    def test_signal(self):
        base = {"personas": ["agent-x"], "passed": True}
        self.assertEqual(decisions.signal(base), "positive")
        self.assertEqual(decisions.signal(dict(base, changed=1)), "mixed")
        self.assertEqual(decisions.signal(dict(base, chat_corrections=2)), "mixed")
        self.assertEqual(decisions.signal(dict(base, passed=False)), "negative")
        self.assertEqual(decisions.signal(dict(base, held=True)), "negative")
        self.assertEqual(decisions.signal(dict(base, auto=True)), "auto")
        self.assertEqual(decisions.signal({"passed": True}), "neutral")       # the needs gate judges no agent

    def test_the_retro_takes_findings_for_agents_people_judged(self):
        kh = FakeKh()
        p = mock.patch.object(retro, "_kh", kh)
        p.start()
        self.addCleanup(p.stop)
        personas.for_role("spec_analyst")
        from line.config import load_config
        c = load_config(env={}, line_json=None, rag_local_json=None, llm="cli")
        fx = {"agents": {}, "human_signal": {"agent-spec-analyst": {"negative": 1}}, "actual": {}, "build_rounds": 1}
        v = {"verdict": "right", "findings": [{"persona": "agent-spec-analyst", "action": "new",
                                               "title": "Narrows 'follow design X' to colours",
                                               "evidence": "gate spec revise: 'the whole card, not only colours'",
                                               "rule_change": {"op": "add", "sub_action": "whole reference",
                                                               "content": "follow a named reference in full"}}]}
        out = retro.apply(c, types.SimpleNamespace(run="R1", log=lambda m: None), v, fx, "agent-sizer", "notes")
        self.assertEqual([f["persona"] for f in out["findings"]], ["agent-spec-analyst"])
        self.assertNotIn("dropped", out)


if __name__ == "__main__":
    unittest.main()
