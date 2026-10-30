"""S5 build side: worktree sandbox, builder (SUBMIT / BLOCKED / lost lease), verifier gates, retry ladder.

Every test works on a fresh temp git repo and its own temp workroot; all worktrees are removed.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
import time
import unittest

from line import codes
from line.build import builder, verifier
from line.build.builder import Heartbeat, dispatch, run_builder
from line.build.sandbox import Sandbox
from line.build.verifier import Decision, decide, parse_unittest, verify
from line.config import load_config
from line.contracts import (
    E_ACC_TEST, E_ATTEMPT, E_UNIT, AccTest, Attempt, Unit, UnitState, to_dict, unit_lease_name,
)
from line.tests.fakes import FakeLlm, make_fakes

TEST_F1 = """import unittest

from todo.store import add


class T(unittest.TestCase):
    def test_c1(self):
        self.assertEqual(add(2), 3)
"""
GOOD = "def add(x):\n    return x + 1\n"
BAD = "def add(x):\n    return x\n"
BAD2 = "def add(x):\n    return x + 5\n"


def git(cwd, *args):
    p = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args], cwd=cwd,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode())
    return p.stdout.decode()


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _rmtree(path):
    def onerr(fn, p, _):
        try:
            os.chmod(p, 0o700)
            fn(p)
        except OSError:
            pass
    shutil.rmtree(path, onerror=onerr)


class GitCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-s5-")
        self.repo = os.path.join(self.tmp, "repo")
        self.work = os.path.join(self.tmp, "work")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q")
        git(self.repo, "config", "core.autocrlf", "false")
        write(self.repo, "todo/__init__.py", "")
        write(self.repo, "todo/store.py", "def add(x):\n    raise NotImplementedError\n")
        write(self.repo, "tests/__init__.py", "")
        write(self.repo, "tests/test_f1.py", TEST_F1)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "init")
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=self.work,
                               model="m-main", model_alt="m-alt", retry_n=3)
        self.f = make_fakes()
        self.llm = FakeLlm(model="m-main")
        self.sb = Sandbox(self.repo, self.work)
        sha = hashlib.sha256(TEST_F1.encode()).hexdigest()
        self.f.store.put(E_ACC_TEST, "T_F1_C1",
                         to_dict(AccTest("T_F1_C1", "F1", "F1.C1", "spec.md#L1-2", "tests/test_f1.py",
                                         "tests.test_f1.T.test_c1", sha, True)), run="R1")
        self.unit = Unit("U1", "R1", title="add", state=UnitState.READY.value, claims=["todo/store.py"],
                         f_items=["F1"], tests=["T_F1_C1"], size="S")
        self.f.store.put(E_UNIT, "U1", to_dict(self.unit), run="R1")

    def tearDown(self):
        for path in (os.path.join(self.work, "R1", "U1"),):
            if os.path.isdir(path):
                self.sb.cleanup(self.unit, delete_branch=True)
        git(self.repo, "worktree", "prune")
        _rmtree(self.tmp)

    # helpers
    def attempt(self, answer):
        """dispatch + run_builder + (on SUBMIT) verify; returns (BuildResult, Gate|None)."""
        self.llm.add("builder", answer)
        got = dispatch("U1", self.f.store, self.f.leases, self.sb, self.cfg)
        self.assertIsNotNone(got)
        u, lease = got
        res = run_builder(u, lease, self.llm, self.f.store, leases=self.f.leases, cfg=self.cfg)
        g = verify("U1", res.attempt, self.f.store, self.sb, self.cfg) if res.outcome == "SUBMIT" else None
        return res, g

    def state(self):
        return self.f.store.get(E_UNIT, "U1")["state"]

    def kinds(self):
        return [e.kind for e in self.f.store.events_after(0)]


class SandboxTest(GitCase):
    def test_create_diff_cleanup(self):
        path = self.sb.create(self.unit)
        self.assertTrue(os.path.isfile(os.path.join(path, "todo", "store.py")))
        self.assertTrue(path.startswith(os.path.abspath(self.work)))
        self.assertIn("line/R1/U1", git(self.repo, "branch", "--list", "line/*"))
        self.assertTrue(self.sb.diff(self.unit).empty)
        self.assertEqual(self.sb.create(self.unit), path)            # idempotent: reused
        write(path, "todo/store.py", GOOD)
        write(path, "todo/new.py", "X = 1\n")
        write(path, "todo/__pycache__/store.cpython-310.pyc", "noise")
        d = self.sb.diff(self.unit)
        self.assertEqual(sorted(d.files), [("A", "todo/new.py"), ("M", "todo/store.py")])
        self.assertIn("+    return x + 1", d.patch)
        self.assertTrue(d.sha)
        git(path, "-c", "user.name=b", "-c", "user.email=b@example.invalid", "commit", "-qam", "wip")
        self.assertIn(("M", "todo/store.py"), self.sb.diff(self.unit).files)   # committed work still counts
        self.sb.cleanup(self.unit, delete_branch=True)
        self.assertFalse(os.path.exists(path))
        self.assertNotIn(os.path.basename(path), git(self.repo, "worktree", "list"))
        self.assertEqual(git(self.repo, "branch", "--list", "line/*").strip(), "")

    def test_a_big_change_without_gitignore_keeps_node_modules_out(self):
        path = self.sb.create(self.unit)
        for i in range(30):                      # a builder's npm install in a new app without a .gitignore
            write(path, "app/node_modules/pkg%d/index.js" % i, "module.exports = 1\n")
        for i in range(450):                     # and a change too long for one Windows command line
            write(path, "app/src/%s_%03d.js" % ("x" * 60, i), "export const v = %d\n" % i)
        d = self.sb.diff(self.unit)
        self.assertEqual(len(d.files), 450)
        self.assertFalse([p for p in d.paths if "node_modules" in p])
        self.assertEqual(d.patch.count("diff --git"), 450)


class TestEnvTest(unittest.TestCase):
    def test_the_verifier_sees_the_machine_folders_a_builder_sees(self):
        from unittest import mock
        from line.build import verifier
        from line.stacks.base import test_env
        with mock.patch.dict(os.environ, {"ProgramFiles": r"C:\PF", "LOCALAPPDATA": r"C:\LA", "SECRET_TOKEN": "x"}):
            for env in (verifier._test_env(), test_env()):
                self.assertEqual(env.get("ProgramFiles"), r"C:\PF")
                self.assertEqual(env.get("LOCALAPPDATA"), r"C:\LA")
                self.assertNotIn("SECRET_TOKEN", env)


class BuilderTest(GitCase):
    def test_submit_then_verified(self):
        res, g = self.attempt({"files": {"todo/store.py": GOOD}})
        self.assertEqual(res.outcome, "SUBMIT")
        self.assertTrue(g.ok, g.detail)
        self.assertEqual(g.detail["ran"], 1)
        self.assertEqual(self.state(), "verified")
        ks = self.kinds()
        self.assertEqual(ks[:2], [codes.UNIT_DISPATCHED, codes.UNIT_SUBMITTED])
        ev = self.f.store.events_after(0, kinds=[codes.UNIT_SUBMITTED])[0]
        self.assertEqual(ev.env.epoch, 1)
        self.assertIsNone(self.f.leases.current(unit_lease_name("U1")))     # released after submit
        a = self.f.store.get(E_ATTEMPT, "U1#1")
        self.assertEqual((a["outcome"], a["model"]), ("verified", "m-main"))
        call = self.llm.calls[0]
        self.assertEqual(call["workdir"], self.sb.path(self.unit))
        self.assertIn("todo/store.py", call["prompt"])
        self.assertIn("python -m unittest tests.test_f1.T.test_c1", call["prompt"])

    def test_blocked_goes_waiting(self):
        res, g = self.attempt("BLOCKED:storage contract missing")
        self.assertEqual((res.outcome, res.reason), ("BLOCKED", "storage contract missing"))
        self.assertIsNone(g)
        self.assertEqual(self.state(), "waiting")
        ev = self.f.store.events_after(0, kinds=[codes.UNIT_BLOCKED])
        self.assertEqual(ev[0].body, {"reason": "storage contract missing"})
        self.assertEqual(self.f.store.get(E_UNIT, "U1")["detail"]["blocked_reason"], "storage contract missing")
        self.assertEqual(self.f.store.get(E_ATTEMPT, "U1#1")["outcome"], "blocked")
        self.assertIn("BLOCKED:storage contract missing", self.f.store.get(E_ATTEMPT, "U1#1")["detail"]["final"])
        self.assertIsNone(self.f.leases.current(unit_lease_name("U1")))

    def test_lost_lease_writes_nothing(self):
        def steal(role, prompt, **kw):
            self.f.clock.advance(self.cfg.lease_ttl_s + 1)            # heartbeat never ran: lease expires
            self.assertIsNotNone(self.f.leases.acquire(unit_lease_name("U1"), "other"))
            return "SUBMIT"
        res, g = self.attempt(steal)
        self.assertEqual((res.outcome, res.code), ("LOST", codes.LEASE_LOST))
        self.assertEqual(self.state(), "leased")
        self.assertNotIn(codes.UNIT_SUBMITTED, self.kinds())
        self.assertEqual(self.f.store.get(E_ATTEMPT, "U1#1")["outcome"], "lost")

    def test_llm_error_requeues(self):
        from line.codes import LineError
        res, _ = self.attempt(LineError(codes.LLM_ERROR, "boom"))
        self.assertEqual((res.outcome, res.code), ("ERROR", codes.LLM_ERROR))
        self.assertEqual(self.state(), "ready")
        self.assertIn(codes.UNIT_REQUEUED, self.kinds())

    def test_heartbeat_renews(self):
        lease = self.f.leases.acquire("unit:HB", "b")
        before = lease.expires_ms
        self.f.clock.advance(10)
        with Heartbeat(self.f.leases, lease, 0.01) as hb:
            deadline = time.time() + 2
            while hb.renewals == 0 and time.time() < deadline:
                time.sleep(0.01)
        self.assertGreater(hb.renewals, 0)
        self.assertGreater(self.f.leases.current("unit:HB").expires_ms, before)
        self.assertIsNone(hb.lost)


class VerifierGateTest(GitCase):
    def test_write_outside_claim(self):
        res, g = self.attempt({"files": {"todo/store.py": GOOD, "todo/extra.py": "Y = 2\n"}})
        self.assertEqual(g.code, codes.CLAIM_VIOLATION)
        self.assertEqual(g.detail["outside"], ["todo/extra.py"])
        self.assertEqual(self.state(), "ready")                      # retry rung 0
        ev = self.f.store.events_after(0, kinds=[codes.VERIFY_FAILED])[0]
        self.assertEqual((ev.body["code"], ev.body["decision"]), (codes.CLAIM_VIOLATION, "retry"))

    def test_edit_locked_test(self):
        res, g = self.attempt({"files": {"todo/store.py": BAD,
                                         "tests/test_f1.py": TEST_F1.replace("3)", "2)")}})
        self.assertEqual(g.code, codes.TEST_TAMPER)
        self.assertEqual(g.detail["tests"], ["tests/test_f1.py"])

    def test_secret_in_diff(self):
        res, g = self.attempt({"files": {"todo/store.py": GOOD + 'AWS = "AKIAABCDEFGHIJKLMNOP"\n'}})
        self.assertEqual(g.code, codes.SECRET_FOUND)
        self.assertEqual(g.detail["secrets"], [{"file": "todo/store.py", "line": 3, "rule": "aws_access_key"}])
        self.assertNotIn("AKIAABCDEFGHIJKLMNOP", str(g.detail))

    def test_empty_diff_no_progress(self):
        res, g = self.attempt("SUBMIT")
        self.assertEqual(g.code, codes.NO_PROGRESS)
        self.assertIn("not green without a change", g.detail["evidence"])
        self.assertEqual(self.state(), "ready")

    def test_empty_diff_already_satisfied_passes(self):
        # regression (real run): a contract unit merged earlier already implemented the behaviour, the
        # builder rightly changed nothing, and the gate failed it NO_PROGRESS, forcing junk code on attempt 2
        write(self.repo, "todo/store.py", GOOD)
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qam", "contract")
        res, g = self.attempt("SUBMIT")
        self.assertTrue(g.ok, g.detail)
        self.assertTrue(g.detail.get("already_satisfied"))
        self.assertEqual((g.detail["files"], g.detail["ran"]), ([], 1))
        self.assertEqual(self.state(), "verified")
        ev = [e for e in self.f.store.events_after(0, kinds=[codes.UNIT_STATE]) if e.body.get("to") == "verified"]
        self.assertTrue(ev and ev[-1].body.get("already_satisfied"))

    def test_empty_diff_with_tampered_locked_test_is_not_satisfied(self):
        # the locked test on the base differs from the locked sha: an empty diff never passes then
        write(self.repo, "todo/store.py", GOOD)
        write(self.repo, "tests/test_f1.py", TEST_F1 + "# changed\n")
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qam", "drift")
        res, g = self.attempt("SUBMIT")
        self.assertEqual(g.code, codes.NO_PROGRESS)

    def test_syntax_error_build_fail(self):
        res, g = self.attempt({"files": {"todo/store.py": "def add(x)\n    return x\n"}})
        self.assertEqual(g.code, codes.BUILD_FAIL)
        self.assertTrue(g.fingerprint)

    def test_failing_then_passing(self):
        _, g1 = self.attempt({"files": {"todo/store.py": BAD}})
        self.assertEqual(g1.code, codes.TEST_FAIL)
        self.assertTrue(g1.fingerprint)
        f = g1.detail["failures"][0]
        self.assertEqual((f["test"], f["error_type"]), ("tests.test_f1.T.test_c1", "AssertionError"))
        self.assertEqual(f["first_line"], 'File "tests/test_f1.py", line 8, in test_c1')
        self.assertEqual(g1.fingerprint,
                         verifier.fingerprint("tests.test_f1.T.test_c1", "AssertionError", f["first_line"]))
        self.assertEqual(self.state(), "ready")
        _, g2 = self.attempt({"files": {"todo/store.py": GOOD}})
        self.assertTrue(g2.ok, g2.detail)
        self.assertEqual(self.state(), "verified")
        p2 = self.llm.calls[1]["prompt"]
        self.assertIn("Previous attempt 1 failed with TEST_FAIL", p2)
        self.assertIn("AssertionError", p2)
        self.assertEqual(self.llm.calls[1]["model"], "m-main")

    def test_same_fingerprint_twice_switches_model(self):
        _, g1 = self.attempt({"files": {"todo/store.py": BAD}})
        _, g2 = self.attempt({"files": {"todo/store.py": BAD2}})       # different diff, same failure
        self.assertEqual(g1.fingerprint, g2.fingerprint)
        self.assertEqual(g2.detail["decision"]["action"], "switch_model")
        row = self.f.store.get(E_UNIT, "U1")
        self.assertEqual((row["state"], row["rung"], row["model"]), ("ready", 1, "m-alt"))
        _, g3 = self.attempt({"files": {"todo/store.py": GOOD}})
        self.assertTrue(g3.ok)
        self.assertEqual(self.llm.calls[2]["model"], "m-alt")
        self.assertEqual(self.f.store.get(E_ATTEMPT, "U1#3")["rung"], 1)

    def test_resubmitting_same_diff_is_no_progress(self):
        self.attempt({"files": {"todo/store.py": BAD}})
        _, g2 = self.attempt("SUBMIT")                                  # worktree reused, nothing new
        self.assertEqual(g2.code, codes.NO_PROGRESS)

    def test_ladder_escalates_on_alt_model(self):
        for body in (BAD, BAD2):                                        # rung 0: same failure twice
            self.attempt({"files": {"todo/store.py": body}})
        _, g3 = self.attempt({"files": {"todo/store.py": BAD}})
        _, g4 = self.attempt({"files": {"todo/store.py": BAD2}})       # rung 1: same failure twice
        self.assertEqual(g3.detail["decision"]["action"], "retry")
        self.assertEqual(g4.detail["decision"]["action"], "escalate")
        self.assertEqual(self.state(), "failed")
        self.assertTrue(self.f.store.query("escalation", run="R1"))


class MixedLadderTest(GitCase):
    """One per-unit failure count across verifier gates, BLOCKED and LLM errors (the pipeline routes
    the last two through Watchdog.record_failure): a rung never runs more than retry_n failed attempts."""

    def fail_other(self, answer, code, key):
        from line.watchdog import Watchdog
        res, g = self.attempt(answer)
        self.assertIsNone(g)
        wd = Watchdog(self.f.store, self.f.leases, self.cfg)
        return wd.record_failure("U1", code, fingerprint=key, detail={"key": key})

    def test_mixed_failures_share_one_count_per_rung(self):
        from line.codes import LineError
        d1 = self.fail_other("BLOCKED:no contract", codes.BLOCKED, "blocked-1")
        self.assertEqual((d1.action, d1.rung), ("retry", 0))
        d2 = self.fail_other(LineError(codes.LLM_ERROR, "boom"), codes.LLM_ERROR, "llm-2")
        self.assertEqual((d2.action, d2.rung), ("retry", 0))
        _, g3 = self.attempt({"files": {"todo/store.py": BAD}})          # 3rd failure on rung 0
        self.assertEqual(g3.code, codes.TEST_FAIL)
        self.assertEqual(g3.detail["decision"]["action"], "switch_model")
        row = self.f.store.get(E_UNIT, "U1")
        self.assertEqual((row["state"], row["rung"], row["model"]), ("ready", 1, "m-alt"))
        # rung 1: verify failure first, then the other kinds; the third one escalates
        _, g4 = self.attempt({"files": {"todo/store.py": BAD2}})
        self.assertEqual(g4.detail["decision"]["action"], "retry")
        d5 = self.fail_other("BLOCKED:still no contract", codes.BLOCKED, "blocked-5")
        self.assertEqual((d5.action, d5.rung), ("retry", 1))
        d6 = self.fail_other(LineError(codes.LLM_ERROR, "boom again"), codes.LLM_ERROR, "llm-6")
        self.assertEqual((d6.action, d6.rung, d6.code), ("escalate", 2, codes.LLM_ERROR))
        self.assertEqual(self.state(), "failed")
        attempts = self.f.store.query(E_ATTEMPT, run="R1")
        per_rung = {}
        for a in attempts:
            per_rung[a["rung"]] = per_rung.get(a["rung"], 0) + 1
        self.assertEqual(per_rung, {0: 3, 1: 3})
        self.assertTrue(all(n <= self.cfg.retry_n for n in per_rung.values()))
        fails = self.f.store.get(E_UNIT, "U1")["detail"]["failures"]
        self.assertEqual([f["code"] for f in fails], [codes.BLOCKED, codes.LLM_ERROR, codes.TEST_FAIL,
                                                      codes.TEST_FAIL, codes.BLOCKED, codes.LLM_ERROR])
        self.assertEqual([f["attempt"] for f in fails], [1, 2, 3, 4, 5, 6])

    def test_verify_failures_then_blocked_escalate_on_count(self):
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=self.work,
                               model="m-main", model_alt="", retry_n=2)
        _, g1 = self.attempt({"files": {"todo/store.py": BAD}})
        self.assertEqual(g1.detail["decision"]["action"], "retry")
        d2 = self.fail_other("BLOCKED:x", codes.BLOCKED, "b")               # 2nd failure on rung 0
        self.assertEqual((d2.action, d2.rung), ("switch_model", 1))
        _, g3 = self.attempt({"files": {"todo/store.py": BAD2}})
        self.assertEqual(g3.detail["decision"]["action"], "retry")
        _, g4 = self.attempt({"files": {"todo/store.py": GOOD + "\nX = 1\n"}})
        self.assertTrue(g4.ok, g4.detail)                                  # 2 failures on rung 1 max: still allowed


class LadderTest(unittest.TestCase):
    cfg = load_config(env={}, line_json=None, rag_local_json=None, model="m", model_alt="alt", retry_n=3)

    def h(self, *specs):
        return [Attempt("U1", i + 1, rung=r, code=c, fingerprint=fp, outcome="failed")
                for i, (r, c, fp) in enumerate(specs)]

    def test_retry_n_then_switch_then_escalate(self):
        tf = codes.TEST_FAIL
        self.assertEqual(decide(self.h((0, tf, "a")), self.cfg).action, "retry")
        self.assertEqual(decide(self.h((0, tf, "a"), (0, tf, "b")), self.cfg).action, "retry")
        d = decide(self.h((0, tf, "a"), (0, tf, "b"), (0, tf, "c")), self.cfg)
        self.assertEqual((d.action, d.rung, d.model), ("switch_model", 1, "alt"))
        d = decide(self.h((0, tf, "a"), (0, tf, "a")), self.cfg)
        self.assertEqual((d.action, d.model), ("switch_model", "alt"))
        d = decide(self.h((0, tf, "a"), (0, tf, "a"), (1, tf, "b"), (1, tf, "c"), (1, tf, "d")), self.cfg)
        self.assertEqual(d.action, "escalate")
        self.assertEqual(decide(self.h((0, tf, "a"), (0, tf, "a"), (1, tf, "a")), self.cfg).action, "retry")

    def test_codes_without_fingerprint_repeat_by_code(self):
        np = codes.NO_PROGRESS
        self.assertEqual(decide(self.h((0, np, ""), (0, np, "")), self.cfg).action, "switch_model")

    def test_parse_unittest_output(self):
        out = ("F\n" + "=" * 70 + "\nFAIL: test_c1 (tests.test_f2.T)\n" + "-" * 70 + "\n"
               "Traceback (most recent call last):\n"
               '  File "C:\\w\\tests\\test_f2.py", line 5, in test_c1\n    self.assertEqual(1, 2)\n'
               "AssertionError: 1 != 2\n\n" + "-" * 70 + "\nRan 1 test in 0.001s\n\nFAILED (failures=1)\n")
        ran, fails = parse_unittest(out, "C:\\w")
        self.assertEqual(ran, 1)
        self.assertEqual(fails[0]["test"], "tests.test_f2.T.test_c1")
        self.assertEqual(fails[0]["error_type"], "AssertionError")
        if os.name == "nt":
            self.assertEqual(fails[0]["first_line"], 'File "tests/test_f2.py", line 5, in test_c1')


if __name__ == "__main__":
    unittest.main()
