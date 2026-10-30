"""Agents' tools during a run: the `dlc mcp` broker (line.agent_mcp), the engine side (line.agent_tools) and DLC
Autologin's vault (line.sidecar.autologin)."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import types
import unittest
import urllib.error
import urllib.request
from unittest import mock

from line import agent_mcp, agent_tools
from line.config import load_config
from line.server import LineServer
from line.sidecar import autologin
from line.tests.fakes import make_fakes


class HomeCase(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dlc-home-")
        # LINE_ASM=0: never reach the App Session Manager installed on the machine running the tests
        self.env = mock.patch.dict(os.environ, {"DLC_HOME": self.home, "LINE_ASM": "0"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.home, ignore_errors=True)


class VaultTest(HomeCase):
    def test_entries_keep_secrets_sealed_and_out_of_answers(self):
        e = autologin.add({"name": "Jira", "url": "https://laidon.atlassian.net/jira", "env": "prod",
                           "username": "bot@x", "secret": "pa55-word!", "roles": ["dev", "test"]})
        self.assertEqual((e["host"], e["has_secret"], e["roles"]), ("laidon.atlassian.net", True, ["dev", "test"]))
        self.assertNotIn("secret", e)
        raw = open(autologin.path(), encoding="utf-8").read()
        self.assertNotIn("pa55-word!", raw)                         # sealed (DPAPI on Windows)
        stored = json.loads(raw)["entries"][0]["secret"]
        self.assertEqual(autologin._open(stored), "pa55-word!")
        # an empty secret keeps the stored one
        autologin.change(e["id"], {"env": "uat", "secret": ""})
        self.assertEqual(autologin._open(json.loads(open(autologin.path(), encoding="utf-8").read())["entries"][0]["secret"]),
                         "pa55-word!")
        self.assertEqual(autologin.public_entries()[0]["env"], "uat")
        with self.assertRaises(ValueError):
            autologin.add({"name": "jira", "url": "https://other"})      # names are unique
        with self.assertRaises(ValueError):
            autologin.add({"name": "Bad", "url": "ftp://x"})
        autologin.remove(e["id"])
        self.assertEqual(autologin.public_entries(), [])

    def test_agents_see_only_their_group(self):
        autologin.add({"name": "Jira", "url": "https://jira.example.com", "secret": "s", "roles": ["dev"]})
        autologin.add({"name": "QA app", "url": "https://qa.example.com", "secret": "s", "roles": ["test"]})
        autologin.add({"name": "Off", "url": "https://off.example.com", "secret": "s", "roles": ["dev"], "enabled": False})
        self.assertIn("Jira", autologin.call("list_apps", "dev", {}))
        self.assertNotIn("QA app", autologin.call("list_apps", "dev", {}))
        self.assertNotIn("Off", autologin.call("list_apps", "dev", {}))
        with self.assertRaises(ValueError) as cm:
            autologin.call("get_session", "dev", {"app": "QA app"})
        self.assertIn("Available: Jira", str(cm.exception))
        self.assertEqual(agent_tools.tools_for("builder"),
                         agent_tools.KNOWLEDGE_TOOLS + agent_tools.MEMORY_TOOLS + agent_tools.SESSION_TOOLS)
        self.assertEqual(agent_tools.tools_for("deployer"), agent_tools.KNOWLEDGE_TOOLS + agent_tools.MEMORY_TOOLS)   # nothing for deploy
        with mock.patch("line.sidecar.cdp.sign_in", return_value={"signed_in": True, "debug_port": 9601,
                                                                  "tab": {"title": "Board", "url": "https://jira.example.com/"}}) as si:
            out = autologin.call("get_session", "dev", {"app": "jira"})
        self.assertIn("Signed in to Jira", out)
        self.assertEqual(si.call_args[0][1], "s")                     # the engine signs in; the agent gets text only


class BrokerTest(HomeCase):
    def setUp(self):
        super().setUp()
        self.f = make_fakes()
        cfg = load_config(env={}, line_json=None, rag_local_json=None)
        self.srv = LineServer(self.f.store, cfg, host="127.0.0.1", port=0).start()

    def tearDown(self):
        self.srv.stop()
        super().tearDown()

    def post(self, tool, body, token):
        r = urllib.request.Request(self.srv.url + "/api/agent/" + tool, data=json.dumps(body).encode(), method="POST",
                                   headers={"Content-Type": "application/json", "X-DLC-Agent": token})
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_token_scopes_the_call(self):
        self.assertTrue(agent_tools.ENGINE_URL.startswith("http://127.0.0.1:"))
        st, _ = self.post("search_knowledge", {"question": "how to deploy"}, "nope")
        self.assertEqual(st, 403)
        tok = agent_tools.issue("R1", "builder", "dlc-shop", "dlc")
        st, out = self.post("search_knowledge", {"question": "how to deploy"}, tok)
        self.assertEqual(st, 200, out)
        self.assertTrue(out["error"])                                  # this engine has no knowledge store
        self.assertIn("no knowledge store", out["text"])
        agent_tools.revoke(tok)
        st, _ = self.post("search_knowledge", {"question": "x"}, tok)
        self.assertEqual(st, 403)

    def test_knowledge_reads_the_runs_project(self):
        tok = agent_tools.issue("R1", "builder", "dlc-shop", "dlc")
        seen = {}

        def fake(self_, role, step, stack, max_chars, query=""):
            seen.update(project=self_.project, shared=self_.shared_project, query=query)
            return [{"text": "Deploy with cf push from the release branch."}]

        import dataclasses
        cfg = dataclasses.replace(self.srv.cfg, rag="http", rag_url="http://127.0.0.1:9", rag_ns="dlc_line",
                                  rag_extra={"project": "dlc"})
        with mock.patch("line.rag.http_adapter.HttpRagAdapter.retrieve", fake):
            out = agent_tools.handle(cfg, "search_knowledge", tok, {"question": "how to deploy"})
        self.assertEqual(out, {"text": "Deploy with cf push from the release branch."})
        self.assertEqual(seen, {"project": "dlc-shop", "shared": "dlc", "query": "how to deploy"})


class McpTest(unittest.TestCase):
    def test_lists_only_allowed_tools_and_forwards_calls(self):
        with mock.patch.dict(os.environ, {"DLC_AGENT_TOOLS": "search_knowledge"}):
            names = [t["name"] for t in agent_mcp.handle({"id": 1, "method": "tools/list"})["result"]["tools"]]
            self.assertEqual(names, ["search_knowledge", "read_document"])   # read_document: local, every agent
            r = agent_mcp.handle({"id": 2, "method": "tools/call", "params": {"name": "get_session", "arguments": {}}})
            self.assertIn("error", r)
            with mock.patch.object(agent_mcp, "_post", return_value={"text": "known"}) as p:
                r = agent_mcp.handle({"id": 3, "method": "tools/call",
                                      "params": {"name": "search_knowledge", "arguments": {"question": "q"}}})
            self.assertEqual(r["result"], {"content": [{"type": "text", "text": "known"}], "isError": False})
            self.assertEqual(p.call_args[0], ("search_knowledge", {"question": "q"}))
        self.assertEqual(agent_mcp.handle({"id": 4, "method": "initialize", "params": {}})["result"]["serverInfo"]["name"],
                         "dlc")

    def test_cli_gives_an_agent_call_its_server(self):
        from line.llm.cli import CliBackend
        home = tempfile.mkdtemp(prefix="dlc-home-")
        try:
            with mock.patch.dict(os.environ, {"DLC_HOME": home}), mock.patch.object(agent_tools, "ENGINE_URL", "http://127.0.0.1:1"):
                b = CliBackend(types.SimpleNamespace(rag_extra={"project": "dlc-shop", "shared_project": "dlc"}),
                               command="claude")
                mark = agent_tools.CURRENT.set({"run": "R7", "role": "builder"})
                try:
                    path, tools, tok = b._agent_mcp("builder")
                finally:
                    agent_tools.CURRENT.reset(mark)
                cfgf = json.load(open(path, encoding="utf-8"))["mcpServers"]["dlc"]
                self.assertEqual(cfgf["env"]["DLC_AGENT_TOKEN"], tok)
                self.assertEqual(agent_tools.scope(tok)["rag_project"], "dlc-shop")
                self.assertEqual(agent_tools.scope(tok)["run"], "R7")
                argv = b.agentic_argv("sonnet", 5, 1.0, "", path, tools)
                self.assertIn("--mcp-config", argv)
                self.assertIn("mcp__dlc__search_knowledge", argv[argv.index("--allowedTools") + 1])
            with mock.patch.object(agent_tools, "ENGINE_URL", ""):
                self.assertIsNone(b._agent_mcp("builder"))               # a plain `dlc run`: no engine to reach
        finally:
            shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
