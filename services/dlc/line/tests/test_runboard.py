"""The run board and the run's project messages (line.runboard, line.agent_messages)."""

from __future__ import annotations

import os
import shutil
import tempfile
import types
import unittest
from unittest import mock

from line import agent_messages, runboard
from line.contracts import E_RUN, Run
from line.tests.fakes import make_fakes


class StoreApi:
    """Records the knowledge store calls; answers an inbox with what a person posted."""

    def __init__(self, inbox=()):
        self.calls, self.inbox = [], list(inbox)

    def __call__(self, cfg, method, path, body=None):
        self.calls.append((method, path, body))
        if path == "/messages":
            return {"id": "kh%d" % len(self.calls)}
        if path == "/messages/inbox" or path.startswith("/messages/channel"):
            got = list(self.inbox)              # the channel is read by all, consumed by nobody
            if path == "/messages/inbox":
                self.inbox = []
            return {"messages": got}
        return {}


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.s = self.f.store
        self.s.put(E_RUN, "R2", Run("R2", "/p", state="planning", detail={"name": "bug fix", "retry_of": "R1"}), run="R2")
        self.s.put(E_RUN, "R1", Run("R1", "/p", state="escalated", detail={"name": "bug fix"}), run="R1")
        self.cfg = types.SimpleNamespace()
        self.kh = StoreApi()
        self.p1 = mock.patch("line.agent_memory._call", self.kh)
        self.p2 = mock.patch("line.agent_memory.enabled", return_value=True)
        self.p1.start()
        self.p2.start()
        runboard.register("R2", self.s, self.cfg, "dlc-testarea")

    def tearDown(self):
        runboard.unregister("R2")
        self.p1.stop()
        self.p2.stop()

    def test_one_card_per_step_replaced_in_kh(self):
        runboard.post(self.s, self.cfg, "dlc-testarea", "R2", "tests", "locked", "1 test")
        runboard.post(self.s, self.cfg, "dlc-testarea", "R2", "tests", "locked", "2 tests; use NotesApp/client/x.js")
        self.assertEqual(runboard.board(self.s, "R2")["tests"]["detail"], "2 tests; use NotesApp/client/x.js")
        cards = [b for m, p, b in self.kh.calls if p == "/entities"]
        self.assertEqual({c["name"] for c in cards}, {"run R2 step tests", "run R2"})
        run_card = [c for c in cards if c["name"] == "run R2"][-1]
        self.assertIn({"rel": "retry_of", "target": "run R1"}, run_card["relations"])
        self.assertIn({"rel": "has_step", "target": "run R2 step tests"}, run_card["relations"])

    def test_every_call_gets_this_board_and_the_earlier_attempts(self):
        runboard.post(self.s, self.cfg, "", "R1", "build", "stopped", "U1: failed - needs App.jsx")
        runboard.post(self.s, self.cfg, "", "R2", "plan", "done", "U1 claims App.jsx")
        sec = runboard.section("R2", "builder")
        self.assertIn("## Run board", sec)
        self.assertIn("U1 claims App.jsx", sec)
        self.assertIn("earlier attempt R1", sec)
        self.assertIn("needs App.jsx", sec)
        self.assertEqual(runboard.section("R-unknown", "builder"), "")

    def test_messages_go_through_the_project_tagged_and_reach_each_role_once(self):
        m = agent_messages.post(self.s, self.cfg, "dlc-testarea", "R2", "test_author", ["planner", "builder"], "handoff",
                                "The tests import noteAt from NotesApp/client/noteSelect.js")
        kh = [b for meth, p, b in self.kh.calls if p == "/messages"][0]
        self.assertEqual((kh["receiver"], kh["task_id"], kh["kind"]), ("all", "R2", "handoff"))   # never private
        self.assertTrue(kh["content"].startswith("@planner @builder [run R2 · from test_author]"))
        self.assertEqual(m["kh_id"], "kh1")
        first = agent_messages.deliver(self.s, self.cfg, "dlc-testarea", "R2", "planner")
        self.assertIn("noteSelect.js", first)
        self.assertEqual(agent_messages.deliver(self.s, self.cfg, "dlc-testarea", "R2", "planner"), "")   # once
        self.assertIn("noteSelect.js", agent_messages.deliver(self.s, self.cfg, "dlc-testarea", "R2", "builder"))
        self.assertEqual(agent_messages.deliver(self.s, self.cfg, "dlc-testarea", "R2", "merger"), "")      # not tagged
        self.assertEqual(agent_messages.deliver(self.s, self.cfg, "dlc-testarea", "R2", "test_author"), "")  # own

    def test_a_persons_project_message_for_the_run_reaches_the_tagged_role(self):
        self.kh.inbox = [{"id": "p1", "sender": "rowan@x", "kind": "note", "task_id": "R2",
                          "content": "@builder keep the old button styles"},
                         {"id": "p2", "sender": "rowan@x", "kind": "note", "task_id": "R9", "content": "@builder other run"}]
        got = agent_messages.deliver(self.s, self.cfg, "dlc-testarea", "R2", "builder")
        self.assertIn("from person:rowan@x", got)
        self.assertIn("keep the old button styles", got)
        self.assertNotIn("other run", got)

    def test_the_channel_echo_of_an_engine_message_is_not_taken_twice(self):
        m = agent_messages.post(self.s, self.cfg, "dlc-testarea", "R2", "test_author", ["builder"], "fact", "use x.js")
        self.kh.inbox = [{"id": m["kh_id"], "sender": "local", "kind": "fact", "task_id": "R2",
                          "content": "@builder [run R2 · from test_author] use x.js"}]
        got = agent_messages.deliver(self.s, self.cfg, "dlc-testarea", "R2", "builder")
        self.assertEqual(got.count("use x.js"), 1)
        self.assertEqual(len(agent_messages.thread(self.s, "R2")), 1)
        self.assertTrue(any(p.startswith("/messages/channel?") for _, p, _ in self.kh.calls))

    def test_agent_tools_post_and_read(self):
        from line import agent_tools
        tok = agent_tools.issue("R2", "builder")
        out = agent_tools.handle(self.cfg, "post_message", tok, {"to": ["merger"], "kind": "fact",
                                                                  "text": "I had to add NotesApp/client/noteSelect.js"})
        self.assertIn("@merger", out["text"])
        runboard.post(self.s, self.cfg, "", "R2", "plan", "done", "U1 claims X")
        self.assertIn("U1 claims X", agent_tools.handle(self.cfg, "read_board", tok, {})["text"])
        agent_tools.revoke(tok)


class ClaimsFromTestsTest(unittest.TestCase):
    def test_files_a_locked_test_names_join_its_unit_claims(self):
        from line.pipeline import Pipeline
        d = tempfile.mkdtemp(prefix="dlc-claims-")
        try:
            os.makedirs(os.path.join(d, "tests", "acceptance"))
            os.makedirs(os.path.join(d, "NotesApp", "client"))
            with open(os.path.join(d, "tests", "acceptance", "test_f1.py"), "w", encoding="utf-8") as fh:
                fh.write('JS = "import { noteAt } from \'./NotesApp/client/noteSelect.js\'"\n'
                         'APP = os.path.join(ROOT, "NotesApp", "client", "App.jsx")\n'
                         'OTHER = "NotesApp/server/app.js"\n')
            p = Pipeline.__new__(Pipeline)
            p.repo, p.run = d, "R1"
            p.log = lambda m: None
            uses = p._test_uses([types.SimpleNamespace(path="tests/acceptance/test_f1.py")])
            self.assertEqual(uses["tests/acceptance/test_f1.py"],
                             ["NotesApp/client/noteSelect.js", "NotesApp/client/App.jsx"])   # server/ does not exist
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
