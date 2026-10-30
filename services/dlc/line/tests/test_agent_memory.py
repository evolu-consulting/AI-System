"""The agents' working memory (line.agent_memory) against a fake knowledge store: turn context, the memory
tools, the action menu seed and the engine's worklog per agent call."""

from __future__ import annotations

import types
import unittest
from unittest import mock

from line import agent_memory


class Store:
    """Answers the store routes the agents use and remembers every call."""

    def __init__(self):
        self.calls, self.actions, self.consented = [], {}, True

    def __call__(self, cfg, method, path, body=None, headers=None):
        self.calls.append((method, path, body))
        if path.startswith("/turn/context"):
            return 200, {"text": "TURN CONTEXT - computed by the hook for this message. ...\nPROJECT: p1\n"
                                 "ACTIONS for p1 (pick a label or none; if one fits, GET /policy/plan?action=<label>"
                                 "&project=p1 and follow it):\n  - 'build unit': Builder\nFINDINGS (p1): \n  - \n"
                                 "  - \nKH LESSONS: none above the floor for the raw message."}, {}
        if path == "/vector/query":
            near = {("findings", "p1"): [("vec_f1", 0.81, "FINDING [tests]: test_c16 asserted git diff HEAD\nlong "
                                                         "body"), ("vec_f0", 0.41, "FINDING [x]: unrelated")],
                    ("knowledge", "p1"): [("vec_l1", 0.66, "LESSON [builder]: run unittest from the root. Why: ...")],
                    ("knowledge", "dlc"): [("vec_s1", 0.92, "LESSON [test_author]: never assert on git diff HEAD. "
                                                             "Why: the line commits first.")]}
            rows = near.get((body["scope"], body["project"]), [])
            return 200, {"hits": [{"vector_id": v, "score": s, "source_text": t} for v, s, t in rows]}, {}
        if path == "/context/step":
            return 200, {"items": [{"id": "vec_1", "tier": "knowledge", "score": 0.8, "text": "LESSON: run tests "
                                    "with python -m unittest", "truncated": True, "text_len": 900}],
                         "open_threads": [{"kind": "newer-log", "hint": "check it", "ids": ["vec_9"]}]}, {}
        if path.startswith("/policy/actions"):
            return 200, {"actions": list(self.actions.values())}, {}
        if path == "/policy/action/set":
            self.actions[body["action"]] = body
            return 200, body, {}
        if path.startswith("/policy/plan"):
            return 200, {"rules": [{"seq": 1, "sub_action": "first", "content": "do this"}]}, {}
        if path.startswith("/distill/cursor"):
            return 200, {"project": "p1", "consented": self.consented}, {}
        if path == "/vector/scroll":
            if "vec_d1" in body.get("ids", []):          # a row of the read-only design library only
                hits = [{"vector_id": "vec_d1", "source_text": "STYLE 44 spec"}] if (
                    body["project"], body["scope"]) == ("designer", "knowledge") else []
                return 200, {"hits": hits}, {}
            return 200, {"hits": [{"vector_id": "vec_1", "source_text": "the whole row"}]}, {}
        return 200, {"status": "ok"}, {}


def cfg():
    return types.SimpleNamespace(rag="http", rag_url="http://store", rag_timeout_s=5,
                                 rag_extra={"project": "p1", "shared_project": "dlc"}, rag_shared_project="dlc")


class AgentMemoryTest(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        p = mock.patch("line.ragmap._http", self.store)
        p.start()
        self.addCleanup(p.stop)
        agent_memory._seeded = False

    def test_turn_context_kernel_menu_and_shared_lessons(self):
        t = agent_memory.turn_context(cfg(), "builder", "Implement unit U1")
        self.assertIn("step_context", t)                                   # the kernel
        self.assertIn("call follow_plan with it", t)                       # endpoint wording replaced
        self.assertNotIn("/policy/plan", t)
        self.assertNotIn("FINDINGS (p1)", t)                               # the store's first-five list is gone
        # recall: nearest first, title only, below the floor left out, every source asked by similarity
        block = t[t.index("FINDINGS AND LESSONS near this task"):]
        lines = [x for x in block.splitlines()[1:] if x.startswith("  - ")]
        self.assertEqual([x.split()[1] for x in lines], ["vec_s1", "vec_f1", "vec_l1"])
        self.assertIn("vec_s1 (knowledge, 0.92): LESSON [test_author]: never assert on git diff HEAD.", block)
        self.assertNotIn("long body", block)
        self.assertNotIn("vec_f0", block)
        asked = [(c[2]["scope"], c[2]["project"], c[2].get("where")) for c in self.store.calls if c[1] == "/vector/query"]
        self.assertEqual(asked, [("findings", "p1", None), ("knowledge", "p1", {"kind": "lesson"}),
                                 ("knowledge", "dlc", None)])
        self.assertLess(len(t), agent_memory.TURN_CHARS + len(agent_memory.KERNEL) + 10)
        # the menu is seeded once per process, then left alone
        self.assertEqual(set(self.store.actions), {p["action"] for p in agent_memory.POLICIES})
        n = len(self.store.calls)
        agent_memory.turn_context(cfg(), "builder", "again")
        self.assertFalse(any(c[1] == "/policy/action/set" for c in self.store.calls[n:]))

    def test_tools(self):
        sc = {"rag_project": "p1", "role": "builder", "run": "R1"}
        out = agent_memory.handle(cfg(), sc, "step_context", {"text": "how are tests run"})
        self.assertIn("read_items", out)                                   # truncated rows say how to read them
        self.assertIn("open thread newer-log", out)
        self.assertIn("the whole row", agent_memory.handle(cfg(), sc, "read_items", {"ids": ["vec_1"]}))
        # a row that is not in the run's project: the shared lessons, then the design library
        n = len(self.store.calls)
        self.assertIn("STYLE 44 spec", agent_memory.handle(cfg(), sc, "read_items", {"ids": ["vec_d1"]}))
        asked = [(c[2]["project"], c[2]["scope"]) for c in self.store.calls[n:] if c[1] == "/vector/scroll"]
        self.assertEqual(asked[0], ("p1", "knowledge"))
        self.assertEqual(asked[-1], ("designer", "knowledge"))
        self.assertIn(("dlc", "knowledge"), asked)
        self.assertIn("do this", agent_memory.handle(cfg(), sc, "follow_plan", {"action": "build unit"}))
        agent_memory.handle(cfg(), sc, "record_finding", {"text": "Symptom: x fails. Cause: y. Fix: z."}, tok="t1")
        method, path, body = self.store.calls[-1]
        self.assertEqual((path, body["scope"], body["metadata"]["project"], body["metadata"]["scope"]),
                         ("/vector/add", "findings", "p1", "findings"))
        with self.assertRaises(ValueError):
            agent_memory.handle(cfg(), sc, "save_lesson", {"text": "short"})

    def test_engine_worklog_unless_the_agent_wrote_one(self):
        agent_memory.call_worklog(cfg(), "builder", "R1", "U1", "SUBMIT", "Added age_utils.py; 6 tests pass.", 0.12,
                                  tok="a")
        body = self.store.calls[-1][2]
        self.assertEqual((body["scope"], body["metadata"]["topic"]), ("log", "agent builder"))
        self.assertIn("6 tests pass", body["text"])
        sc = {"rag_project": "p1", "role": "builder", "run": "R1"}
        agent_memory.handle(cfg(), sc, "write_worklog", {"text": "I did the unit and its tests pass."}, tok="b")
        n = len(self.store.calls)
        agent_memory.call_worklog(cfg(), "builder", "R1", "U1", "SUBMIT", "text", 0.1, tok="b")
        self.assertEqual(len(self.store.calls), n)                         # not twice

    def test_distil_after_run_once_per_project(self):
        import os
        import tempfile
        import threading
        gate, calls = threading.Event(), []

        def agentic(role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
            calls.append((role, prompt, run))
            gate.wait(5)

        pipe = types.SimpleNamespace(cfg=cfg(), run="R1", llm=types.SimpleNamespace(agentic=agentic), log=print)
        with mock.patch.dict(os.environ, {"DLC_HOME": tempfile.mkdtemp()}):
            self.assertTrue(agent_memory.distil_after_run(pipe))
            self.assertFalse(agent_memory.distil_after_run(pipe))        # one distiller per project at a time
            gate.set()
            for _ in range(50):
                if not agent_memory._distilling:
                    break
                threading.Event().wait(0.05)
        self.assertEqual(len(calls), 1)
        role, prompt, run = calls[0]
        self.assertEqual((role, run), ("distiller", "R1"))
        self.assertIn("http://store/distill/next?project=p1", prompt)
        self.assertIn("'dlc'", prompt)                                   # shared lessons go to the pool
        with mock.patch.dict(os.environ, {"LINE_AGENT_LEARN": "0"}):
            self.assertFalse(agent_memory.distil_after_run(pipe))

    def test_distil_asks_consent_before_the_model_call(self):
        import os
        import tempfile
        import threading
        self.store.consented = False
        calls, logs = [], []
        pipe = types.SimpleNamespace(cfg=cfg(), run="R1", log=logs.append,
                                     llm=types.SimpleNamespace(agentic=lambda *a, **k: calls.append(a)))
        with mock.patch.dict(os.environ, {"DLC_HOME": tempfile.mkdtemp()}):
            agent_memory.distil_after_run(pipe)
            for _ in range(50):
                if not agent_memory._distilling:
                    break
                threading.Event().wait(0.05)
        self.assertEqual(calls, [])                                      # no consent: no model call
        self.assertIn("/distill/cursor?project=p1", [c[1] for c in self.store.calls])
        self.assertIn("no consent", logs[-1])

    def test_one_shot_writers_get_the_near_lessons_and_readers_do_not(self):
        b = agent_memory.lessons_block(cfg(), "test_author", "Turn every acceptance criterion into a unittest test")
        self.assertIn("vec_s1 (knowledge, 0.92): LESSON [test_author]: never assert on git diff HEAD.", b)
        self.assertNotIn("follow_plan", b)                    # no tools in a one-shot call: no kernel, no menu
        self.assertEqual(agent_memory.lessons_block(cfg(), "reader_a", "read the spec"), "")
        from line.llm import cli
        with mock.patch("line.hooks.agent_instructions", return_value=""):
            self.assertIn("never assert on git diff HEAD", cli.with_hooks("test_author", "P", cfg()))
            self.assertEqual(cli.with_hooks("reader_b", "P", cfg()), "P")

    def test_a_real_one_shot_call_carries_the_lessons(self):
        import tempfile
        from line.llm import cli
        sent = []

        def run(self_, argv, prompt, cwd, model, timeout, role):
            sent.append((role, prompt))
            return {"result": "{}"}, {"usd": 0.0, "usage": {}, "model": model}

        c = cfg()
        c.workroot = tempfile.mkdtemp()
        with mock.patch.object(cli.CliBackend, "_run", run), mock.patch("line.hooks.agent_instructions", return_value=""):
            b = cli.CliBackend(c, command="claude")
            b.raw_complete("test_author", "Turn every acceptance criterion into a unittest test", "m", "F1")
            b.raw_complete("reader_a", "Read the spec", "m", "A")
        self.assertIn("never assert on git diff HEAD", sent[0][1])          # through raw_complete, not a helper
        self.assertEqual(sent[1][1], "Read the spec")

    def test_findings_and_lessons_are_stored_title_first(self):
        sc = {"rag_project": "p1", "role": "retro", "run": "R1"}
        agent_memory.handle(cfg(), sc, "save_lesson", {"title": "Test author: never assert on git diff HEAD",
                                                       "text": "LESSON: assert behaviour. Why: the line commits.",
                                                       "subject": "acceptance tests"})
        agent_memory.handle(cfg(), sc, "record_finding", {"text": "test_c16 failed on committed code. Cause: it read "
                                                                  "the working tree.", "subject": "U1"})
        a, b = [c[2]["text"] for c in self.store.calls if c[1] == "/vector/add"]
        self.assertEqual(a, "LESSON [acceptance tests]: Test author: never assert on git diff HEAD\n"
                            "assert behaviour. Why: the line commits.")
        self.assertEqual(b, "FINDING [U1]: test_c16 failed on committed code\nCause: it read the working tree.")
        self.assertEqual(agent_memory.title_of(a), "LESSON [acceptance tests]: Test author: never assert on git diff "
                                                   "HEAD")

    def test_shared_lesson_goes_to_the_pool(self):
        sc = {"rag_project": "p1", "role": "retro", "run": "R1"}
        agent_memory.handle(cfg(), sc, "save_lesson", {"text": "LESSON: a rule that holds anywhere. Why: x.",
                                                       "share": True})
        agent_memory.handle(cfg(), sc, "save_lesson", {"text": "LESSON: a rule of this project only. Why: y."})
        adds = [c[2] for c in self.store.calls if c[1] == "/vector/add"]
        self.assertEqual([(a["metadata"]["project"], a["metadata"]["kind"]) for a in adds],
                         [("dlc", "lesson"), ("p1", "lesson")])

    def test_retro_after_a_failed_run(self):
        import os
        import tempfile
        from line import codes
        from line.contracts import E_ESCALATION, E_RUN, Envelope
        from line.tests.fakes import FakeStore

        st = FakeStore()
        st.put(E_RUN, "R1", {"id": "R1", "state": "escalated", "detail": {}}, run="R1")
        st.put(E_ESCALATION, "R1:e", {"id": "R1:e", "run": "R1", "code": codes.NO_PROGRESS,
                                       "message": "unit U1 failed: unit U1 escalated (repeat)"}, run="R1")
        env = lambda: Envelope(run="R1", unit="U1", attempt=1, agent_version="v", model="m", spec_hash="h")  # noqa: E731
        st.emit(codes.UNIT_BLOCKED, env(), {"reason": "test_c16 asserts age_utils.py in `git diff HEAD`, which "
                                                      "the harness commit empties"})
        st.emit(codes.UNIT_STATE, env(), {"from": "ready", "to": "leased"})          # noise, left out
        calls = []

        def agentic(role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
            calls.append((role, prompt, run))
            return types.SimpleNamespace(outcome="SUBMIT", usd=0.2, text="cause ... SUBMIT")

        pipe = types.SimpleNamespace(cfg=cfg(), run="R1", store=st, repo="C:/t", log=print,
                                     llm=types.SimpleNamespace(agentic=agentic))
        with mock.patch.dict(os.environ, {"DLC_HOME": tempfile.mkdtemp()}):
            out = agent_memory.retro_after_failure(pipe, wait=True)
        self.assertEqual(out["outcome"], "SUBMIT")
        (role, prompt, run), = calls
        self.assertEqual((role, run), ("retro", "R1"))
        for part in ("NO_PROGRESS", "unit.blocked [U1]", "git diff HEAD", "record_finding", "share true"):
            self.assertIn(part, prompt)
        self.assertNotIn('"to": "leased"', prompt)
        # a person's decision teaches nothing
        st.put(E_ESCALATION, "R1:e", {"id": "R1:e", "run": "R1", "code": codes.CANCELLED, "message": "x"}, run="R1")
        self.assertFalse(agent_memory.retro_after_failure(pipe)["started"])

    def test_off_without_a_store(self):
        off = types.SimpleNamespace(rag="off", rag_url="", rag_extra={})
        self.assertEqual(agent_memory.turn_context(off, "builder", "x"), "")
        self.assertEqual(self.store.calls, [])


if __name__ == "__main__":
    unittest.main()
