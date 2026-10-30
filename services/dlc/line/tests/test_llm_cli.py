"""S3: CLI backend - argv, cwd and scrubbed env with a mocked subprocess (no real CLI)."""

import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from line import codes
from line.codes import LineError
from line.config import load_config
from line.llm import make_llm
from line.llm import cli as cli_mod
from line.llm.cli import parse_outcome


class Stdin(io.StringIO):
    def close(self):
        self.closed_value = self.getvalue()


class FakeProc:
    def __init__(self, events, returncode=0):
        self.stdin = Stdin()
        self.stdout = iter([json.dumps(e) + "\n" for e in events])
        self.stderr = iter([])
        self.returncode = returncode
        self.prompt = None

    def wait(self):
        return self.returncode

    def kill(self):
        pass


def result_events(text, cost=0.12, subtype="success", is_error=False):
    return [
        {"type": "system", "subtype": "init"},
        {"type": "assistant", "message": {"id": "m1", "model": "claude-opus-5-5",
                                          "usage": {"input_tokens": 10, "output_tokens": 5}}},
        {"type": "result", "subtype": subtype, "is_error": is_error, "result": text, "session_id": "s1",
         "total_cost_usd": cost,
         "modelUsage": {"claude-opus-5-5": {"inputTokens": 1000, "outputTokens": 200,
                                            "cacheCreationInputTokens": 30, "cacheReadInputTokens": 40}}},
    ]


SECRETS = {"ANTHROPIC_API_KEY": "sk-x", "LINE_RAG_CLIENT_SECRET": "s", "LINE_RAG_CLIENT_ID": "id",
           "GITHUB_TOKEN": "t", "DB_PASSWORD": "p", "CLAUDECODE": "1"}


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-llm-cli-")
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli",
                               workroot=os.path.join(self.tmp, "work"))
        self.which = mock.patch.object(cli_mod.sdlc_llm, "which", return_value="/usr/bin/claude")
        self.which.start()
        self.env = mock.patch.dict(os.environ, dict(SECRETS, CLAUDE_CODE_OAUTH_TOKEN="oauth", PATH_MARK="1"))
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.which.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _popen(self, events, seen):
        def fake_popen(argv, **kw):
            p = FakeProc(events)
            seen.append((argv, kw, p))
            return p
        return mock.patch.object(cli_mod.subprocess, "Popen", side_effect=fake_popen)

    def test_agentic_argv_cwd_env(self):
        seen = []
        wd = os.path.join(self.tmp, "wt")
        os.makedirs(wd)
        with self._popen(result_events("Implemented storage.\nSUBMIT"), seen):
            res = make_llm(self.cfg).agentic("builder", wd, "build U1", 40, 1.0, key="U1#1", run="r1")
        argv, kw, proc = seen[0]
        self.assertEqual(argv[0], "/usr/bin/claude")
        self.assertEqual(argv[1:5], ["-p", "--output-format", "stream-json", "--verbose"])

        def val(flag):
            return argv[argv.index(flag) + 1]
        self.assertEqual(val("--model"), "claude-opus-5-5")
        self.assertEqual(val("--permission-mode"), "acceptEdits")
        self.assertEqual(val("--allowedTools"), cli_mod.CODE_TOOLS)   # shell + files; the guard hook refuses the rest
        with open(val("--settings"), encoding="utf-8") as fh:
            hook = json.load(fh)["hooks"]["PreToolUse"][0]
        self.assertEqual(hook["matcher"], "Bash|PowerShell")
        self.assertIn("agent_guard", hook["hooks"][0]["command"])
        self.assertEqual(val("--max-turns"), "40")
        self.assertEqual(float(val("--max-budget-usd")), 1.0)
        self.assertNotIn("--dangerously-skip-permissions", argv)
        self.assertEqual(kw["cwd"], wd)
        env = kw["env"]
        for name in SECRETS:
            self.assertNotIn(name, env)
        self.assertEqual(env["CLAUDE_CODE_OAUTH_TOKEN"], "oauth")
        self.assertEqual(env["PATH_MARK"], "1")
        self.assertEqual(proc.stdin.closed_value, "build U1")
        self.assertEqual(res.outcome, "SUBMIT")
        self.assertAlmostEqual(res.usd, 0.12)
        self.assertEqual(res.usage, {"input": 1000, "output": 200, "cacheWrite": 30, "cacheRead": 40})

    def test_model_override_and_blocked_outcomes(self):
        seen = []
        wd = os.path.join(self.tmp, "wt")
        os.makedirs(wd)
        llm = make_llm(self.cfg)
        with self._popen(result_events("cannot\n**BLOCKED:spec unclear on F2**"), seen):
            res = llm.agentic("builder", wd, "b", 5, 1.0, model="claude-fable-5-1", key="U1#2", run="r1")
        self.assertEqual(seen[0][0][seen[0][0].index("--model") + 1], "claude-fable-5-1")
        self.assertEqual(res.outcome, "BLOCKED:spec unclear on F2")
        with self._popen(result_events("", subtype="error_max_turns", is_error=True), seen):
            res = llm.agentic("builder", wd, "b", 5, 1.0, key="U1#3", run="r1")
        self.assertEqual(res.outcome, "BLOCKED:max_turns")
        self.assertAlmostEqual(llm.spent("r1"), 0.24)

    def test_complete_argv_and_json(self):
        seen = []
        with self._popen(result_events('{"ok": true}', cost=0.01), seen):
            res = make_llm(self.cfg).complete("reader", "read", {"type": "object", "required": ["ok"]},
                                              key="A", run="r1")
        argv, kw, _ = seen[0]
        self.assertEqual(argv[argv.index("--max-turns") + 1], "1")
        self.assertEqual(argv[argv.index("--tools") + 1], "")          # one-turn answers get no tools
        self.assertNotIn("--permission-mode", argv)
        self.assertNotIn("--allowedTools", argv)
        self.assertEqual(kw["cwd"], self.cfg.workroot)
        self.assertEqual(res.data, {"ok": True})

    def test_cli_error_is_typed_and_cost_recorded(self):
        seen = []
        llm = make_llm(self.cfg)
        with self._popen(result_events("boom", cost=0.05, subtype="error_during_execution", is_error=True), seen):
            with self.assertRaises(LineError) as cm:
                llm.complete("reader", "read", key="A", run="r1")
        self.assertEqual(cm.exception.code, codes.LLM_ERROR)
        self.assertAlmostEqual(llm.spent("r1"), 0.05)

    def test_cap_blocks_without_spawning(self):
        cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli", max_usd_call=0.001)
        with mock.patch.object(cli_mod.subprocess, "Popen") as popen:
            with self.assertRaises(LineError) as cm:
                make_llm(cfg).agentic("builder", self.tmp, "b", 5, 1.0, key="U1#1", run="r1")
            self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
            with self.assertRaises(LineError):
                make_llm(cfg).complete("reader", "r", key="A", run="r1")
            popen.assert_not_called()

    def test_missing_workdir(self):
        with mock.patch.object(cli_mod.subprocess, "Popen") as popen:
            with self.assertRaises(LineError) as cm:
                make_llm(self.cfg).agentic("builder", os.path.join(self.tmp, "none"), "b", 5, 1.0)
            self.assertEqual(cm.exception.code, codes.LLM_ERROR)
            popen.assert_not_called()

    def test_parse_outcome(self):
        self.assertEqual(parse_outcome("x\nSUBMIT\n\n"), "SUBMIT")
        self.assertEqual(parse_outcome("BLOCKED:need db"), "BLOCKED:need db")
        self.assertEqual(parse_outcome("SUBMIT\nmore words"), "BLOCKED:no_outcome")
        self.assertEqual(parse_outcome(""), "BLOCKED:no_outcome")


if __name__ == "__main__":
    unittest.main()
