"""The merger agent (line.ship.merger) wired into the merge queue, against real temp git repos; and the guard
that keeps builders out of git."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import types
import unittest

from line import agent_guard, codes
from line.config import load_config
from line.contracts import E_ACC_TEST, E_RUN, E_UNIT, AccTest, Run, Unit
from line.ship import merger
from line.ship.merge_queue import MergeQueue
from line.tests.fakes import make_fakes
from line.tests.test_ship_merge import GREEN_TEST, HAS_GIT, branch, make_repo, sh, write


class Llm:
    """agentic() runs the scripted action in the merger's folder and answers its outcome."""

    def __init__(self, *steps):
        self.steps, self.calls = list(steps), []

    def agentic(self, role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
        self.calls.append({"role": role, "workdir": workdir, "prompt": prompt, "key": key})
        act, outcome = self.steps.pop(0)
        if act:
            act(workdir)
        return types.SimpleNamespace(outcome=outcome, usd=0.12, text="notes\n" + outcome)


def resolve_to(text):
    def act(wt):
        write(wt, "app.py", text)
        sh(wt, "add", "app.py")
        sh(wt, "-c", "core.editor=true", "rebase", "--continue")
    return act


@unittest.skipUnless(HAS_GIT, "git not installed")
class MergerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-merger-")
        self.repo = make_repo(self.tmp)
        self.store = make_fakes().store
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=os.path.join(self.tmp, "work"))
        self.store.put(E_RUN, "R1", Run("R1", "pack", state="integrating", spec_hash="h1"), run="R1")
        self.mq = MergeQueue(self.store, self.repo, self.cfg)
        self.env = {k: os.environ.get(k) for k in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME",
                                                   "GIT_COMMITTER_EMAIL")}
        os.environ.update(GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t",
                          GIT_COMMITTER_EMAIL="t@x")

    def tearDown(self):
        for k, v in self.env.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        subprocess.run(["git", "-C", self.repo, "worktree", "prune"], capture_output=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def unit(self, uid, files, test_body=None):
        mod = "f_" + uid.lower()
        tfile = "tests/test_%s.py" % mod
        files = dict(files)
        files[tfile] = test_body if test_body is not None else GREEN_TEST.format(mod=mod, v=1)
        files.setdefault(mod + ".py", "V = 1\n")
        branch(self.repo, "line/R1/" + uid, files)
        tid = "T_" + uid
        self.store.put(E_ACC_TEST, tid, AccTest(tid, "F" + uid[1:], "C1", "spec.md#L1-2", tfile,
                                                name="tests.test_%s.T.test_a" % mod), run="R1")
        self.store.put(E_UNIT, uid, Unit(uid, "R1", title="unit " + uid, state="verified", wave=1, tests=[tid],
                                         attempt=1), run="R1")

    def wire(self, llm):
        self.mq.resolver = merger.Merger(self.store, self.cfg, llm, spec_for=lambda row: "spec of " + row["id"])

    def two_conflicting(self):
        self.unit("U1", {"app.py": "X = 2\n"})
        self.unit("U2", {"app.py": "X = 3\n"})
        self.mq.enqueue("R1", "U1")
        self.mq.enqueue("R1", "U2")

    def test_merger_resolves_a_rebase_conflict_and_the_unit_merges(self):
        llm = Llm((resolve_to("X = 2\nY = 3\n"), "SUBMIT"))
        self.wire(llm)
        self.two_conflicting()
        o1, o2 = self.mq.drain("R1")
        self.assertTrue(o1.merged)
        self.assertTrue(o2.merged, o2.gate)
        self.assertEqual(self.store.get(E_UNIT, "U2")["state"], "merged")
        self.assertTrue(o2.detail["merger"]["resolved"])     # the merger's notes stay with the merge
        with open(os.path.join(self.repo, "app.py"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "X = 2\nY = 3\n")
        (call,) = llm.calls
        self.assertEqual(call["role"], "merger")
        for part in ("Unit U2", "app.py", "search_knowledge", "spec of U2", "<<<<<<<"):
            self.assertIn(part, call["prompt"])
        ran = self.store.events_after(0, kinds=[codes.MERGER_RAN])
        self.assertEqual([(e.body["stage"], e.body["resolved"]) for e in ran], [("rebase", True)])

    def test_blocked_merger_is_merge_blocked_and_the_rebase_is_aborted(self):
        self.wire(Llm((None, "BLOCKED: both units own X; the spec must say which wins")))
        self.two_conflicting()
        _, o2 = self.mq.drain("R1")
        self.assertFalse(o2.merged)
        self.assertEqual(o2.gate.code, codes.MERGE_BLOCKED)
        self.assertIn("which wins", o2.detail["merger"]["reason"])
        wt = self.mq._integration_dir("R1")
        self.assertFalse(merger._rebasing(wt))

    def test_unfinished_resolution_goes_back_to_the_builder(self):
        def half(wt):   # says SUBMIT but leaves the rebase in progress
            write(wt, "app.py", "X = 2\n")
        self.wire(Llm((half, "SUBMIT")))
        self.two_conflicting()
        _, o2 = self.mq.drain("R1")
        self.assertFalse(o2.merged)
        self.assertEqual(o2.gate.code, codes.MERGE_CONFLICT)
        self.assertIn("rebase is still in progress", o2.detail["merger"]["reason"])
        self.assertEqual(self.store.get(E_UNIT, "U2")["state"], "ready")
        self.assertFalse(merger._rebasing(self.mq._integration_dir("R1")))

    def test_merger_may_not_touch_locked_tests(self):
        red = "import unittest\nclass T(unittest.TestCase):\n    def test_a(self):\n        self.fail('red')\n"
        self.unit("U1", {}, test_body=red)

        def cheat(wt):  # turns the locked test green instead of fixing the code
            write(wt, "tests/test_f_u1.py", GREEN_TEST.format(mod="f_u1", v=1))
            sh(wt, "commit", "-qam", "cheat")
        self.wire(Llm((cheat, "SUBMIT")))
        self.mq.enqueue("R1", "U1")
        (o,) = self.mq.drain("R1")
        self.assertFalse(o.merged)
        self.assertEqual(o.gate.code, codes.MERGE_TESTS_RED)
        self.assertIn("locked acceptance tests were changed", o.detail["merger"]["reason"])

    def test_calls_per_unit_are_capped(self):
        cfg = load_config(env={}, line_json=None, rag_local_json=None, merger_max_calls=1)
        m = merger.Merger(self.store, cfg, Llm())
        self.assertTrue(m.may_try({"detail": {}}))
        self.assertFalse(m.may_try({"detail": {"merger_calls": 1}}))

    def test_enabled(self):
        on = lambda **kw: merger.enabled(types.SimpleNamespace(**kw))  # noqa: E731
        self.assertFalse(on(merger="auto", llm="fake"))
        self.assertTrue(on(merger="auto", llm="cli"))
        self.assertFalse(on(merger="0", llm="cli"))


class BuilderGitGuardTest(unittest.TestCase):
    def test_builders_only_implement(self):
        for cmd in ("git commit -am x", "git -C . rebase main", "cd sub && git merge other", "git checkout -b x",
                    "git reset --hard HEAD~1", "git -c core.editor=true rebase --continue", "git stash"):
            self.assertIn("not for builders", agent_guard.check(cmd, ".", "builder"), cmd)
            self.assertIn("not for builders", agent_guard.check(cmd, ".", "fixer"), cmd)
            self.assertEqual(agent_guard.check(cmd, ".", "merger"), "", cmd)
        for cmd in ("git status", "git diff HEAD", "git log --oneline --grep=merge", "python -m unittest"):
            self.assertEqual(agent_guard.check(cmd, ".", "builder"), "", cmd)
        self.assertIn("main / master", agent_guard.check("git push origin main", ".", "merger"))


if __name__ == "__main__":
    unittest.main()
