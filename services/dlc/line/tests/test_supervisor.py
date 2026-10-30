"""The supervisor settles a failed run before a person is asked (line.supervisor)."""

from __future__ import annotations

import os
import shutil
import tempfile
import types
import unittest
from unittest import mock

import subprocess
import sys

from line import attention, codes, projects, retire, supervisor
from line.contracts import E_ACC_TEST
from line.config import load_config
from line.contracts import E_ESCALATION, E_RUN, LlmResult, Run
from line.tests.fakes import make_fakes


class Llm:
    def __init__(self, data):
        self.data, self.calls = data, []

    def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
        self.calls.append((role, prompt))
        if isinstance(self.data, Exception):
            raise self.data
        return LlmResult(self.data, "", {}, 0.01, "m", "")


RETRY = {"impact": "low", "action": "retry", "reason": "The test shares a data file with the app.",
         "hint": "The acceptance test must set NOTES_FILE to a temporary file in setUpClass."}


class SupervisorTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dlc-sup-")
        self.pack = os.path.join(self.d, "packs", "bug-notes-20261016-040010")
        os.makedirs(self.pack)
        with open(os.path.join(self.pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# Bug fix\n\nClicking a note opens the next one.\n")
        self.f = make_fakes()
        self.s = self.f.store
        self.cfg = load_config(env={"LINE_SUPERVISOR": "1"}, line_json=None, rag_local_json=None)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def failed(self, run="R1", code=codes.NO_PROGRESS, detail=None, rdetail=None, message="unit U1 escalated"):
        self.s.put(E_RUN, run, Run(run, self.pack, state="escalated",
                                   detail=dict({"name": "Bench P3", "flow": "bug-fix", "target": self.d}, **(rdetail or {}))),
                   run=run)
        self.s.put(E_ESCALATION, "%s:U1" % run, {"code": code, "unit": "U1", "run": run, "message": message,
                                                 "detail": dict({"code": code}, **(detail or {}))}, run=run)

    def test_small_decision_runs_the_same_run_again_with_a_hint(self):
        self.failed(rdetail={"sizing": {"level": 2, "lane": "solo"}})
        llm = Llm(dict(RETRY, severity="minor"))
        d = supervisor.decide(self.s, self.cfg, "R1", llm)
        self.assertEqual((d["action"], d["by"], d["severity"]), ("retry", "model", "minor"))
        self.assertEqual(llm.calls[0][0], "supervisor")
        self.assertIn('"severity"', llm.calls[0][1])
        out = supervisor.act(self.s, self.cfg, "R1", d)
        self.assertEqual(out["reopened"], 2)                # the same run, attempt 2: no new run
        self.assertNotIn("new_run", out)
        self.assertEqual(len(self.s.query(E_RUN)), 1)
        row = self.s.get(E_RUN, "R1")
        self.assertNotEqual(row["state"], "escalated")
        self.assertNotIn("level", row["detail"])            # minor: the level stays
        self.assertEqual(row["detail"]["sizing"]["level"], 2)
        self.assertEqual(row["detail"]["attempts"][0]["supervisor"]["severity"], "minor")
        spec = open(os.path.join(self.pack, "spec.md"), encoding="utf-8").read()
        self.assertIn("NOTES_FILE to a temporary file", spec)
        self.assertIn("Note from the supervisor after attempt 1 failed", spec)
        v = attention.view(self.s, "R1")
        self.assertFalse(v["needed"])                       # handled: no warning on the project
        self.assertEqual(v["attempt"], 2)
        self.assertFalse(projects.attention_of(self.s, None, row)["needed"])

    def test_a_major_failure_goes_one_level_up(self):
        self.failed(rdetail={"sizing": {"level": 2, "lane": "solo"}})
        d = supervisor.decide(self.s, self.cfg, "R1", Llm(dict(RETRY, severity="major")))
        out = supervisor.act(self.s, self.cfg, "R1", d)
        self.assertEqual((out["reopened"], out["level"]), (2, 3))
        det = self.s.get(E_RUN, "R1")["detail"]
        self.assertEqual((det["level"], det["level_by"]), ("3", "retry"))

    def test_the_same_failure_again_is_major_whatever_the_model_says(self):
        self.failed(code=codes.NO_PROGRESS, rdetail={"attempts": [{"n": 1, "code": codes.NO_PROGRESS, "by": "person",
                                                                   "actor": "rowan", "hint": "x"}]})
        d = supervisor.decide(self.s, self.cfg, "R1", Llm(dict(RETRY, severity="minor")))
        self.assertEqual(d["severity"], "major")

    def test_the_lines_own_guards_go_to_a_person_without_a_model_call(self):
        cases = [(codes.SECRET_FOUND, {}, ""), (codes.BUDGET_EXCEEDED, {}, ""), (codes.HOOK_STOP, {}, ""),
                 (codes.CANCELLED, {}, ""), (codes.LLM_ERROR, {"token_rejected": True}, "token refused"),
                 (codes.BLOCKED_OUTSIDE_CLAIMS, {"blocked_kind": "host"}, "")]
        cases += [(codes.NO_PROGRESS, {"blocked_kind": k}, "") for k in ("spec", "unsafe", "access", "host")]
        for code, det, msg in cases:
            self.f = make_fakes()
            self.s = self.f.store
            self.failed(code=code, detail=det, message=msg or "x")
            llm = Llm(RETRY)
            d = supervisor.decide(self.s, self.cfg, "R1", llm)
            self.assertEqual((d["action"], d["by"]), ("person", "rule"), code)
            self.assertEqual(llm.calls, [], code)

    def test_a_crash_of_the_lines_own_program_goes_to_a_person(self):
        out = ('Traceback (most recent call last):\n  File "dlc_entry.py", line 7, in <module>\n'
               "UnicodeEncodeError: 'charmap' codec can't encode character '\\u2713'\n"
               "[PYI-31376:ERROR] Failed to execute script 'dlc_entry' due to unhandled exception!")
        self.failed(code=codes.SMOKE_FAIL, detail={"output": out})
        llm = Llm(RETRY)
        d = supervisor.decide(self.s, self.cfg, "R1", llm)
        self.assertEqual((d["action"], d["by"], d.get("engine_fault")), ("person", "rule", True))
        self.assertEqual(llm.calls, [])

    def test_a_block_a_retry_can_remove_goes_to_the_model(self):
        self.failed(code=codes.NO_PROGRESS, detail={"blocked_kind": "other"})
        llm = Llm(RETRY)
        self.assertEqual(supervisor.decide(self.s, self.cfg, "R1", llm)["by"], "model")
        self.assertEqual(len(llm.calls), 1)

    def test_high_impact_or_no_hint_goes_to_a_person(self):
        for data in ({"impact": "high", "action": "retry", "reason": "touches production", "hint": "x"},
                     {"impact": "low", "action": "retry", "reason": "?", "hint": ""},
                     {"impact": "low", "action": "person", "reason": "scope change"}):
            self.f = make_fakes()
            self.s = self.f.store
            self.failed()
            self.assertEqual(supervisor.decide(self.s, self.cfg, "R1", Llm(data))["action"], "person", data)
        self.failed(run="R9")
        self.assertEqual(supervisor.decide(self.s, self.cfg, "R9", Llm(RuntimeError("down")))["action"], "person")

    def test_retries_and_money_are_capped(self):
        self.failed("R1", rdetail={"supervised": "1", "spent_usd": 1.0})
        self.failed("R2", rdetail={"supervised": "1", "spent_usd": 1.0, "retry_of": "R1"})
        self.failed("R3", rdetail={"retry_of": "R2"})
        d = supervisor.decide(self.s, self.cfg, "R3", Llm(RETRY))
        self.assertEqual((d["action"], d["by"]), ("person", "rule"))
        self.assertIn("2 time(s)", d["reason"])
        cfg = load_config(env={"LINE_SUPERVISOR": "1", "LINE_SUPERVISE_MAX_RETRIES": "5",
                               "LINE_SUPERVISE_MAX_USD": "1.5"}, line_json=None, rag_local_json=None)
        d = supervisor.decide(self.s, cfg, "R3", Llm(RETRY))
        self.assertIn("cap $1.50", d["reason"])

    def test_retries_of_the_same_run_are_capped_too(self):
        mine = [{"n": i, "code": "X%d" % i, "by": "supervisor", "actor": "the supervisor", "spent_usd": 0}
                for i in (1, 2)]
        self.failed(rdetail={"attempts": mine})
        d = supervisor.decide(self.s, self.cfg, "R1", Llm(RETRY))
        self.assertEqual((d["action"], d["by"]), ("person", "rule"))
        self.assertIn("2 time(s)", d["reason"])

    def test_off_with_the_fake_model(self):
        self.assertFalse(supervisor.enabled(load_config(env={}, line_json=None, rag_local_json=None)))
        self.assertTrue(supervisor.enabled(types.SimpleNamespace(supervisor="auto", llm="cli")))


OLD_TEST = """import unittest


class TestF1(unittest.TestCase):
    def test_c7(self):
        self.assertTrue(True)

    def test_c8(self):
        # the earlier request kept the bug
        self.assertTrue(False)
"""

SMOKE = """======
FAIL: test_c8 (tests.acceptance.test_58b0_f1.TestF1.test_c8)
------
Traceback ...
FAIL: test_c1 (tests.acceptance.test_0a07_f1.TestF1.test_c1)
Ran 49 tests
FAILED (failures=2)"""


class RetireTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dlc-retire-")
        self.repo = os.path.join(self.d, "repo")
        os.makedirs(os.path.join(self.repo, "tests", "acceptance"))
        for p in ("tests/__init__.py", "tests/acceptance/__init__.py"):
            open(os.path.join(self.repo, *p.split("/")), "w").close()
        with open(os.path.join(self.repo, "tests", "acceptance", "test_58b0_f1.py"), "w", encoding="utf-8",
                  newline="\n") as fh:
            fh.write(OLD_TEST)
        # as the engine runs git (line.ship._util.git): no CRLF conversion
        run = lambda *a: subprocess.run(["git", "-c", "core.autocrlf=false", *a], cwd=self.repo, check=True,
                                        capture_output=True)
        run("init", "-q")
        run("add", "-A")
        run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c")
        self.f = make_fakes()
        self.s = self.f.store
        self.s.put(E_ACC_TEST, "R0:T_F1_C8", {"id": "T_F1_C8", "run": "R0", "path": "tests/acceptance/test_58b0_f1.py",
                                              "locked": True}, run="R0")
        self.s.put(E_ACC_TEST, "R1:T_F1_C1", {"id": "T_F1_C1", "run": "R1", "path": "tests/acceptance/test_0a07_f1.py",
                                              "locked": True}, run="R1")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_failing_tests_and_their_owners(self):
        ids = retire.failing_tests(SMOKE)
        self.assertEqual(ids, ["tests.acceptance.test_58b0_f1.TestF1.test_c8", "tests.acceptance.test_0a07_f1.TestF1.test_c1"])
        self.assertEqual(retire.owners(self.s, ids), {ids[0]: "R0", ids[1]: "R1"})

    def test_retire_skips_the_method_in_one_commit(self):
        out = retire.retire(self.repo, "tests.acceptance.test_58b0_f1.TestF1.test_c8", "the bug fix supersedes it", "R1")
        self.assertTrue(out["commit"])
        r = subprocess.run([sys.executable, "-m", "unittest", "tests.acceptance.test_58b0_f1", "-v"], cwd=self.repo,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("skipped", r.stderr)
        self.assertIn("ok", r.stderr)                    # test_c7 still runs
        log = subprocess.run(["git", "log", "-1", "--format=%s"], cwd=self.repo, capture_output=True, text=True).stdout
        self.assertIn("retire tests.acceptance.test_58b0_f1.TestF1.test_c8", log)

    def test_supervisor_retires_only_earlier_runs_tests(self):
        self.s.put(E_RUN, "R1", Run("R1", self.d, state="escalated", detail={"name": "bug fix", "target": self.repo}),
                   run="R1")
        self.s.put(E_RUN, "R0", Run("R0", self.d, state="green", detail={"name": "restyle"}), run="R0")
        self.s.put(E_ESCALATION, "R1:run", {"code": codes.SMOKE_FAIL, "run": "R1", "message": "smoke failed",
                                            "detail": {"code": codes.SMOKE_FAIL, "output": SMOKE}}, run="R1")
        cfg = load_config(env={"LINE_SUPERVISOR": "1"}, line_json=None, rag_local_json=None)
        llm = Llm({"impact": "low", "action": "retry", "reason": "the restyle locked the bug this request fixes",
                   "hint": "Fix the off-by-one.", "retire_tests": ["tests.acceptance.test_58b0_f1.TestF1.test_c8",
                                                                  "tests.acceptance.test_0a07_f1.TestF1.test_c1"]})
        d = supervisor.decide(self.s, cfg, "R1", llm)
        self.assertIn("locked by run R0: restyle", llm.calls[0][1])
        self.assertIn("FAIL: test_c8", llm.calls[0][1])                  # the output reaches the supervisor
        self.assertEqual(d["retire_tests"], ["tests.acceptance.test_58b0_f1.TestF1.test_c8"])   # never its own test
        with mock.patch("line.reopen.reopen", return_value={"run": "R1", "attempt": 2, "to": "building"}):
            out = supervisor.act(self.s, cfg, "R1", d)
        self.assertEqual([r["test"] for r in out["retired"]], ["tests.acceptance.test_58b0_f1.TestF1.test_c8"])
        self.assertEqual(out["reopened"], 2)


if __name__ == "__main__":
    unittest.main()
