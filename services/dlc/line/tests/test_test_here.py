"""Acceptance tests run where they will run before the lock (line.understand.test_here), a supervised retry keeps
the failed attempt's tests (Pipeline._earlier_tests, supervisor rewrite_tests)."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import types
import unittest

from line import codes, supervisor
from line.config import load_config
from line.contracts import E_ACC_TEST, E_ESCALATION, E_RUN, AccTest, Criterion, Digest, FItem, LlmResult, Run
from line.tests.fakes import make_fakes
from line.understand import test_here

APP = "def add(a, b):\n    return a - b\n"
GIT_TEST = '''import subprocess
import unittest

from calc import add


class TestF1(unittest.TestCase):
    def test_c1(self):  # trace: F1.C1 spec.md#L1-2
        subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True)
        self.assertEqual(add(2, 2), 4)
'''
FIXED_TEST = GIT_TEST.replace('        subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True)\n', "")


def _git(repo, *args):
    subprocess.run(["git", "-c", "user.email=t@x", "-c", "user.name=t", *args], cwd=repo, check=True,
                   capture_output=True)


def _repo():
    d = tempfile.mkdtemp(prefix="dlc-here-")
    _git(d, "init", "-q", "-b", "main")
    with open(os.path.join(d, "calc.py"), "w", encoding="utf-8") as fh:
        fh.write(APP)
    _git(d, "add", "-A")
    _git(d, "commit", "-q", "-m", "app")
    return d


def _write(repo, rel, text):
    full = os.path.join(repo, *rel.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _tests():
    return [AccTest(id="T_F1_C1", f_item="F1", criterion="F1.C1", span_id="spec.md#L1-2",
                    path="tests/acceptance/test_f1.py", name="tests.acceptance.test_f1.TestF1.test_c1")]


class Agent:
    """agentic(): writes `fix` over the test file in the work dir (None: changes nothing)."""

    def __init__(self, fix):
        self.fix, self.calls = fix, []

    def agentic(self, role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
        self.calls.append((role, workdir, prompt))
        if self.fix is not None:
            _write(workdir, "tests/acceptance/test_f1.py", self.fix)
        return LlmResult(None, "", {}, 0.2, "m", "SUBMIT")


class SuspectsTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dlc-sus-")
        _write(self.d, "NotesApp/client/App.jsx", "export default 1\n")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_a_missing_part_of_the_change_is_red_a_missing_tool_is_broken(self):
        tests = [AccTest(id="T%d" % i, f_item="F1" if i < 5 else "F2", criterion="F1.C%d" % i, span_id="s",
                         path="tests/acceptance/test_f1.py", name="n%d" % i) for i in range(1, 7)]
        outs = {
            "T1": {"outcome": "error", "tail": "ModuleNotFoundError: No module named 'NotesApp.client.noteSelect'"},
            "T2": {"outcome": "error", "tail": "Error: Cannot find module './NotesApp/client/noteSelect.js'"},
            "T3": {"outcome": "error", "tail": "FileNotFoundError: [WinError 2] No such file or directory: 'git'"},
            "T4": {"outcome": "error", "tail": 'TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".jsx"'
                                               " for C:/x/NotesApp/client/App.jsx"},
            "T5": {"outcome": "pass", "tail": ""},
            "T6": {"outcome": "pass", "tail": ""},
        }
        got = test_here.suspects(self.d, tests, outs)
        self.assertEqual([b["test"] for b in got["broken"]], ["T3", "T4"])
        self.assertEqual(got["all_green"], ["F2"])


class SettleTest(unittest.TestCase):
    def setUp(self):
        self.repo = _repo()
        _write(self.repo, "tests/__init__.py", "")
        _write(self.repo, "tests/acceptance/__init__.py", "")
        _write(self.repo, "tests/acceptance/test_f1.py", GIT_TEST)
        self.cfg = load_config(env={"LINE_TESTS_HERE": "1"}, line_json=None, rag_local_json=None)
        self.digest = Digest("pv", "R", f_items=[FItem(id="F1", title="add", quote="q", span_ids=["spec.md#L1-2"],
                                                       criteria=[Criterion("F1.C1", "F1", "adds", "spec.md#L1-2", "q")])])

    def tearDown(self):
        shutil.rmtree(self.repo, ignore_errors=True)

    def test_git_works_in_the_checkout_but_not_in_the_qas_copy(self):
        agent = Agent(FIXED_TEST)
        gate = test_here.settle(self.repo, _tests(), agent, run="R1", digest=self.digest, cfg=self.cfg)
        self.assertTrue(gate.ok, gate.detail)
        self.assertEqual(len(agent.calls), 1)
        self.assertIn("rev-parse", agent.calls[0][2])                 # the agent saw the machine's error
        self.assertFalse(os.path.exists(os.path.join(agent.calls[0][1], ".git")))
        self.assertEqual(gate.detail["outcomes"], {"T_F1_C1": "fail"})  # red on the bug only
        with open(os.path.join(self.repo, "tests", "acceptance", "test_f1.py"), encoding="utf-8") as fh:
            self.assertNotIn("rev-parse", fh.read())                   # the fixed file is back in the repo

    def test_still_broken_after_the_round_stops_before_the_build(self):
        gate = test_here.settle(self.repo, _tests(), Agent(None), run="R1", digest=self.digest, cfg=self.cfg)
        self.assertFalse(gate.ok)
        self.assertEqual(gate.code, codes.TEST_BROKEN_HERE)

    def test_nothing_broken_no_agent_call(self):
        _write(self.repo, "tests/acceptance/test_f1.py", FIXED_TEST)
        agent = Agent(None)
        self.assertTrue(test_here.settle(self.repo, _tests(), agent, run="R1", digest=self.digest, cfg=self.cfg).ok)
        self.assertEqual(agent.calls, [])


class Llm:
    def __init__(self, data):
        self.data, self.calls = data, []

    def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
        self.calls.append((role, prompt))
        return LlmResult(self.data, "", {}, 0.01, "m", "")


class RetryKeepsTestsTest(unittest.TestCase):
    def setUp(self):
        self.repo = _repo()
        self.f = make_fakes()
        self.s = self.f.store

    def tearDown(self):
        shutil.rmtree(self.repo, ignore_errors=True)

    def _locked(self, run, f, path):
        t = AccTest(id="T_%s_C1" % f, f_item=f, criterion="%s.C1" % f, span_id="spec.md#L%s" % f[-1], path=path,
                    name=path[:-3].replace("/", ".") + ".Test%s.test_c1" % f, sha="x", locked=True)
        self.s.put(E_ACC_TEST, "%s:%s" % (run, t.id), dict(t.__dict__, run=run), run=run)

    def test_supervisor_names_the_own_tests_to_write_again(self):
        pack = os.path.join(self.repo, "pack")
        os.makedirs(pack)
        with open(os.path.join(pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# Bug\n")
        self.s.put(E_RUN, "R1", Run("R1", pack, state="escalated", detail={"name": "P3", "target": self.repo,
                                                                           "tests_commit": "abc123"}), run="R1")
        self.s.put(E_ESCALATION, "R1:U1", {"code": codes.BLOCKED_OUTSIDE_CLAIMS, "unit": "U1", "run": "R1",
                                           "message": "test_f2 cannot run here", "detail": {"blocked_kind": "test"}},
                   run="R1")
        self._locked("R1", "F1", "tests/acceptance/test_r1_f1.py")
        self._locked("R1", "F2", "tests/acceptance/test_r1_f2.py")
        cfg = load_config(env={"LINE_SUPERVISOR": "1"}, line_json=None, rag_local_json=None)
        llm = Llm({"impact": "low", "action": "retry", "reason": "F2's test needs a converter",
                   "hint": "F2 tests must read App.jsx as text", "rewrite_tests": ["tests.acceptance.test_r1_f2.TestF2.test_c1"]})
        d = supervisor.decide(self.s, cfg, "R1", llm)
        self.assertIn("THIS RUN'S OWN LOCKED TESTS", llm.calls[0][1])
        self.assertEqual(d["rewrite_tests"], ["F2"])
        out = supervisor.act(self.s, cfg, "R1", d)          # the same run again (line.reopen), no new run
        self.assertEqual(out["reopened"], 2)
        det = self.s.get(E_RUN, "R1")["detail"]
        self.assertEqual((det["retest"]["sha"], det["retest"]["rewrite"]), ("abc123", ["F2"]))
        self.assertNotIn("tests_commit", det)                  # the tests are made again before the build
        self.assertFalse(self.s.get(E_ACC_TEST, "R1:T_F2_C1")["locked"])

    def test_a_run_retried_in_place_gets_its_own_kept_tests_back(self):
        from line.pipeline import Pipeline
        _write(self.repo, "tests/acceptance/test_r1_f1.py", "# trace: F1.C1 spec.md#L1\nF1 = 1\n")
        _write(self.repo, "tests/acceptance/test_r1_f2.py", "# trace: F2.C1 spec.md#L2\nF2 = 1\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "line R1: acceptance tests (locked)")
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.repo, capture_output=True, text=True).stdout.strip()
        _git(self.repo, "revert", "--no-edit", "HEAD")                     # the failed attempt's tests left main
        self._locked("R1", "F1", "tests/acceptance/test_r1_f1.py")
        self._locked("R1", "F2", "tests/acceptance/test_r1_f2.py")
        own = [self.s.get(E_ACC_TEST, "R1:T_F1_C1"), self.s.get(E_ACC_TEST, "R1:T_F2_C1")]
        self.s.put(E_RUN, "R1", Run("R1", "/p", state="planning", detail={
            "retest": {"sha": sha, "rewrite": ["F2"], "note": "F2 tests must read App.jsx as text", "tests": own}}),
            run="R1")
        p = Pipeline.__new__(Pipeline)
        p.store, p.sstore, p.repo, p.run = self.s, self.s, self.repo, "R1"
        p.log = lambda m: None
        digest = Digest("pv", "R", f_items=[FItem(id=f, title=f, quote="q", span_ids=["spec.md#L%s" % f[-1]], criteria=[
            Criterion("%s.C1" % f, f, "t", "spec.md#L%s" % f[-1], "q")]) for f in ("F1", "F2")])
        kept, earlier = p._earlier_tests(digest)
        self.assertEqual([t.f_item for t in kept], ["F1"])
        self.assertTrue(os.path.isfile(os.path.join(self.repo, "tests", "acceptance", "test_r1_f1.py")))
        self.assertEqual(list(earlier), ["F2"])
        self.assertEqual(earlier["F2"]["note"], "F2 tests must read App.jsx as text")

    def test_the_retry_restores_the_kept_files_and_shows_the_old_ones_to_rewrite(self):
        from line.pipeline import Pipeline
        _write(self.repo, "tests/acceptance/test_r1_f1.py", "# trace: F1.C1 spec.md#L1\nF1 = 1\n")
        _write(self.repo, "tests/acceptance/test_r1_f2.py", "# trace: F2.C1 spec.md#L2\nF2 = 1\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "line R1: acceptance tests (locked)")
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.repo, capture_output=True, text=True).stdout.strip()
        _git(self.repo, "revert", "--no-edit", "HEAD")                     # the failed run's tests left main
        self.s.put(E_RUN, "R1", Run("R1", "/p", state="escalated", detail={
            "tests_commit": sha, "supervisor": {"hint": "F2 tests must read App.jsx as text"}}), run="R1")
        self._locked("R1", "F1", "tests/acceptance/test_r1_f1.py")
        self._locked("R1", "F2", "tests/acceptance/test_r1_f2.py")
        self.s.put(E_RUN, "R2", Run("R2", "/p", state="understanding", detail={
            "retry_of": "R1", "supervised": "1", "rewrite_tests": "F2"}), run="R2")
        p = Pipeline.__new__(Pipeline)
        p.store, p.sstore, p.repo, p.run = self.s, self.s, self.repo, "R2"
        p.log = lambda m: None
        digest = Digest("pv", "R", f_items=[FItem(id=f, title=f, quote="q", span_ids=["spec.md#L%s" % f[-1]], criteria=[
            Criterion("%s.C1" % f, f, "t", "spec.md#L%s" % f[-1], "q")]) for f in ("F1", "F2")])
        kept, earlier = p._earlier_tests(digest)
        self.assertEqual([t.f_item for t in kept], ["F1"])
        self.assertTrue(os.path.isfile(os.path.join(self.repo, "tests", "acceptance", "test_r1_f1.py")))
        self.assertFalse(os.path.exists(os.path.join(self.repo, "tests", "acceptance", "test_r1_f2.py")))
        self.assertIn("F2 = 1", earlier["F2"]["content"])
        self.assertIn("App.jsx as text", earlier["F2"]["note"])
        self.assertEqual(len([r for r in self.s.query(E_ACC_TEST, run="R2")]), 1)
        # a retry a person started (not supervised) writes every test again, as before
        self.s.put(E_RUN, "R3", Run("R3", "/p", state="understanding", detail={"retry_of": "R1"}), run="R3")
        p.run = "R3"
        self.assertEqual(p._earlier_tests(digest), ([], {}))


if __name__ == "__main__":
    unittest.main()
