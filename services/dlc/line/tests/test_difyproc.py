"""line.difyproc against a fake Dify service API: the process decides, the line executes."""

import json
import os
import tempfile
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from line import difyproc
from line.contracts import E_RUN
from line.pipeline import Escalate
from line.tests.fakes import make_fakes


def _ev(kind, **data):
    return {"event": kind, "workflow_run_id": "WR1", "data": data}


class FakeDify:
    """One process run. Forms are queued as the script says; a submit records the action and moves on."""

    def __init__(self, script):
        self.script = list(script)      # segments: list of events, each segment ends paused or finished
        self.pos = 0
        self.submits = []
        self.started = []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _sse(self, events):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for e in events:
                    self.wfile.write(("data: " + json.dumps(e) + "\n\n").encode())

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
                if self.path == "/v1/workflows/run":
                    fake.started.append(body)
                    self._sse([_ev("workflow_started", id="WR1")] + fake.script[fake.pos])
                elif self.path.startswith("/v1/form/human_input/"):
                    fake.submits.append((self.path.rsplit("/", 1)[1], body["action"], body.get("inputs")))
                    fake.pos += 1
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"{}")

            def do_GET(self):
                if self.path.startswith("/v1/form/human_input/"):
                    tok = self.path.rsplit("/", 1)[1]
                    d = next(e["data"] for seg in fake.script for e in seg
                             if e["event"] == "human_input_required" and e["data"]["form_token"] == tok)
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(json.dumps({"form_content": d["form_content"], "inputs": d["inputs"],
                                                 "user_actions": d["actions"]}).encode())
                    return
                self._sse(fake.script[fake.pos])

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = "http://127.0.0.1:%d" % self.srv.server_address[1]


def form(fid, title, actions, content="", inputs=()):
    return _ev("human_input_required", form_id=fid, form_token="tok-" + fid, node_id="n-" + fid, node_title=title,
               form_content=content, inputs=[{"output_variable_name": i} for i in inputs],
               actions=[{"id": a, "title": a} for a in actions])


PAUSED = _ev("workflow_paused", reasons=[])


class DifyProcTest(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.tmp = tempfile.mkdtemp()
        with open(os.path.join(self.tmp, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("Fix the typo on the login button")

    def pipe(self, dify, flow="bug-fix", **detail):
        cfg = types.SimpleNamespace(process_source="dify", dify_url=dify.url,
                                    dify_flows=json.dumps({"bug-fix": "app-bug", "*": "app-any"}),
                                    dify_timeout_s=10, dify_max_request=8000, max_level=4, solo=1, solo_lead="auto",
                                    workroot=self.tmp, max_usd_call=1.5)
        self.f.store.put(E_RUN, "R1", {"id": "R1", "state": "understanding",
                                       "detail": dict({"flow": flow, "project": "p1"}, **detail)})
        logs = []
        return types.SimpleNamespace(store=self.f.store, run="R1", cfg=cfg, pack=self.tmp, log=logs.append,
                                     _check_cancel=lambda: None, logs=logs)

    def detail(self):
        return self.f.store.get(E_RUN, "R1")["detail"]

    def test_task_run_sets_the_level_and_run_end_answers_it(self):
        dify = FakeDify([
            [_ev("node_finished", node_id="size", title="sizer", node_type="llm", status="succeeded"),
             form("T1", "DLC: run", ["done", "failed"], 'go\n```dlc {"level": 1, "reason": "one file"}```',
                  ["result"]), PAUSED],
            [_ev("workflow_finished", status="succeeded", outputs={"state": "green"})],
        ])
        p = self.pipe(dify)
        sizing = difyproc.size(p)
        self.assertEqual((sizing["level"], sizing["lane"], sizing["by"]), (1, "solo", "dify:bug-fix"))
        self.assertEqual(dify.started[0]["inputs"]["kind"], "bug-fix")
        self.assertEqual(dify.started[0]["inputs"]["request"], "Fix the typo on the login button")
        proc = self.detail()["process"]
        self.assertEqual((proc["workflow_run"], proc["task"]["form"]), ("WR1", "T1"))
        self.assertNotIn("token", difyproc.view(self.f.store, "R1")["process"]["task"])
        # the run ends green: the task is answered done, the follower sees the process finish
        row = self.f.store.get(E_RUN, "R1")
        self.f.store.put(E_RUN, "R1", dict(row, state="green"))
        difyproc.on_run_end(p)
        self.assertEqual(dify.submits[0][:2], ("tok-T1", "done"))
        self.assertEqual(json.loads(dify.submits[0][2]["result"])["state"], "green")
        seg = difyproc.follow(p.cfg, self.f.store, "R1", max_s=5)
        self.assertEqual(seg["status"], "succeeded")
        self.assertEqual(self.detail()["process"]["outcome"]["outputs"], {"state": "green"})

    def test_person_form_is_shown_then_answered_through_the_engine(self):
        approve = form("P1", "Human approval", ["approve", "reject"], "Level 4, approve?")
        dify = FakeDify([
            [approve, PAUSED],
            [form("T1", "DLC: run", ["done", "failed"], '```dlc {"level": 4}```'), PAUSED],
        ])
        p = self.pipe(dify)
        out = {}
        t = threading.Thread(target=lambda: out.update(s=difyproc.size(p)))
        difyproc.POLL_S, old = 1, difyproc.POLL_S
        try:
            t.start()
            for _ in range(50):
                if (self.detail().get("process") or {}).get("pending"):
                    break
                threading.Event().wait(0.1)
            pending = self.detail()["process"]["pending"]
            self.assertEqual(list(pending), ["P1"])
            self.assertNotIn("token", pending["P1"])
            with self.assertRaises(Exception):
                difyproc.answer(p.cfg, self.f.store, "R1", "P1", {"action": "maybe"})
            difyproc.answer(p.cfg, self.f.store, "R1", "P1", {"action": "approve", "who": "rowan"})
            t.join(10)
        finally:
            difyproc.POLL_S = old
        self.assertEqual(out["s"]["level"], 4)
        self.assertEqual(dify.submits[0][:2], ("tok-P1", "approve"))
        self.assertEqual(self.detail()["process"]["answers"][0]["who"], "rowan")

    def test_a_node_owns_its_agent_group(self):
        calls = []

        class Llm:
            def agentic(self, role, work, prompt, turns, usd, key="", run=""):
                calls.append((role, prompt))
                return types.SimpleNamespace(text="%s found 2 risks" % role, usd=0.1)

        dify = FakeDify([
            [form("G1", "DLC: analyse", ["done", "failed"],
                  '```dlc {"agents": ["spec_analyst", "security_reviewer"], "goal": "list the risks"}```',
                  ["result"]), PAUSED],
            [form("T1", "DLC: run", ["done", "failed"], '```dlc {"agents": ["solo", "solo_reviewer"]}```'), PAUSED],
        ])
        p = self.pipe(dify)
        p.llm, p.repo = Llm(), ""
        sizing = difyproc.size(p)
        self.assertEqual([c[0] for c in calls], ["spec_analyst", "security_reviewer"])
        self.assertIn("spec_analyst found 2 risks", calls[1][1])      # the second agent sees the first's work
        self.assertIn("list the risks", calls[0][1])
        self.assertEqual(dify.submits[0][:2], ("tok-G1", "done"))
        self.assertEqual(json.loads(dify.submits[0][2]["result"])["agents"], ["spec_analyst", "security_reviewer"])
        self.assertEqual((sizing["level"], sizing["agents"]), (2, ["solo", "solo_reviewer"]))
        self.assertEqual(self.detail()["process"]["groups"][0]["group"], "analyse")

    def test_a_process_that_ends_first_stops_the_run(self):
        dify = FakeDify([[_ev("workflow_finished", status="succeeded", outputs={"decision": "rejected"})]])
        with self.assertRaises(Escalate) as e:
            difyproc.size(self.pipe(dify))
        self.assertEqual(e.exception.code, "HOOK_STOP")
        self.assertIn("rejected", e.exception.message)

    def test_flow_for_a_process_and_off_by_default(self):
        dify = FakeDify([[]])
        p = self.pipe(dify)
        self.assertEqual(difyproc.app_key(p.cfg, "enhancement"), "app-any")
        self.assertFalse(difyproc.enabled(types.SimpleNamespace(process_source="line", dify_url="x")))
        procs = difyproc.catalog_processes(p.cfg, [{"id": "bug-fix"}])
        self.assertEqual(procs[0]["source"], "dify")


if __name__ == "__main__":
    unittest.main()
