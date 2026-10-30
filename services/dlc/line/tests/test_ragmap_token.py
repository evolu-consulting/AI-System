"""DLC project <-> RAG System project mapping (line.ragmap), the admin-set Claude token (line.claude_token)
and retrieval that reads the run's project before the shared lessons project."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from line import claude_token, ragmap
from line.rag.http_adapter import HttpRagAdapter


class FakeStore:
    """POST /projects, GET /projects, GET/PUT /v1/admin/ns/{ns} with If-Match, like the RAG System."""

    OWN = "store"                         # the source the RAG System gives projects it did not get from DLC

    def __init__(self):
        self.projects = {"dlc": {"role": "project"}, "lesson-learned": {"role": "project"},
                         "old-shop": {"role": "project", "descriptor": "imported history", "source": "AI-SDLC"},
                         "synced-crm": {"role": "project", "descriptor": "synced from another RAG System", "source": FakeStore.OWN},
                         "agent-sizer": {"role": "project", "keywords": ["sizer", "persona"], "source": "AI-SDLC"},
                         "merge-coach": {"role": "project", "keywords": ["Persona"], "source": "AI-SDLC"},
                         "orchestrator": {"role": "directory"}}
        self.asked = []
        self.ignore_source = False        # a store older than `source` ignores ?source= and sends every project
        self.ns = {"projects": ["dlc", "lesson-learned"], "rev": 3}
        store = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body, hdr=None):
                data = json.dumps(body).encode()
                self.send_response(code)
                for k, v in (hdr or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _body(self):
                return json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")

            def do_GET(self):
                if self.path.startswith("/projects"):
                    store.asked.append(self.path)
                    want = self.path.split("source=", 1)[1] if "source=" in self.path and not store.ignore_source else ""
                    return self._send(200, {"projects": {k: v for k, v in store.projects.items()
                                                         if not want or v.get("source", FakeStore.OWN) == want}})
                return self._send(200, store.ns, {"ETag": '"%d"' % store.ns["rev"]})

            def do_POST(self):
                b = self._body()
                store.projects.setdefault(b["id"], {"role": "project", "descriptor": b.get("descriptor", ""),
                                                    "source": b.get("source") or FakeStore.OWN})
                return self._send(200, {"project_id": b["id"]})

            def do_PUT(self):
                if self.headers.get("If-Match") != '"%d"' % store.ns["rev"]:
                    return self._send(412, {"message": "stale"})
                store.ns = {"projects": sorted(set(self._body()["projects"])), "rev": store.ns["rev"] + 1}
                return self._send(200, store.ns)

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = "http://127.0.0.1:%d" % self.srv.server_address[1]


def cfg(url, rag="http"):
    return types.SimpleNamespace(rag=rag, rag_url=url, rag_ns="dlc_line", rag_timeout_s=5,
                                 rag_extra={"project": "dlc"})


class RagMapTest(unittest.TestCase):
    def setUp(self):
        self.kh = FakeStore()
        self.cfg = cfg(self.kh.url)

    def tearDown(self):
        self.kh.srv.shutdown()

    def test_ensure_creates_and_adds_to_namespace_once(self):
        self.assertEqual(ragmap.ensure(self.cfg, "dlc-shop", "Shop", "DLC project 'Shop'"), "")
        self.assertIn("dlc-shop", self.kh.projects)
        self.assertEqual(self.kh.projects["dlc-shop"]["source"], "AI-SDLC")      # DLC says it made the project
        self.assertIn("dlc-shop", self.kh.ns["projects"])
        rev = self.kh.ns["rev"]
        self.assertEqual(ragmap.ensure(self.cfg, "dlc-shop"), "")
        self.assertEqual(self.kh.ns["rev"], rev)                  # already there: no write
        self.assertEqual(self.kh.ns["projects"], ["dlc", "dlc-shop", "lesson-learned"])

    def test_off_or_unreachable_is_a_reason_not_an_error(self):
        self.assertTrue(ragmap.ensure(cfg(self.kh.url, rag="off"), "dlc-x"))
        self.assertTrue(ragmap.ensure(cfg("http://127.0.0.1:9"), "dlc-x"))
        self.assertTrue(ragmap.ensure(self.cfg, "Bad Id"))

    def test_unlinked_lists_imported_projects_only(self):
        self.assertEqual([p["id"] for p in ragmap.unlinked(self.cfg, [])], ["old-shop"])
        self.assertEqual(ragmap.unlinked(self.cfg, ["old-shop"]), [])
        self.assertEqual(self.kh.asked[-1], "/projects?source=AI-SDLC")

    def test_projects_of_another_source_never_show(self):
        self.kh.ignore_source = True
        self.assertEqual([p["id"] for p in ragmap.unlinked(self.cfg, [])], ["old-shop"])
        self.kh.projects["synced-crm"].pop("source")                 # no source at all: not DLC's either
        self.assertEqual([p["id"] for p in ragmap.unlinked(self.cfg, [])], ["old-shop"])

    def test_agent_personas_are_not_offered_as_projects(self):
        self.assertNotIn("agent-sizer", [p["id"] for p in ragmap.unlinked(self.cfg, [])])     # keyword and id
        self.assertNotIn("merge-coach", [p["id"] for p in ragmap.unlinked(self.cfg, [])])     # keyword only
        self.assertTrue(ragmap.is_persona("agent-new-role"))                                  # id only
        self.assertFalse(ragmap.is_persona("old-shop", {"keywords": ["shop"]}))

    def test_run_cfg_reads_project_then_shared(self):
        import dataclasses

        @dataclasses.dataclass
        class C:
            rag: str = "http"
            rag_url: str = "http://x"
            rag_ns: str = "dlc_line"
            rag_extra: dict = dataclasses.field(default_factory=lambda: {"project": "dlc"})

        c = ragmap.run_cfg(C(), "dlc-shop")
        self.assertEqual(c.rag_extra, {"project": "dlc-shop", "shared_project": "dlc"})
        self.assertIs(ragmap.run_cfg(C(rag="off"), "dlc-shop").rag, "off")


class MergedRetrieveTest(unittest.TestCase):
    def test_project_first_then_shared_within_budget(self):
        a = HttpRagAdapter("http://x", "dlc_line", extra={"project": "dlc-shop", "shared_project": "dlc"})
        calls = []

        def fake(project, role, step, stack, max_chars, query=""):
            calls.append((project, max_chars))
            text = ("P" * 300) if project == "dlc-shop" else ("S" * 2000)
            return [{"text": text[:max_chars], "source": project, "score": 1.0, "served": []}]

        a._retrieve = fake
        hits = a.retrieve("builder", "build", ["python"], 1000, query="q")
        self.assertEqual(calls, [("dlc-shop", 500), ("dlc", 700)])
        self.assertEqual(sum(len(h["text"]) for h in hits), 1000)
        b = HttpRagAdapter("http://x", "dlc_line", extra={"project": "dlc"})
        b._retrieve = fake
        calls.clear()
        b.retrieve("builder", "build", ["python"], 1000)
        self.assertEqual(calls, [("dlc", 1000)])


class ClaudeTokenTest(unittest.TestCase):
    TOK = "sk-ant-oat01-" + "a" * 40

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dlc-home-")
        self.env = mock.patch.dict(os.environ, {"DLC_HOME": self.home}, clear=False)
        self.env.start()
        os.environ.pop(claude_token.ENV, None)

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.home, ignore_errors=True)

    def ok(self, argv, **kw):
        self.seen = kw["env"].get(claude_token.ENV)
        return subprocess.CompletedProcess(argv, 0, "ready\n", "")

    def test_save_after_a_real_answer_then_cli_uses_it(self):
        self.assertEqual(claude_token.status()["source"], "none")
        with mock.patch("line.llm.cli.sdlc_llm.which", return_value="claude"):
            st = claude_token.save({"token": self.TOK}, "admin@x", run=self.ok)
        self.assertEqual(self.seen, self.TOK)
        self.assertEqual((st["source"], st["set_by"]), ("file", "admin@x"))
        self.assertNotIn(self.TOK, json.dumps(st))
        from line.llm.cli import child_env
        self.assertEqual(child_env()[claude_token.ENV], self.TOK)

    def test_refused_token_is_not_saved(self):
        def bad(argv, **kw):
            return subprocess.CompletedProcess(argv, 1, "", "Invalid API key " + self.TOK)
        with mock.patch("line.llm.cli.sdlc_llm.which", return_value="claude"):
            with self.assertRaises(Exception) as e:
                claude_token.save({"token": self.TOK}, run=bad)
        self.assertNotIn(self.TOK, str(e.exception))
        self.assertFalse(os.path.exists(claude_token.path()))
        with self.assertRaises(ValueError):
            claude_token.save({"token": "not-a-token"}, run=self.ok)

    def test_refused_token_in_an_agent_call_says_what_to_do(self):
        from line import codes
        from line.llm.cli import cli_error
        from line.pipeline import Escalate, Pipeline
        claude_token._last_rejected.clear()
        plain = cli_error("Claude CLI exited 1 without a result: boom", {})
        self.assertEqual((plain.code, plain.message), (codes.LLM_ERROR, "Claude CLI exited 1 without a result: boom"))
        self.assertIsNone(claude_token.status()["rejected"])
        e = cli_error("Claude CLI error (success): Failed to authenticate. API Error: 401 OAuth token revoked", {})
        self.assertEqual(e.code, codes.LLM_ERROR)                              # the code is kept
        self.assertTrue(e.message.startswith(claude_token.REJECTED))
        self.assertIn("OAuth token revoked", e.message)
        self.assertTrue(e.detail["token_rejected"])
        self.assertIn("OAuth token revoked", claude_token.status()["rejected"]["message"])
        # a builder that met it ends the run at once instead of climbing the retry ladder
        with self.assertRaises(Escalate) as esc:
            Pipeline._after_attempt(types.SimpleNamespace(seal=None), "U1", {"outcome": "ERROR", "code": e.code,
                                                                              "reason": e.message})
        self.assertEqual(esc.exception.code, codes.LLM_ERROR)
        with mock.patch("line.llm.cli.sdlc_llm.which", return_value="claude"):
            claude_token.save({"token": self.TOK}, run=self.ok)
        self.assertIsNone(claude_token.status()["rejected"])                  # a new token clears it

    def test_service_token_shows_when_none_set(self):
        os.environ[claude_token.ENV] = self.TOK
        self.assertEqual(claude_token.status()["source"], "service")


if __name__ == "__main__":
    unittest.main()
