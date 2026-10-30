"""Run hooks (line.hooks): admin CRUD, firing rules, waiting hooks that hold the run, and the pipeline wiring."""

from __future__ import annotations

import os
import shutil
import tempfile
import types
import unittest
from unittest import mock

from line import codes, hooks
from line.contracts import E_RUN, Run
from line.pipeline import Pipeline
from line.store import SqliteStore
from line.tests.test_pipeline_driver import PACK, cfg_for


class Llm:
    """agentic() answers the scripted outcomes in order and remembers each call."""

    def __init__(self, *outcomes, fail=False):
        self.outcomes, self.calls, self.fail = list(outcomes), [], fail

    def agentic(self, role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
        from line import agent_tools
        self.calls.append({"role": role, "workdir": workdir, "prompt": prompt, "key": key, "run": run,
                           "scope": agent_tools.HOOK_SCOPE.get()})
        if self.fail:
            raise RuntimeError("model down")
        out = self.outcomes.pop(0) if self.outcomes else "SUBMIT"
        if out.startswith("WRITE:"):
            with open(os.path.join(workdir, hooks.ADDENDUM), "w", encoding="utf-8") as fh:
                fh.write(out[6:])
            out = "SUBMIT"
        return types.SimpleNamespace(outcome=out, usd=0.01, text="did it\n" + out)


class HooksBase(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dlc-hooks-")
        self.env = mock.patch.dict(os.environ, {"DLC_HOME": os.path.join(self.d, "home")})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.d, ignore_errors=True)


class AdminTest(HooksBase):
    def test_add_change_remove_and_rules(self):
        h = hooks.add({"name": "Close ticket", "prompt": "move the Jira ticket to Done", "event": "run_done",
                       "apps": "Jira, Trello"}, by="rowan")
        self.assertEqual((h["id"], h["mode"], h["apps"], h["by"]), (1, "background", ["Jira", "Trello"], "rowan"))
        self.assertEqual(hooks.change(1, {"enabled": False})["enabled"], False)
        with self.assertRaises(ValueError):                    # an ended run cannot wait for a hook
            hooks.add({"name": "x", "prompt": "y", "event": "run_done", "mode": "wait"})
        with self.assertRaises(ValueError):
            hooks.add({"name": "x", "prompt": "y", "event": "someday"})
        with self.assertRaises(ValueError):
            hooks.add({"name": "x", "prompt": ""})
        self.assertEqual(hooks.add({"name": "Gate", "prompt": "p", "event": "before_qas", "mode": "wait"})["id"], 2)
        hooks.remove(1)
        self.assertEqual([x["id"] for x in hooks.listing()], [2])
        with self.assertRaises(KeyError):
            hooks.remove(9)
        self.assertIn("before_green", hooks.admin_view()["wait_events"])


class FireTest(HooksBase):
    def pipe(self, llm, detail=None):
        self.store = SqliteStore(":memory:")
        pack = os.path.join(self.d, "pack")
        os.makedirs(pack, exist_ok=True)
        with open(os.path.join(pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# Bug: list crashes\n")
        self.store.put(E_RUN, "R1", Run("R1", pack, state="planning", detail=dict(detail or {})), run="R1")
        events = []
        em = types.SimpleNamespace(run_event=lambda run, kind, body: events.append((kind, body)))
        p = types.SimpleNamespace(store=self.store, run="R1", cfg=None, llm=llm, pack=pack, repo="", workdir="",
                                  log=lambda m: None, sm=types.SimpleNamespace(em=em))
        p.events = events
        return p

    def test_waiting_hook_passes_then_is_not_asked_again(self):
        hooks.add({"name": "Gate", "prompt": "check the ticket is approved", "event": "after_plan", "mode": "wait",
                   "apps": ["Jira"]})
        llm = Llm("SUBMIT")
        p = self.pipe(llm)
        self.assertIsNone(hooks.fire(p, "after_plan"))
        self.assertEqual(hooks.results("R1")["after_plan:1"]["status"], "passed")
        self.assertEqual(llm.calls[0]["role"], "hook")
        self.assertEqual(llm.calls[0]["scope"], {"apps": ["Jira"]})          # sessions = the named entries
        self.assertIn("check the ticket is approved", llm.calls[0]["prompt"])
        self.assertIn("BLOCKED:<one-line reason>", llm.calls[0]["prompt"])
        self.assertTrue(os.path.isfile(os.path.join(llm.calls[0]["workdir"], "context.md")))
        self.assertEqual(p.events[0][0], codes.HOOK_RAN)
        self.assertIsNone(hooks.fire(p, "after_plan"))                         # resumed run: not asked again
        self.assertEqual(len(llm.calls), 1)

    def test_block_parks_or_stops_and_a_person_can_pass(self):
        hooks.add({"name": "Gate", "prompt": "p", "event": "before_qas", "mode": "wait"})
        p = self.pipe(Llm("BLOCKED:ticket CS-1 not approved"))
        act = hooks.fire(p, "before_qas")
        self.assertEqual(act["action"], "park")
        self.assertIn("ticket CS-1 not approved", act["message"])
        self.assertEqual([k for k, _ in p.events], [codes.HOOK_RAN, codes.HOOK_BLOCKED])
        hooks.pass_by_hand("R1", "before_qas:1", "rowan")
        self.assertIsNone(hooks.fire(p, "before_qas"))
        hooks.change(1, {"on_block": "stop"})
        os.remove(hooks._results_path("R1"))                                   # a fresh run
        p2 = self.pipe(Llm("BLOCKED:no"))
        self.assertEqual(hooks.fire(p2, "before_qas")["action"], "stop")

    def test_a_pass_by_hand_wins_over_a_hook_asked_again(self):
        hooks.add({"name": "Gate", "prompt": "p", "event": "before_qas", "mode": "wait"})
        p = self.pipe(Llm("BLOCKED:not approved"))
        self.assertEqual(hooks.fire(p, "before_qas")["action"], "park")
        llm = Llm("BLOCKED:still not approved")
        asked = llm.agentic

        def agentic(*a, **k):                                                  # the engine restarted and asks
            hooks.pass_by_hand("R1", "before_qas:1", "rowan")                  # again; a person passes meanwhile
            return asked(*a, **k)

        llm.agentic = agentic
        p.llm = llm
        self.assertIsNone(hooks.fire(p, "before_qas"))                         # the pass stands, no park
        res = hooks.results("R1")["before_qas:1"]
        self.assertEqual((res["status"], res["passed_by"]), ("passed", "rowan"))
        self.assertIsNone(hooks.fire(p, "before_qas"))                         # and is not asked again
        self.assertEqual(len(llm.calls), 1)

    def test_errors_follow_on_error(self):
        hooks.add({"name": "Gate", "prompt": "p", "event": "before_green", "mode": "wait"})
        p = self.pipe(Llm(fail=True))
        self.assertIsNone(hooks.fire(p, "before_green"))                       # continue: the run goes on
        self.assertEqual(hooks.results("R1")["before_green:1"]["status"], "error")
        hooks.change(1, {"on_error": "wait"})
        self.assertEqual(hooks.fire(self.pipe(Llm("BLOCKED:max_turns")), "before_green")["action"], "park")

    def test_matching_and_background(self):
        hooks.add({"name": "Other project", "prompt": "p", "event": "run_done", "projects": ["billing"]})
        hooks.add({"name": "Bug fixes", "prompt": "p", "event": "run_done", "flows": ["Bug Fix"]})
        llm = Llm()
        p = self.pipe(llm, {"project": "ticketing", "flow": "bug fix"})
        with mock.patch("line.hooks.threading.Thread") as T:
            T.side_effect = lambda target, args, **kw: types.SimpleNamespace(start=lambda: target(*args))
            self.assertIsNone(hooks.fire(p, "run_done"))
        res = hooks.results("R1")
        self.assertNotIn("run_done:1", res)                                    # other project
        self.assertEqual(res["run_done:2"]["status"], "done")
        self.assertNotIn("BLOCKED:<one-line reason>", llm.calls[0]["prompt"])

    def test_flow_short_and_long_names_match(self):
        hooks.add({"name": "Enh", "prompt": "p", "event": "run_done", "flows": ["enhancement"]})
        hooks.add({"name": "Bug", "prompt": "p", "event": "run_done", "flows": ["bug"]})
        self.assertTrue(hooks._matches(hooks.get(1), "run_done", {"flow": "enhance"}))     # POST /api/runs name
        self.assertTrue(hooks._matches(hooks.get(1), "run_done", {"flow": "Enhancement"}))
        self.assertTrue(hooks._matches(hooks.get(2), "run_done", {"flow": "bug-fix"}))
        self.assertFalse(hooks._matches(hooks.get(1), "run_done", {"flow": "bug"}))

    def test_run_start_hook_adds_to_the_spec(self):
        hooks.add({"name": "Ticket reader", "prompt": "read the ticket", "event": "run_start", "mode": "wait"})
        p = self.pipe(Llm("WRITE:CS-1 says the filter may be empty"))
        self.assertIsNone(hooks.fire(p, "run_start"))
        with open(os.path.join(p.pack, "spec.md"), encoding="utf-8") as fh:
            spec = fh.read()
        self.assertIn("## Ticket reader (hook)", spec)
        self.assertIn("CS-1 says the filter may be empty", spec)

    def test_test_runs_without_touching_the_run(self):
        hooks.add({"name": "Close", "prompt": "p", "event": "run_done"})
        p = self.pipe(Llm("SUBMIT"))
        with mock.patch("line.hooks.threading.Thread") as T:
            T.side_effect = lambda target, name=None, daemon=None: types.SimpleNamespace(start=target)
            hooks.test(lambda run: p, 1, "R1")
        self.assertEqual(hooks.admin_view()["tests"]["1"]["status"], "done")
        self.assertEqual(hooks.results("R1"), {})
        self.assertEqual(p.events, [])


class PipelineTest(HooksBase):
    """A waiting hook after the plan parks a real (fake-model) run; passing it lets the resumed run end green."""

    def setUp(self):
        super().setUp()
        self.cfg = cfg_for(self.d)
        self.store = SqliteStore(self.cfg.db)

    def tearDown(self):
        self.store.close()
        super().tearDown()

    def test_park_pass_resume_green_and_stop(self):
        hooks.add({"name": "Ticket approved", "prompt": "p", "event": "after_plan", "mode": "wait"})
        blocked = {"status": "blocked", "reason": "not approved", "key": "after_plan:1", "hook": 1,
                   "name": "Ticket approved", "event": "after_plan", "mode": "wait"}
        with mock.patch("line.hooks.run_one", return_value=dict(blocked)):
            p = Pipeline(self.store, self.cfg)
            run = p.admit(PACK)
            row = p.drive(run)
        self.assertEqual(row["state"], "planning")                             # parked, not terminal
        self.assertEqual(row["detail"]["hook_hold"]["reason"], "not approved")
        hooks.pass_by_hand(run, "after_plan:1", "rowan")
        row = Pipeline(self.store, self.cfg).drive(run)
        self.assertEqual(row["state"], "green")
        self.assertNotIn("hook_hold", row["detail"])

        hooks.change(1, {"on_block": "stop"})
        with mock.patch("line.hooks.run_one", return_value=dict(blocked)):
            p = Pipeline(self.store, self.cfg)
            row = p.drive(p.admit(PACK))
        self.assertEqual(row["state"], "escalated")
        self.assertEqual(row["detail"]["escalation"]["code"], codes.HOOK_STOP)

    def test_stop_drops_the_hold(self):
        from line.pipeline import make_driver
        hooks.add({"name": "Ticket approved", "prompt": "p", "event": "after_plan", "mode": "wait"})
        blocked = {"status": "blocked", "reason": "not approved", "key": "after_plan:1", "hook": 1,
                   "name": "Ticket approved", "event": "after_plan", "mode": "wait"}
        driver = make_driver(self.store, self.cfg)
        for action in ("pause_all", "cancel"):
            with mock.patch("line.hooks.run_one", return_value=dict(blocked)):
                p = Pipeline(self.store, self.cfg)
                run = p.admit(PACK)
                self.assertIn("hook_hold", p.drive(run)["detail"])            # parked by the hook
            driver(action, {"run": run, "actor": "rowan", "reason": "urgent stop"})
            row = self.store.get(E_RUN, run)
            self.assertNotIn("hook_hold", row["detail"], action)              # no stale hold after the stop
        self.assertEqual(row["state"], "escalated")


class AgentHooksTest(HooksBase):
    """Agent scope: standing instructions in every matching agent's prompt, and shell commands refused per role."""

    def test_rules_instructions_and_refusals(self):
        with self.assertRaises(ValueError):                    # before_tool needs a pattern
            hooks.add({"name": "x", "prompt": "y", "scope": "agent", "event": "before_tool"})
        with self.assertRaises(ValueError):
            hooks.add({"name": "x", "prompt": "y", "scope": "agent", "event": "before_tool", "pattern": "("})
        with self.assertRaises(ValueError):                    # run events are not agent events
            hooks.add({"name": "x", "prompt": "y", "scope": "agent", "event": "run_done"})
        hooks.add({"name": "Python style", "prompt": "Use type hints.", "scope": "agent", "event": "agent_start"})
        hooks.add({"name": "Readers cite", "prompt": "Quote the spec line.", "scope": "agent", "event": "agent_start",
                   "roles": "reader"})
        hooks.add({"name": "No npm", "prompt": "use pnpm", "scope": "agent", "event": "before_tool",
                   "pattern": r"(^|\s)npm\s+install", "roles": ["builder"]})
        self.assertIn("Use type hints.", hooks.agent_instructions("builder"))
        self.assertNotIn("Quote the spec line.", hooks.agent_instructions("builder"))
        self.assertIn("Quote the spec line.", hooks.agent_instructions("reader_a"))   # a role matches by prefix
        self.assertIn("use pnpm", hooks.tool_refusal("builder", "npm install left-pad"))
        self.assertEqual(hooks.tool_refusal("reviewer", "npm install left-pad"), "")
        self.assertEqual(hooks.tool_refusal("builder", "pnpm install"), "")
        hooks.change(3, {"enabled": False})
        self.assertEqual(hooks.tool_refusal("builder", "npm install left-pad"), "")
        # an agent hook is never fired as a run hook
        self.assertFalse(hooks._matches(hooks.get(1), "agent_start", {}))

    def test_guard_script_and_cli_prompt_apply_them(self):
        import json
        import subprocess
        import sys
        from line.llm import cli
        hooks.add({"name": "No curl", "prompt": "no network downloads", "scope": "agent", "event": "before_tool",
                   "pattern": r"^curl"})
        hooks.add({"name": "Style", "prompt": "Keep functions short.", "scope": "agent", "event": "agent_start"})
        guard = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent_guard.py")
        call = {"tool_name": "Bash", "tool_input": {"command": "curl http://x"}, "cwd": self.d}
        env = dict(os.environ, DLC_AGENT_ROLE="builder")
        cp = subprocess.run([sys.executable, guard], input=json.dumps(call), capture_output=True, text=True, env=env)
        self.assertEqual(cp.returncode, 2, cp.stderr)
        self.assertIn("no network downloads", cp.stderr)
        call["tool_input"]["command"] = "echo ok"
        cp = subprocess.run([sys.executable, guard], input=json.dumps(call), capture_output=True, text=True, env=env)
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertTrue(cli.with_hooks("builder", "Do X.").startswith("Do X."))
        self.assertIn("Keep functions short.", cli.with_hooks("builder", "Do X."))


if __name__ == "__main__":
    unittest.main()
