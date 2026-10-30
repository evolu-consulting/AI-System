"""The combined PM + dev flow, driven end to end with scripted agents (no LLM, no KH).

  python -m unittest discover -s tests
"""

import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ["SDLC_DB"] = os.path.join(tempfile.mkdtemp(), "flow.db")

import db  # noqa: E402
import engine  # noqa: E402
import gov  # noqa: E402
import kh  # noqa: E402
import seed  # noqa: E402

# KH is the agents' memory, never a gate: silence it for the tests.
for name in ("add_log", "add_knowledge", "message", "ensure_project"):
    setattr(kh, name, lambda *a, **k: None)
kh.recent = lambda *a, **k: []
engine.toolbox.catalogue = lambda d: ({"tools": []}, None)


def done(payload):
    return "Finished.\nSTEP_DONE\n```json\n%s\n```" % json.dumps(payload)


class Script:
    """Replies by step role; review fails the first time it runs, as a real reviewer might."""

    def __init__(self):
        self.calls = []
        self.review_runs = 0

    def __call__(self, step, agent, env, prompt, ctx, project, resume=None):
        self.calls.append((ctx["group_slug"], agent["name"]))
        db.usage_set(db.usage_start(step["run_id"], step["id"], agent["id"], "sonnet"),
                     {"model": "sonnet", "input": 10, "output": 10, "cacheWrite": 0, "cacheRead": 0, "costUsd": 0.01, "final": 1})
        role = ctx["role"]
        if role == "intake":
            if "nobody has spoken yet" in prompt:
                return "Hello. Questions: 1) ...\nNEED_HUMAN", "sess-" + agent["id"], None
            return done({"summary": "scope agreed", "scope": [{"id": "S1", "text": "list --status done shows done items",
                                                               "acceptance": "repro passes"}],
                         "decisions": [{"title": "fix in todo.py only", "why": "smallest change"}],
                         "risks": [{"title": "filters regress", "probability": 4, "impact": 4, "mitigation": "", "owner": "PM Agent"}]}), "s", None
        if role == "review":
            self.review_runs += 1
            if self.review_runs == 1:
                return done({"summary": "inverted condition still in list()", "verdict": "fail",
                             "defects": [{"title": "status filter inverted", "severity": "high", "file": "todo.py:143"}]}), "s", None
            return done({"summary": "looks right", "verdict": "pass"}), "s", None
        if role == "test":
            return done({"summary": "all green", "verdict": "pass", "tests": {"command": "x", "passed": True},
                         "trace": [{"scope": "S1", "test": "tests/test_todo.py::test_status", "passed": True}]}), "s", None
        if role == "close":
            return done({"summary": "released", "lessons": ["write the regression test first"],
                         "risks": [{"title": "Filters regress!", "probability": 2, "impact": 2, "mitigation": "tests"}],
                         "actions": [{"title": "tell support"}]}), "s", None
        return done({"summary": "did %s" % ctx["group_slug"], "tests": {"command": "x", "passed": True}}), "s", None


class FlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init_db()
        seed.seed()

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.flag = os.path.join(self.folder, "fail.flag")
        cmd = '"%s" -c "import os,sys; sys.exit(1 if os.path.exists(r\'%s\') else 0)"' % (sys.executable, self.flag)
        self.project = db.create_project("P %s" % id(self), self.folder, owner="rowan", test_command=cmd)
        self.script = Script()
        engine.metered_call = self.script
        engine.wake = lambda pid: None

    def statuses(self, rid):
        return [(s["group_slug"], s["status"]) for s in db.steps_of(rid)]

    def test_bug_fix_flow_with_signoff_rework_and_trace(self):
        rid = db.create_run(self.project["id"], "wf-bug-fix", "BUG-1 inverted filter", owner="rowan")
        engine.execute_run(rid)
        self.assertEqual(db.run_get(rid)["status"], "waiting_human")
        self.assertEqual(db.steps_of(rid)[0]["status"], "waiting_human")

        engine.post_human(rid, "repro: add a, add b, done 1, list --status done", by="rowan")
        self.assertEqual(db.run_get(rid)["status"], "pending")
        engine.execute_run(rid)
        self.assertEqual(db.steps_of(rid)[0]["status"], "awaiting_approval")  # triage needs a lead's approval
        self.assertEqual([s["ref"] for s in gov.scope_items(rid)], ["S1"])

        engine.approve(rid, 1, "rowan", "ok")
        engine.execute_run(rid)
        run = db.run_get(rid)
        self.assertEqual(run["status"], "done", self.statuses(rid))
        self.assertEqual(self.statuses(rid), [
            ("bug-intake", "done"), ("code-read", "done"), ("bug-fix", "done"), ("review", "rework"),
            ("bug-fix", "done"), ("review", "done"), ("test", "done"), ("release", "done")])
        steps = db.steps_of(rid)
        self.assertEqual(steps[4]["attempt"], 2)
        self.assertIn("todo.py:143", db.messages(steps[4]["id"])[0]["content"])  # the rework reason reaches the builder
        self.assertTrue(json.loads(steps[2]["verify_json"])["passed"])
        self.assertEqual(gov.scope_items(rid)[0]["status"], "met")
        kinds = sorted({i["kind"] for i in gov.items(run_id=rid)})
        self.assertEqual(kinds, ["action", "decision", "defect", "lesson", "risk"])
        self.assertEqual(len(gov.items(run_id=rid, kind="risk")), 1)  # repeated by the close step: not filed twice
        risk = gov.items(run_id=rid, kind="risk")[0]
        self.assertEqual((risk["category"], risk["owner"]), (1, "rowan"))  # 4x4 -> cat 1; an agent never owns a risk
        self.assertIn("missing", risk["mitigation"])
        self.assertEqual(gov.items(run_id=rid, kind="decision")[0]["status"], "approved")  # approved with the step
        h = gov.run_health(db.run_public(db.run_get(rid)))
        self.assertEqual(h["rag"], "amber", h)  # done, but a category-1 risk is still open

    def test_server_test_run_is_the_evidence(self):
        gov.save_settings({"maxRework": 1})
        try:
            open(self.flag, "w").close()  # the suite now fails whatever the agents claim
            rid = db.create_run(self.project["id"], "wf-bug-fix", "BUG-2", owner="rowan")
            engine.execute_run(rid)
            engine.post_human(rid, "details", by="rowan")
            engine.execute_run(rid)
            engine.approve(rid, 1, "rowan")
            engine.execute_run(rid)
            run = db.run_get(rid)
            self.assertEqual(run["status"], "failed")
            failed = [s for s in db.steps_of(rid) if s["status"] == "failed"]
            self.assertEqual([(s["group_slug"], s["attempt"]) for s in failed], [("bug-fix", 2)], self.statuses(rid))
            issues = [i["title"] for i in gov.items(run_id=rid, kind="issue")]
            self.assertTrue(any("reported tests passed" in t for t in issues), issues)
            self.assertEqual(gov.run_health(db.run_public(run))["rag"], "red")
        finally:
            gov.save_settings({"maxRework": 2})

    def test_budget_pauses_the_run(self):
        rid = db.create_run(self.project["id"], "wf-bug-fix", "BUG-3", owner="rowan", budget_usd=0.015)
        engine.execute_run(rid)
        engine.post_human(rid, "details", by="rowan")
        engine.execute_run(rid)  # the second paid turn passes the cap -> paused before the next turn
        engine.approve(rid, 1, "rowan")
        engine.execute_run(rid)
        run = db.run_get(rid)
        self.assertEqual((run["status"], run["status_reason"]), ("paused", "budget"))
        self.assertTrue(gov.items(run_id=rid, kind="escalation"))

    def test_waiting_run_does_not_block_the_next_one(self):
        a = db.create_run(self.project["id"], "wf-bug-fix", "BUG-4", owner="rowan")
        b = db.create_run(self.project["id"], "wf-bug-fix", "BUG-5", owner="rowan", priority=1)
        self.assertEqual(engine.next_run(self.project["id"])["id"], b)  # priority 1 first
        engine.execute_run(b)
        self.assertEqual(engine.next_run(self.project["id"])["id"], a)  # b waits for a person; a goes on

    def test_dependency_holds_a_run(self):
        a = db.create_run(self.project["id"], "wf-bug-fix", "BUG-6", owner="rowan", priority=5)
        db.create_run(self.project["id"], "wf-bug-fix", "BUG-7", owner="rowan", priority=1, depends_on=a)
        self.assertEqual(engine.next_run(self.project["id"])["id"], a)

    def test_cancel_and_frozen_process(self):
        rid = db.create_run(self.project["id"], "wf-new-feature", "Feature X", owner="rowan")
        wf = db.workflow_get("wf-new-feature")
        db.save_workflow("wf-new-feature", {"name": wf["name"], "kind": wf["kind"],
                                            "doc": {"nodes": wf["doc"]["nodes"][:2], "edges": [wf["doc"]["edges"][0]]}}, "test")
        self.assertEqual(len(db.run_process(db.run_get(rid))["nodes"]), 8)  # the edit does not touch a started run
        self.assertEqual(db.workflow_get("wf-new-feature")["version"], wf["version"] + 1)
        engine.cancel(rid, "rowan", "not needed")
        self.assertEqual(db.run_get(rid)["status"], "cancelled")
        self.assertTrue(all(s["status"] == "skipped" for s in db.steps_of(rid)))
        db.save_workflow("wf-new-feature", {"name": wf["name"], "kind": wf["kind"], "doc": wf["doc"]}, "test")


class ProcessRulesTest(unittest.TestCase):
    def doc(self, edges, groups=("g-impl", "g-review")):
        return {"nodes": [{"id": "n%d" % i, "groupId": g} for i, g in enumerate(groups)], "edges": edges}

    def test_rework_must_go_back(self):
        with self.assertRaises(ValueError):
            db.process_of(self.doc([{"source": "n0", "target": "n1"}, {"source": "n0", "target": "n1", "kind": "rework"}]))
        p = db.process_of(self.doc([{"source": "n0", "target": "n1"}, {"source": "n1", "target": "n0", "kind": "rework"}]))
        self.assertEqual(p["rework"], {"n1": "n0"})

    def test_reviewer_is_not_the_builder(self):
        gs = {"g-impl": {"name": "Impl", "role": "work", "agentIds": ["a-dev"]},
              "g-review": {"name": "Review", "role": "review", "agentIds": ["a-dev"]}}
        with self.assertRaises(ValueError):
            db.process_of(self.doc([{"source": "n0", "target": "n1"}]), gs)

    def test_risk_category(self):
        self.assertEqual([gov.risk_category(5, 5), gov.risk_category(2, 4), gov.risk_category(2, 2), gov.risk_category(1, 3)], [1, 2, 3, 4])


class UsersTest(unittest.TestCase):
    def test_token_roles(self):
        self.assertTrue(gov.open_mode())
        u = gov.save_user(None, {"name": "lead1", "role": "lead"})
        self.assertFalse(gov.open_mode())
        self.assertEqual(gov.user_by_token(u["token"])["role"], "lead")
        self.assertIsNone(gov.user_by_token("nope"))
        self.assertTrue(gov.rank("lead") > gov.rank("member") > gov.rank("viewer"))
        gov.save_user(u["id"], {"role": "lead", "disabled": True})
        self.assertTrue(gov.open_mode())


if __name__ == "__main__":
    unittest.main()
