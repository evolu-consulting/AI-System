"""Overhead of a run (finding 11 / 14): lanes from the change sizer, role models, the reading cache, the agents'
shell command limits, the job object that ends what an agent call started, and the Graphify code graph."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

from line import agent_guard, codegraph
from line.config import load_config
from line.contracts import E_LLM_CALL, E_RUN, LlmResult, Run
from line.llm import make_llm
from line.llm.cli import ROLE_TOOLS, command_timeouts
from line.ship._util import git
from line.tests.fakes import FakeStore, make_fakes
from line.understand import analyst, sizer


def cfg(**kw):
    return load_config(env={}, line_json=None, rag_local_json=None, **kw)


class SpyBackend:
    name = "spy"
    overhead_tokens = 0

    def __init__(self, text='{"ok": true}', usd=0.1):
        self.text, self.usd, self.calls = text, usd, []

    def raw_complete(self, role, prompt, model, key, repair=False):
        self.calls.append((role, model))
        return LlmResult(None, self.text, {"input": 10, "output": 5}, self.usd, model, "")

    def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
        self.calls.append((role, model))
        return LlmResult(None, "done\nSUBMIT", {"input": 1, "output": 1}, self.usd, model, "SUBMIT")


SCHEMA = {"type": "object", "required": ["ok"], "properties": {"ok": {"type": "boolean"}}}


class RoleModelsTest(unittest.TestCase):
    def test_reading_roles_run_on_cheaper_models_unless_the_caller_names_one(self):
        spy = SpyBackend()
        llm = make_llm(cfg(), backend=spy)
        llm.complete("reader_a", "read", SCHEMA, run="r")
        llm.complete("test_author", "write", SCHEMA, run="r")
        llm.agentic("change_sizer", ".", "size", 5, 0.3, run="r")
        llm.complete("reader_a", "read", SCHEMA, run="r", model="claude-fable-5-1")   # the retry ladder wins
        self.assertEqual([m for _r, m in spy.calls],
                         ["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"])

    def test_env_overrides_and_drops_roles(self):
        c = load_config(env={"LINE_ROLE_MODELS": "planner=claude-opus-5-5, reader_a="}, line_json=None,
                        rag_local_json=None)
        self.assertEqual(c.role_models, {"planner": "claude-opus-5-5"})
        c = load_config(env={"LINE_ROLE_MODELS": '{"fgraph": "claude-haiku-5-5"}'}, line_json=None,
                        rag_local_json=None)
        self.assertEqual(c.role_models, {"fgraph": "claude-haiku-5-5"})


class ReadingCacheTest(unittest.TestCase):
    def test_same_reading_prompt_is_not_paid_twice(self):
        store, spy = FakeStore(), SpyBackend()
        llm = make_llm(cfg(llm_cache="1"), store, backend=spy)
        a = llm.complete("reader_a", "the spec", SCHEMA, key="digest", run="r1")
        b = llm.complete("reader_a", "the spec", SCHEMA, key="digest", run="r2")      # a retried run
        self.assertEqual(len(spy.calls), 1)
        self.assertEqual(b.data, a.data)
        self.assertEqual(llm.spent("r2"), 0.0)
        hit = [r for r in store.query(E_LLM_CALL, run="r2")][0]
        self.assertTrue(hit["cached"])
        self.assertAlmostEqual(hit["saved_usd"], 0.1)
        llm.complete("reader_a", "another spec", SCHEMA, run="r2")
        self.assertEqual(len(spy.calls), 2)

    def test_a_run_that_failed_reading_voids_what_it_used(self):
        store, spy = FakeStore(), SpyBackend()
        llm = make_llm(cfg(llm_cache="1"), store, backend=spy)
        llm.complete("reader_a", "the spec", SCHEMA, run="r1")
        llm.complete("reader_b", "the spec", SCHEMA, run="r1")
        llm.complete("reader_a", "the spec", SCHEMA, run="r2")          # r2 uses r1's answer: r2 owns it now
        self.assertEqual(len(spy.calls), 2)
        self.assertEqual(llm.forget_cache("r2"), 1)                    # r2 misread: its answer goes
        llm.complete("reader_a", "the spec", SCHEMA, run="r3")
        llm.complete("reader_b", "the spec", SCHEMA, run="r3")
        self.assertEqual([r for r, _m in spy.calls], ["reader_a", "reader_b", "reader_a"])

    def test_writing_roles_and_the_fake_model_are_never_cached(self):
        store, spy = FakeStore(), SpyBackend()
        llm = make_llm(cfg(llm_cache="1"), store, backend=spy)
        llm.complete("test_author", "same", SCHEMA, run="r")
        llm.complete("test_author", "same", SCHEMA, run="r")
        self.assertEqual(len(spy.calls), 2)
        llm = make_llm(cfg(), store, backend=spy)                     # auto + llm fake: off
        llm.complete("reader_b", "same", SCHEMA, run="r")
        llm.complete("reader_b", "same", SCHEMA, run="r")
        self.assertEqual(len(spy.calls), 4)


class SizerTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dlc-sizer-")
        self.pack = os.path.join(self.d, "pack")
        self.repo = os.path.join(self.d, "repo")
        os.makedirs(self.pack)
        with open(os.path.join(self.pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("Bug fix: clicking a note opens the next one.\n")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q")
        git(self.repo, "symbolic-ref", "HEAD", "refs/heads/main")
        for i in (1, 2):
            with open(os.path.join(self.repo, "f%d.txt" % i), "w") as fh:
                fh.write("x")
            git(self.repo, "add", "-A")
            git(self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c%d" % i)
        self.f = make_fakes()

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def pipe(self, answer=None, flow="bug", lanes="1", lane="", fail=False, level="", repo=None):
        detail = {"flow": flow}
        if lane:
            detail["lane"] = lane
        if level:
            detail["level"] = level
        self.f.store.put(E_RUN, "R1", Run("R1", self.pack, state="admitted", detail=detail), run="R1")
        calls = []

        class Llm:
            def agentic(self, role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
                calls.append((role, usd_cap, prompt))
                if fail:
                    raise RuntimeError("model down")
                return types.SimpleNamespace(text=answer or "", usd=0.01, outcome="SUBMIT")

            def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
                calls.append((role, "complete", prompt))
                return types.SimpleNamespace(text=answer or "", usd=0.005)

        c = load_config(env={"LINE_LANES": lanes, "LINE_WORKROOT": os.path.join(self.d, "work")}, line_json=None,
                        rag_local_json=None)
        p = types.SimpleNamespace(store=self.f.store, run="R1", cfg=c, pack=self.pack,
                                  repo=self.repo if repo is None else repo, llm=Llm(), log=lambda m: None)
        return p, calls

    def test_agent_picks_the_level_once(self):
        ans = 'Looked at it.\n{"level": 1, "risk": "low", "files": ["web/App.jsx"], "reasons": ["one handler"],' \
              ' "evidence": ["vec_1"]}\nSUBMIT'
        p, calls = self.pipe(ans)
        out = sizer.run(p)
        # the fake model keeps the solo lane off, so level 1 takes the team's trivial lane
        self.assertEqual((out["level"], out["lane"], out["by"], out["files"]), (1, "trivial", "agent", ["web/App.jsx"]))
        self.assertEqual(calls[0][0], "change_sizer")
        self.assertIn("clicking a note", calls[0][2])
        sizer.run(p)                                         # resumed run: sized already
        self.assertEqual(len(calls), 1)
        self.assertEqual(sizer.level_of(p), 1)
        self.assertFalse(sizer.two_readers(p))
        self.assertFalse(sizer.feature_graph(p, 2))
        self.assertTrue(sizer.feature_graph(p, sizer.SMALL_MAX_FITEMS + 1))
        self.assertFalse(sizer.needs_analyst(p, "fix the list"))
        self.assertTrue(sizer.needs_analyst(p, "see https://jira.example.com/browse/CS-1"))

    def test_levels_take_lanes_and_solo_when_it_is_on(self):
        on = load_config(env={}, line_json=None, rag_local_json=None, llm="cli")      # levels 3-4: the lead
        self.assertEqual([sizer.lane_for(lv, on) for lv in (1, 2, 3, 4)], ["solo"] * 4)
        team = load_config(env={}, line_json=None, rag_local_json=None, llm="cli", solo_lead="0")
        self.assertEqual([sizer.lane_for(lv, team) for lv in (1, 2, 3, 4)], ["solo", "solo", "small", "full"])
        off = load_config(env={}, line_json=None, rag_local_json=None, llm="cli", solo="0")
        self.assertEqual([sizer.lane_for(lv, off) for lv in (1, 2, 3, 4)], ["trivial", "small", "small", "full"])

    def test_doubt_is_level_2_and_risk_is_at_least_3(self):
        for i in range(25):                                  # files the change would edit; new files never count
            with open(os.path.join(self.repo, "f%d.txt" % i), "w") as fh:
                fh.write("x")
        for ans, level, why in (("no json at all", 2, "no usable answer"),
                                ('{"level": 1, "risk": "high"}', 3, "risk high"),
                                # many files are knowledge for the rubric, not a code guard (it overrode right answers)
                                ('{"level": 2, "files": %s}' % json.dumps(["f%d.txt" % i for i in range(25)]), 2, None),
                                ('{"level": 2, "files": %s}' % json.dumps(["new%d.js" % i for i in range(9)]), 2, None),
                                ('{"level": 4, "risk": "high"}', 4, None),
                                ('{"level": "huge"}', 2, "unknown level 'huge'")):
            self.f = make_fakes()
            p, _ = self.pipe(ans)
            out = sizer.run(p)
            self.assertEqual((out["level"], out.get("why")), (level, why), ans)
        self.f = make_fakes()
        p, _ = self.pipe(fail=True)
        out = sizer.run(p)
        self.assertEqual(out["level"], 2)
        self.assertIn("model down", out["error"])

    def test_a_new_system_is_sized_from_the_request_in_one_call(self):
        empty = os.path.join(self.d, "empty")
        os.makedirs(empty)
        files = json.dumps(["NotesApp/f%d.js" % i for i in range(10)])     # new work: file count is no reason
        p, calls = self.pipe('{"level": 1, "risk": "low", "files": %s}' % files, flow="new", repo=empty)
        self.assertEqual(sizer.run(p)["level"], 1)
        self.assertEqual([(r, kind) for r, kind, _p in calls], [("change_sizer", "complete")])
        self.assertIn("empty", calls[0][2])

    def test_rules_before_any_model_call(self):
        p, calls = self.pipe(lanes="0")
        self.assertEqual((sizer.run(p)["by"], sizer.run(p)["level"]), ("off", 4))   # fake model: solo off -> 4
        self.f = make_fakes()
        p, calls2 = self.pipe(lane="small")                  # a person's lane
        self.assertEqual(sizer.run(p), dict(sizer.run(p), lane="small", level=3, by="person"))
        self.f = make_fakes()
        p, calls3 = self.pipe(level="3")                     # a person's level, or a retry one level up
        self.assertEqual((sizer.run(p)["level"], sizer.run(p)["lane"]), (3, "small"))
        self.assertEqual(calls + calls2 + calls3, [])
        self.assertTrue(sizer.two_readers(types.SimpleNamespace(store=FakeStore(), run="none")))   # never sized

    def test_trivial_lane_skips_the_analyst_without_links(self):
        p, _ = self.pipe('{"level": 1, "risk": "low", "files": ["a.js"]}')
        sizer.run(p)
        self.assertEqual(analyst.run(types.SimpleNamespace(**dict(vars(p), cfg=load_config(
            env={"LINE_SPEC_ANALYST": "1"}, line_json=None, rag_local_json=None)))), {"skipped": "trivial lane"})


class OneReaderTest(unittest.TestCase):
    def test_small_lane_reads_once(self):
        import importlib
        reconcile = importlib.import_module("line.understand.reconcile")   # the package re-exports a function of that name
        calls = []

        def fake_read(pack, variant, llm, **kw):
            calls.append(variant)
            from line.contracts import Digest
            return Digest(pack_version="v1", variant=variant, f_items=[], rules=[], numbers=[], dropped=[], usd=0.2)

        with mock.patch.object(reconcile, "read_digest", fake_read):
            d = reconcile.understand(types.SimpleNamespace(version="v1", spans=[]), None, readers=1)
        self.assertEqual(calls, ["A"])
        self.assertEqual((d.variant, d.usd), ("R", 0.2))


class CommandLimitsTest(unittest.TestCase):
    def test_servers_and_watchers_only_in_the_background(self):
        for cmd in ("npm run dev", "npm start", "pnpm dev", "npx vite", "vite --port 5173", "nodemon index.js",
                    "cds watch", "python -m http.server 8000", "tsc --watch", "jest --watchAll",
                    "npm install && npm run dev", "ng serve"):
            self.assertTrue(agent_guard.long_running(cmd), cmd)
            self.assertEqual(agent_guard.long_running(cmd, background=True), "", cmd)
        for cmd in ("npm test", "npx vite build", "vite build", "npx vitest run", "jest --watchAll=false",
                    "npm run build", "node --test", "python -m unittest", "npm run test -- --run"):
            self.assertEqual(agent_guard.long_running(cmd), "", cmd)

    def test_hook_refuses_a_foreground_server(self):
        import io
        call = {"tool_name": "Bash", "tool_input": {"command": "npm run dev"}, "cwd": "."}
        with mock.patch("sys.stdin", io.StringIO(json.dumps(call))), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(agent_guard.main(), 2)
        self.assertIn("run_in_background", err.getvalue())
        call["tool_input"]["run_in_background"] = True
        with mock.patch("sys.stdin", io.StringIO(json.dumps(call))):
            self.assertEqual(agent_guard.main(), 0)

    def test_cli_limits_one_command_and_sizer_only_looks(self):
        self.assertEqual(command_timeouts(cfg()), {"BASH_DEFAULT_TIMEOUT_MS": "120000", "BASH_MAX_TIMEOUT_MS": "300000"})
        self.assertEqual(command_timeouts(cfg(agent_cmd_timeout_s=0)), {})
        self.assertEqual(ROLE_TOOLS["change_sizer"], "Read Glob Grep")


@unittest.skipUnless(os.name == "nt", "Windows job objects")
class JobTest(unittest.TestCase):
    def test_orphans_end_with_the_call(self):
        from line.procjob import Job
        d = tempfile.mkdtemp(prefix="dlc-job-")
        try:
            pidfile = os.path.join(d, "child.pid")
            # the parent starts a long sleeper and exits at once: the sleeper is an orphan
            code = ("import subprocess, sys; p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']);"
                    "open(sys.argv[1], 'w').write(str(p.pid))")
            proc = subprocess.Popen([sys.executable, "-c", code, pidfile])
            job = Job.attach(proc)
            self.assertIsNotNone(job)
            proc.wait(timeout=30)
            for _ in range(100):
                if os.path.exists(pidfile) and _read(pidfile):
                    break
                time.sleep(0.1)
            pid = int(_read(pidfile))
            self.assertTrue(_alive(pid))
            self.assertGreaterEqual(job.close(), 1)
            for _ in range(50):
                if not _alive(pid):
                    break
                time.sleep(0.1)
            self.assertFalse(_alive(pid))
        finally:
            shutil.rmtree(d, ignore_errors=True)


def _read(path):
    with open(path) as fh:
        return fh.read()


def _alive(pid):
    out = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"], capture_output=True, text=True).stdout
    return str(pid) in out


class CodeGraphTest(unittest.TestCase):
    def test_off_without_graphify_and_no_graph_is_an_answer(self):
        c = cfg(codegraph="1", graphify=os.path.join(tempfile.gettempdir(), "no-such-graphify.exe"))
        self.assertFalse(codegraph.enabled(c))
        self.assertFalse(codegraph.enabled(cfg(codegraph="0")))
        self.assertEqual(codegraph.refresh(c, ".", run="R9")["ok"], False)
        with self.assertRaises(ValueError):
            codegraph.ask(c, "R9", "query", {"question": "x"})
        self.assertEqual(codegraph.summary(c, "R9"), "")

    def test_index_lives_outside_the_repository(self):
        c = cfg(codegraph_dir=os.path.join(tempfile.gettempdir(), "cg"))
        a, b = codegraph.index_dir(c, "/x/NotesApp"), codegraph.index_dir(c, "/y/NotesApp")
        self.assertNotEqual(a, b)
        self.assertTrue(a.startswith(os.path.join(tempfile.gettempdir(), "cg")))
        self.assertIn("NotesApp-", os.path.basename(a))

    def test_agent_tool_only_with_a_graph(self):
        from line import agent_tools
        mark = agent_tools.CURRENT.set({"run": "R7", "role": "builder"})
        try:
            with mock.patch("line.sidecar.autologin.entries_for", return_value=[]), \
                    mock.patch("line.sidecar.asm.enabled", return_value=False):
                self.assertNotIn("code_graph", agent_tools.tools_for("builder"))
                with mock.patch.dict(codegraph._RUNS, {"R7": {"repo": ".", "graph": "g.json"}}):
                    self.assertIn("code_graph", agent_tools.tools_for("builder"))
        finally:
            agent_tools.CURRENT.reset(mark)


GRAPHIFY = os.environ.get("LINE_GRAPHIFY", "") or shutil.which("graphify") or ""


@unittest.skipUnless(GRAPHIFY, "graphify not installed (deploy/windows/install-graphify.ps1)")
class CodeGraphLiveTest(unittest.TestCase):
    def test_scan_and_ask_without_touching_the_repository(self):
        d = tempfile.mkdtemp(prefix="dlc-cg-")
        try:
            repo = os.path.join(d, "repo")
            os.makedirs(os.path.join(repo, "src"))
            with open(os.path.join(repo, "src", "notes.py"), "w") as fh:
                fh.write("def save(note):\n    return store(note)\n\n\ndef store(note):\n    return note\n")
            git(repo, "init", "-q")
            git(repo, "add", "-A")
            git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c")
            c = cfg(graphify=GRAPHIFY, codegraph_dir=os.path.join(d, "cg"))
            info = codegraph.refresh(c, repo, run="RL")
            self.assertTrue(info["ok"], info)
            self.assertGreater(info["nodes"], 0)
            self.assertEqual(git(repo, "status", "--porcelain").stdout.strip(), "")     # nothing in the repo
            self.assertIn("store", codegraph.ask(c, "RL", "explain", {"name": "save"}))
            self.assertIn("save", codegraph.ask(c, "RL", "affected", {"name": "store"}))
            self.assertTrue(codegraph.summary(c, "RL"))
        finally:
            codegraph.detach("RL")
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
