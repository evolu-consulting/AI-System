"""The attention panel (line.attention), readable worklog (line.worklog_text), deps ready before the builder
(line.build.deps) and the builder's narrower tool set."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest import mock

from line import attention, codes, projects
from line.contracts import E_ESCALATION, E_RUN, E_UNIT, LlmResult, Run
from line.llm.cli import CODE_TOOLS, ROLE_TOOLS
from line.tests.fakes import make_fakes
from line.worklog_text import call_text, event_text


def failed_run(store, pack, detail=None):
    store.put(E_RUN, "R1", Run("R1", pack, state="escalated", detail=dict({"name": "Bench P3", "flow": "bug-fix",
                                                                            "project": "testarea"}, **(detail or {}))),
              run="R1")
    store.put(E_UNIT, "R1:U1", {"id": "U1", "run": "R1", "state": "failed", "detail": {"failures": [
        {"code": "BLOCKED", "detail": {"key": "blocked:locked tests/acceptance/test_f1.py has no temporary NOTES_FILE",
                                       "blocked_kind": "test"}}]}}, run="R1")
    store.put(E_ESCALATION, "R1:U1", {"code": codes.BLOCKED_OUTSIDE_CLAIMS, "unit": "U1", "run": "R1",
                                      "message": "unit U1 is BLOCKED: a locked acceptance test is wrong",
                                      "detail": {"code": codes.BLOCKED_OUTSIDE_CLAIMS, "blocked_kind": "test"}}, run="R1")


class AttentionTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dlc-attn-")
        self.pack = os.path.join(self.d, "packs", "bug-notesapp-20261016-040010")
        os.makedirs(self.pack)
        with open(os.path.join(self.pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# Bug fix\n\nClicking a note opens the next one.\n\n## Analysis (spec analyst)\n\nold analysis\n\n"
                     "## E2E hook note\n\nKeep it small.\n")
        self.f = make_fakes()
        self.s = self.f.store
        failed_run(self.s, self.pack)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_a_failed_run_says_what_why_and_what_to_do(self):
        v = attention.view(self.s, "R1")
        self.assertTrue(v["needed"])
        self.assertEqual(v["kind"], "failed")
        self.assertIn("acceptance test", v["what"])
        self.assertEqual(v["unit"], "U1")
        self.assertIn("NOTES_FILE", v["reason"])
        self.assertEqual(v["options"], ["retry", "resolve", "explain"])
        for k in ("what", "why", "do"):
            self.assertNotIn("_", v[k].split(".")[0])          # words, not codes

    def test_resolved_clears_the_project_warning(self):
        last = self.s.get(E_RUN, "R1")
        self.assertTrue(projects.attention_of(self.s, None, last)["needed"])
        with self.assertRaises(ValueError):
            attention.resolve(self.s, types.SimpleNamespace(), "R1", "  ", "rowan")
        out = attention.resolve(self.s, types.SimpleNamespace(rag="off"), "R1", "fixed the test by hand", "rowan")
        self.assertEqual(out["resolved"]["by"], "rowan")
        last = self.s.get(E_RUN, "R1")
        self.assertFalse(projects.attention_of(self.s, None, last)["needed"])
        v = attention.view(self.s, "R1")
        self.assertFalse(v["needed"])
        self.assertEqual(v["resolved"]["note"], "fixed the test by hand")

    def test_retry_runs_the_same_run_again_with_the_hint(self):
        from line.reopen import notes_text, reopen
        cfg = types.SimpleNamespace(max_usd_run=6.0, agent_version="t", model="m")
        out = reopen(self.s, cfg, "R1", "Set NOTES_FILE in setUpClass.", "rowan")
        self.assertEqual((out["run"], out["attempt"], out["units"]), ("R1", 2, ["U1"]))
        row = self.s.get(E_RUN, "R1")
        self.assertNotEqual(row["state"], "escalated")                    # the same run, going on
        self.assertEqual(self.s.get(E_UNIT, "R1:U1")["state"], "ready")
        self.assertEqual(self.s.get(E_UNIT, "R1:U1")["detail"]["failures"], [])
        a = row["detail"]["attempts"]
        self.assertEqual((len(a), a[0]["n"], a[0]["by"], a[0]["actor"]), (1, 1, "person", "rowan"))
        self.assertNotIn("escalation", row["detail"])
        spec = open(os.path.join(self.pack, "spec.md"), encoding="utf-8").read()
        self.assertIn("old analysis", spec)                               # understood already: kept
        self.assertIn("## Note from rowan after attempt 1 failed", spec)
        self.assertIn("Set NOTES_FILE in setUpClass.", notes_text(row["detail"]))
        v = attention.view(self.s, "R1")
        self.assertEqual((v["attempt"], v["attempts"][0]["hint"]), (2, "Set NOTES_FILE in setUpClass."))
        self.assertFalse(projects.attention_of(self.s, None, row)["needed"])
        with self.assertRaises(ValueError):                               # not failed now
            reopen(self.s, cfg, "R1", "", "rowan")

    def test_a_resolved_run_is_not_run_again(self):
        from line.reopen import reopen
        attention.resolve(self.s, types.SimpleNamespace(rag="off"), "R1", "fixed by hand", "rowan")
        with self.assertRaises(ValueError):
            reopen(self.s, types.SimpleNamespace(max_usd_run=6.0), "R1", "", "rowan")

    def test_explain_once_with_the_cheap_role(self):
        calls = []

        class Llm:
            def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
                calls.append((role, prompt))
                return LlmResult({"what": "The test was wrong.", "why": "It shares a data file.",
                                  "next": ["Fix the test", "Run again"]}, "", {}, 0.001, "m", "")

        out = attention.explain(self.s, types.SimpleNamespace(), "R1", Llm())
        self.assertEqual(out["what"], "The test was wrong.")
        self.assertEqual(calls[0][0], "explainer")
        self.assertIn("NOTES_FILE", calls[0][1])
        attention.explain(self.s, types.SimpleNamespace(), "R1", Llm())   # kept on the run: no second call
        self.assertEqual(len(calls), 1)

    def test_paused_and_hook_holds(self):
        self.s.put(E_RUN, "R2", Run("R2", self.pack, state="building", detail={"paused": {"by": "rowan"}}), run="R2")
        self.assertEqual(attention.view(self.s, "R2")["kind"], "paused")
        self.s.put(E_RUN, "R3", Run("R3", self.pack, state="planning",
                                    detail={"hook_hold": {"name": "gate", "event": "after_plan", "reason": "wait"}}), run="R3")
        v = attention.view(self.s, "R3")
        self.assertEqual((v["kind"], v["options"]), ("hook", ["ask_again", "pass"]))


class WorklogTextTest(unittest.TestCase):
    def test_events_read_as_sentences_not_json(self):
        t, x = event_text("graph.valid", {"attempts": 1, "critical_path": ["U1"], "units": ["U1"], "waves": [["U1"]]})
        self.assertEqual(t, "Work planned")
        self.assertEqual(x, "1 unit(s) of work: U1. Build order: (U1).")
        t, x = event_text("unit.blocked", {"reason": "the test is wrong"}, "U2")
        self.assertEqual((t, x), ("U2 is blocked", "The builder says: the test is wrong"))
        t, x = event_text("some.new_kind", {"a_b": 1})
        self.assertEqual(t, "Some new kind")
        self.assertNotIn("{", x)

    def test_calls_carry_the_agents_own_summary(self):
        t, x = call_text({"role": "builder", "key": "U1.2", "model": "opus", "usd": 0.31, "outcome": "SUBMIT",
                          "summary": "Fixed the index in NoteList.jsx."})
        self.assertEqual(t, "Builder · U1 attempt 2")
        self.assertIn("Finished on opus, $0.31.", x)
        self.assertIn("Fixed the index", x)
        self.assertIn("saved $0.10", call_text({"role": "reader_a", "cached": True, "saved_usd": 0.1})[1])


def _write(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


class DepsTest(unittest.TestCase):
    def test_node_modules_installed_before_the_builder_only_where_ignored(self):
        from line.build import deps
        d = tempfile.mkdtemp(prefix="dlc-deps-")
        try:
            subprocess.run(["git", "init", "-q", d], check=True)
            os.makedirs(os.path.join(d, "NotesApp"))
            os.makedirs(os.path.join(d, "Other"))
            for app in ("NotesApp", "Other"):
                _write(os.path.join(d, app, "package.json"), "{}")
            _write(os.path.join(d, "NotesApp", ".gitignore"), "node_modules/\n")
            _write(os.path.join(d, "Other", ".gitignore"), "!node_modules/\n")     # whatever a global ignore says
            seen = []

            def install(p):                    # like `npm install` without a lockfile: writes one
                seen.append(os.path.basename(p))
                _write(os.path.join(p, "package-lock.json"), "{}")
            fake = types.SimpleNamespace(prepare=install)
            with mock.patch.dict(deps.stacks.STACKS, {"react": fake}):
                done = deps.prepare(d)
            self.assertEqual(done, ["NotesApp"])        # Other: node_modules not ignored, would show in the diff
            self.assertEqual(seen, ["NotesApp"])
            for app in ("NotesApp", "Other"):           # the probe folder never stays behind (prepare installs)
                self.assertFalse(os.path.exists(os.path.join(d, app, "node_modules")), app)
            # a lockfile the install wrote is not the unit's change (CLAIM_VIOLATION in run R20261016-131351-58b0)
            self.assertFalse(os.path.exists(os.path.join(d, "NotesApp", "package-lock.json")))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_builders_get_code_tools_only(self):
        self.assertEqual(ROLE_TOOLS["builder"], CODE_TOOLS)
        for t in ("WebFetch", "WebSearch", "Task", "NotebookEdit"):
            self.assertNotIn(t, CODE_TOOLS)


if __name__ == "__main__":
    unittest.main()
