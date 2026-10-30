"""line.gates: the gated Enhancement / Bug Fix flow (design docs/flow-enhance_bugfix.html, steps 4-13)."""

from __future__ import annotations

import base64
import os
import shutil
import tempfile
import unittest

from line import attention, gates, solo

SPEC_ROLE, DOMAIN_ROLE, QC_ROLE = "spec_analyst", "domain_agent", "test_author"   # the seed definition's roles
from line.config import load_config
from line.contracts import E_RUN, LlmResult
from line.llm import make_llm
from line.pipeline import Pipeline, init_target
from line.statemachine import update_row
from line.store import SqliteStore
from line.tests.test_docread import make_docx, para

CODE = {"calc.py": "def add(a, b):\n    return a - b\n",
        "tests/__init__.py": "",
        "tests/test_calc.py": "import unittest\nfrom calc import add\n\n\nclass T(unittest.TestCase):\n"
                              "    def test_TC1_add(self):\n        self.assertEqual(add(2, 3), 5)\n"}
FIXED = {"calc.py": "def add(a, b):\n    return a + b\n"}
DOCS = {SPEC_ROLE: "thinking...\n# Spec: add\n## Summary\nadd numbers\n## Domains\n- calculator: F1\n"
                         "## Questions\nnone\nSUBMIT",
        DOMAIN_ROLE: "# Implement plan\n## Blast radius\ncalc.py\n## Steps\n1. add()\nSUBMIT",
        QC_ROLE: "# Test plan\n## Test cases\n| TC1 | F1 | new | EP | add(2,3) | 5 | P1 |\nSUBMIT"}


CHAT_REPLY = ("Hiểu rồi: thêm số âm. Tôi đã sửa spec (F2, Q1).\n"
              "=== DOCUMENT spec ===\n# Spec: add\n## At a glance\nUnderstood:\n- add two numbers, negatives too\n"
              "Will do:\n- add(), negatives\nWill not do:\n- floats (Q2)\n## Summary\nadd numbers\n"
              "## Domains\n- calculator: F1\n## Questions\n| Q | question | status | answer |\n|---|---|---|---|\n"
              "| Q1 | negatives? | settled | yes, the person at the gate |\n"
              "| Q2 | floats too? | open | the request does not say |\n"
              "| Q3 | max value? | proposed | no limit |\n=== END ===\nSUBMIT")


def cfg(**kw):
    return load_config(env={}, line_json=None, rag_local_json=None, **kw)


def write(root, rel, text):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


class Team:
    """Spec / Domain / QC agents answer their documents; the build agent writes one dict of files per round."""
    name = "team"
    overhead_tokens = 0

    def __init__(self, *rounds):
        self.rounds, self.calls = list(rounds), []

    def raw_complete(self, role, prompt, model, key, repair=False):
        return LlmResult(None, "{}", {"input": 1, "output": 1}, 0.01, model, "")

    def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
        self.calls.append((role, key, prompt))
        if "THE PERSON'S NEW MESSAGE" in prompt:                 # a chat at the gate (line.gatechat)
            return LlmResult(None, CHAT_REPLY, {"input": 1, "output": 1}, 0.05, model, "SUBMIT")
        if role in DOCS:
            write(workdir, "scratch.txt", "an agent that writes here changes nothing on main")
            return LlmResult(None, DOCS[role], {"input": 1, "output": 1}, 0.1, model, "SUBMIT")
        for rel, text in (self.rounds.pop(0) if self.rounds else {}).items():
            write(workdir, rel, text)
        return LlmResult(None, "done\nDECISIONS:\n- rounding: none needed\nSUBMIT", {"input": 1, "output": 1}, 0.2,
                         model, "SUBMIT")


class GatedFlowTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="gates-")
        self.pack = os.path.join(self.work, "pack")
        write(self.pack, "spec.md", "# Add\n\nA function add(a, b) in calc.py returning a + b, with tests.\n")
        write(self.pack, "pack.json", '{"id": "calc", "title": "Calc", "kind": "enhance", "files": ["spec.md"]}')

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def _start(self, backend, flow="enhancement", **kw):
        c = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                solo="1", max_usd_run=20, deploy_windows=[], **kw)
        self.store = SqliteStore(c.db)
        self.cfg = c
        self.target = init_target(os.path.join(self.work, "target"))
        self.backend = backend
        p = Pipeline(self.store, c, llm=make_llm(c, self.store, backend=backend))
        self.run = p.admit(self.pack, self.target)
        update_row(self.store, E_RUN, self.run, {"detail": dict(self.store.get(E_RUN, self.run)["detail"], level="2",
                                                                flow=flow)})
        return self._drive()

    def _drive(self):
        p = Pipeline(self.store, self.cfg, llm=make_llm(self.cfg, self.store, backend=self.backend))
        return p.drive(self.run)

    def _decide(self, gate, decision, **body):
        out = gates.decide(self.store, self.cfg, self.run, gate, dict(body, decision=decision), "tester")
        self.assertTrue(out["resume"])
        return self._drive()

    def roles(self):
        return [r for r, *_ in self.backend.calls]

    def test_the_whole_flow_with_revisions(self):
        row = self._start(Team(CODE, FIXED))
        self.assertNotIn(row["state"], ("green", "escalated"))
        a = attention.view(self.store, self.run)
        self.assertEqual((a["kind"], a["gate"]["name"], a["gate"]["step"]), ("gate", "spec", 5))
        self.assertTrue(a["gate"]["docs"][0]["text"].startswith("# Spec: add"))   # the agent's preamble is cut
        self.assertEqual(self.roles(), [SPEC_ROLE])

        again = self._drive()                                    # a resume without a decision costs nothing
        self.assertEqual(again["detail"]["gate"]["name"], "spec")
        self.assertEqual(self.roles(), [SPEC_ROLE])
        with self.assertRaises(ValueError):
            gates.decide(self.store, self.cfg, self.run, "plan", {"decision": "approve"})   # not the open gate
        with self.assertRaises(ValueError):
            gates.decide(self.store, self.cfg, self.run, "spec", {"decision": "revise"})    # revise says what

        doc = base64.b64encode(make_docx(para("Field Y must have 5 digits"))).decode()
        row = self._decide("spec", "revise", note="also handle negative numbers",
                           files=[{"name": "rules.docx", "data": doc}])
        self.assertEqual(self.roles(), [SPEC_ROLE, SPEC_ROLE])
        prompt = self.backend.calls[1][2]
        self.assertIn("also handle negative numbers", prompt)
        attached = row["detail"]["gated"]["log"][0]["files"][0]["path"]
        self.assertIn(attached, prompt)
        with open(attached, encoding="utf-8") as fh:
            self.assertIn("Field Y must have 5 digits", fh.read())
        self.assertEqual(row["detail"]["gate"]["round"], 2)

        row = self._decide("spec", "approve")
        self.assertEqual(row["detail"]["gate"]["name"], "plan")
        self.assertEqual(sorted(self.roles()[2:]), sorted([DOMAIN_ROLE, QC_ROLE]))   # 6 and 7 together
        self.assertIn("calculator", next(p for r, _k, p in self.backend.calls if r == DOMAIN_ROLE))
        plan_view = attention.view(self.store, self.run)["gate"]
        self.assertEqual([d["id"] for d in plan_view["docs"]][:2], ["impl", "tests"])

        row = self._decide("plan", "revise", target="tests", note="add a boundary case")
        self.assertEqual(self.roles()[4:], [QC_ROLE])                 # only the test plan again
        self.assertIn("add a boundary case", self.backend.calls[4][2])

        row = self._decide("plan", "approve")
        self.assertEqual(row["detail"]["gate"]["name"], "final", row["detail"].get("escalation"))
        build = [(r, k, p) for r, k, p in self.backend.calls if r in (solo.ROLE, solo.LEAD_ROLE)]
        self.assertEqual([k for _r, k, _p in build], ["gated#0", "gated#1"])
        self.assertIn("THE PERSON-APPROVED WORK", build[0][2])
        self.assertIn("# Test plan", build[0][2])
        self.assertIn("ROUND 1 OF 3 FAILED", build[1][2])
        rounds = row["detail"]["gated"]["build"]["rounds"]
        self.assertEqual([(r.get("failed"), r.get("qas")) for r in rounds], [("suite", None), (None, "green")])
        final = attention.view(self.store, self.run)["gate"]
        self.assertIn("R1", final["docs"][1]["text"])
        self.assertIn("rounding", final["docs"][1]["text"])                 # the agent's decision is a finding

        row = self._decide("final", "hold", note="D1: correct; round 1 was a missing sign")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        self.assertNotIn("gate", row["detail"])
        self.assertIn("held by tester", row["detail"]["delivered"]["skipped"])
        review = row["detail"]["outcomes"]["human_review"]
        self.assertEqual(review["decision"], "hold")
        self.assertIn("missing sign", review["solutions"])
        with open(os.path.join(self.target, "calc.py"), encoding="utf-8") as fh:
            self.assertIn("a + b", fh.read())
        self.assertFalse(os.path.exists(os.path.join(self.target, "scratch.txt")))

    def test_rounds_run_out_and_the_run_stops_for_a_person(self):
        self._start(Team(CODE, {}, {}), gate_rounds=2)
        self._decide("spec", "approve")
        row = self._decide("plan", "approve")
        self.assertEqual(row["state"], "escalated")
        self.assertIn("after 2 round(s)", row["detail"]["escalation"]["message"])
        self.assertEqual(len([r for r, *_ in self.backend.calls if r in (solo.ROLE, solo.LEAD_ROLE)]), 2)

    def test_a_retry_keeps_the_approvals_and_builds_again_in_the_same_run(self):
        from line.reopen import reopen
        self._start(Team(CODE, {}, {}), gate_rounds=2)
        self._decide("spec", "approve")
        row = self._decide("plan", "approve")
        self.assertEqual(row["state"], "escalated")
        out = reopen(self.store, self.cfg, self.run, "add() must return a + b.", "rowan")
        self.assertEqual(out["attempt"], 2)
        self.backend = Team(dict(CODE, **FIXED))
        row = self._drive()
        self.assertEqual(row["detail"]["gate"]["name"], "final", row["detail"].get("escalation"))   # spec, plan kept
        self.assertEqual([r for r, *_ in self.backend.calls if r in (SPEC_ROLE, DOMAIN_ROLE, QC_ROLE)], [])
        build = row["detail"]["gated"]["build"]
        self.assertEqual((len(build["earlier"][0]), build["rounds"][-1].get("qas")), (2, "green"))
        prompt = [p for r, _k, p in self.backend.calls if r in (solo.ROLE, solo.LEAD_ROLE)][0]
        self.assertIn("add() must return a + b.", prompt)
        row = self._decide("final", "deploy")
        self.assertEqual((row["state"], row["id"]), ("green", self.run))

    def test_chat_at_the_gate_and_answers_to_each_point(self):
        from line import gatechat
        self._start(Team(CODE, FIXED))
        g = attention.view(self.store, self.run)["gate"]
        self.assertEqual((g["chat"], g["messages"], g["asks"]), (True, [], []))
        started = []
        out = gatechat.post(self.store, self.cfg, self.run, "spec", {"message": "Còn số âm thì sao?", "who": "ann"},
                            start=started.append)
        self.assertEqual([m["who"] for m in out["messages"]], ["person", "agent"])
        self.assertEqual(out["messages"][1]["state"], "thinking")
        with self.assertRaises(ValueError):                                # one answer at a time
            gatechat.post(self.store, self.cfg, self.run, "spec", {"message": "and?"})

        def pipe(store, c, run):
            p = Pipeline(store, c, llm=make_llm(c, store, backend=self.backend))
            row = store.get(E_RUN, run)
            p.run = run
            p._setup(row)
            p.repo = row["detail"]["target"]
            return p
        reply = gatechat.answer(self.store, self.cfg, self.run, "spec", out["messages"][1]["id"], make_pipe=pipe)
        self.assertEqual((reply["state"], reply["edited"]), ("done", ["spec"]), reply)
        self.assertTrue(reply["text"].startswith("Hiểu rồi"))
        prompt = self.backend.calls[-1][2]
        self.assertIn("Còn số âm thì sao?", prompt)
        self.assertIn("# Spec: add", prompt)                              # its own document
        g = attention.view(self.store, self.run)["gate"]
        spec = g["docs"][0]
        self.assertIn("negatives too", spec["text"])                      # changed in place, same round
        self.assertEqual(spec["glance"]["will_not"], ["floats (Q2)"])
        self.assertEqual([(a["id"], a["status"]) for a in g["asks"]], [("Q2", "open"), ("Q3", "proposed")])
        self.assertEqual(g["round"], 1)

        with self.assertRaises(ValueError):                                # an open point needs the person's words
            gates.decide(self.store, self.cfg, self.run, "spec", {"decision": "approve", "answers": [
                {"artifact": "spec", "id": "Q2", "ok": True}]})
        with self.assertRaises(ValueError):
            gates.decide(self.store, self.cfg, self.run, "spec", {"decision": "approve", "answers": [
                {"artifact": "spec", "id": "Q9", "ok": True}]})
        row = self._decide("spec", "approve", answers=[{"artifact": "spec", "id": "Q2", "ok": False,
                                                        "text": "no floats"},
                                                       {"artifact": "spec", "id": "Q3", "ok": True}])
        d = row["detail"]["gated"]["log"][0]
        self.assertIn("spec Q2: CHANGED by the person (floats too?) -> no floats", d["note"])
        self.assertIn("spec Q3: accepted as proposed", d["note"])
        self.assertEqual(len(d["answers"]), 2)
        plan = next(p for r, _k, p in self.backend.calls if r == DOMAIN_ROLE)
        self.assertIn("no floats", plan)                                   # the answers reach the next agents
        with self.assertRaises(ValueError):                                # the spec gate is closed now
            gatechat.post(self.store, self.cfg, self.run, "spec", {"message": "late"})

    def test_new_system_and_switched_off_are_not_gated(self):
        row = self._start(Team(CODE, FIXED), flow="new-system")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        self.assertNotIn("gated", row["detail"])

    def test_gates_off(self):
        row = self._start(Team(CODE, FIXED), gates="0")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        self.assertNotIn(SPEC_ROLE, self.roles())


if __name__ == "__main__":
    unittest.main()
