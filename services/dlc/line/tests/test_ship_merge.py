"""Merge queue (block 15) against real temp git repos and FakeStore."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest

from line import codes
from line.config import load_config
from line.contracts import E_ACC_TEST, E_MERGE, E_RUN, E_UNIT, AccTest, Run, Unit
from line.ship.merge_queue import MergeQueue
from line.tests.fakes import make_fakes

HAS_GIT = shutil.which("git") is not None


def sh(repo: str, *args: str) -> str:
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t",
               GIT_COMMITTER_EMAIL="t@x")
    cp = subprocess.run(["git", "-c", "core.autocrlf=false", "-C", repo] + list(args), capture_output=True,
                        text=True, env=env)
    if cp.returncode != 0:
        raise AssertionError("git %s: %s" % (args, cp.stderr))
    return cp.stdout.strip()


def write(repo: str, rel: str, text: str) -> None:
    p = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def commit(repo: str, files: dict, msg: str) -> str:
    for rel, text in files.items():
        write(repo, rel, text)
    sh(repo, "add", "-A")
    sh(repo, "commit", "-q", "-m", msg)
    return sh(repo, "rev-parse", "HEAD")


def make_repo(root: str, files: dict = None) -> str:
    repo = os.path.join(root, "repo")
    os.makedirs(repo)
    sh(repo, "init", "-q", "-b", "main")
    commit(repo, files or {"app.py": "X = 1\n", "tests/__init__.py": ""}, "init")
    return repo


def branch(repo: str, name: str, files: dict, base: str = "main") -> str:
    sh(repo, "checkout", "-q", "-b", name, base)
    sha = commit(repo, files, name)
    sh(repo, "checkout", "-q", "main")
    return sha


GREEN_TEST = "import unittest\nclass T(unittest.TestCase):\n    def test_a(self):\n        import {mod}\n        self.assertEqual({mod}.V, {v})\n"
RED_TEST = "import unittest\nclass T(unittest.TestCase):\n    def test_a(self):\n        self.fail('red')\n"


@unittest.skipUnless(HAS_GIT, "git not installed")
class MergeQueueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-mq-")
        self.repo = make_repo(self.tmp)
        self.f = make_fakes()
        self.store = self.f.store
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=os.path.join(self.tmp, "work"))
        self.store.put(E_RUN, "R1", Run("R1", "pack", state="integrating", spec_hash="h1"), run="R1")
        self.mq = MergeQueue(self.store, self.repo, self.cfg)

    def tearDown(self):
        subprocess.run(["git", "-C", self.repo, "worktree", "prune"], capture_output=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def unit(self, uid: str, wave: int, files: dict, test_body: str = None) -> None:
        mod = "f_" + uid.lower()
        tfile = "tests/test_%s.py" % mod
        files = dict(files)
        files[tfile] = test_body if test_body is not None else GREEN_TEST.format(mod=mod, v=1)
        files.setdefault(mod + ".py", "V = 1\n")
        branch(self.repo, "line/R1/" + uid, files)
        tid = "T_" + uid
        self.store.put(E_ACC_TEST, tid, AccTest(tid, "F" + uid[1:], "C1", "spec.md#L1-2", tfile,
                                                name="tests.test_%s.T.test_a" % mod), run="R1")
        self.store.put(E_UNIT, uid, Unit(uid, "R1", state="verified", wave=wave, tests=[tid], attempt=1), run="R1")

    def kinds(self):
        return [e.kind for e in self.store.events_after(0)]

    def test_all_green_merge_fast_forwards_main(self):
        self.unit("U1", 1, {"app.py": "X = 2\n"})
        old = sh(self.repo, "rev-parse", "main")
        self.mq.enqueue("R1", "U1")
        out = self.mq.drain("R1")
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0].merged, out[0].gate)
        main = sh(self.repo, "rev-parse", "main")
        self.assertNotEqual(main, old)
        self.assertEqual(main, out[0].sha)
        self.assertEqual(sh(self.repo, "merge-base", old, main), old)   # fast-forward: old is an ancestor
        self.assertEqual(self.store.get(E_UNIT, "U1")["state"], "merged")
        self.assertIn(codes.UNIT_MERGED, self.kinds())
        ev = self.store.events_after(0, kinds=[codes.UNIT_MERGED])[0]
        self.assertEqual(ev.env.unit, "U1")
        self.assertEqual(ev.env.spec_hash, "h1")
        self.assertEqual(ev.body["sha"], main)
        self.assertEqual(self.store.get(E_MERGE, "R1:U1")["state"], "merged")
        self.assertTrue(self.mq.drained("R1"))
        # main's checkout follows (main is checked out in the repo)
        with open(os.path.join(self.repo, "app.py"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "X = 2\n")

    def test_unit_with_nothing_to_merge_says_so(self):
        from line.server import run_summary
        self.unit("U1", 1, {"app.py": "X = 2\n"})
        self.mq.enqueue("R1", "U1")
        self.mq.drain("R1")
        # U2's work is already on main (verify passed it with already_satisfied): its branch adds nothing
        sh(self.repo, "branch", "line/R1/U2", "main")
        self.store.put(E_UNIT, "U2", Unit("U2", "R1", state="verified", wave=2, tests=["T_U1"], attempt=1), run="R1")
        main = sh(self.repo, "rev-parse", "main")
        self.mq.enqueue("R1", "U2")
        out = self.mq.drain("R1")
        self.assertTrue(out[0].merged, out[0].gate)
        self.assertEqual(sh(self.repo, "rev-parse", "main"), main)
        row = self.store.get(E_UNIT, "U2")
        self.assertEqual(row["state"], "merged")                       # the terminal state is unchanged
        self.assertTrue(row["detail"]["nothing_to_merge"])
        self.assertNotIn("nothing_to_merge", self.store.get(E_UNIT, "U1")["detail"])
        ev = self.store.events_after(0, kinds=[codes.UNIT_MERGED])
        self.assertEqual([e.body.get("nothing_to_merge", False) for e in ev], [False, True])
        sm = run_summary(self.store, self.store.get(E_RUN, "R1"))
        self.assertEqual((sm["unit_states"]["merged"], sm["nothing_to_merge"]), (2, 1))

    def test_rebase_conflict_sends_unit_back_to_ready(self):
        self.unit("U1", 1, {"app.py": "X = 2\n"})
        self.unit("U2", 1, {"app.py": "X = 3\n"})
        self.mq.enqueue("R1", "U1")
        self.mq.enqueue("R1", "U2")
        o1, o2 = self.mq.drain("R1")
        self.assertTrue(o1.merged)
        self.assertFalse(o2.merged)
        self.assertEqual(o2.gate.code, codes.MERGE_CONFLICT)
        self.assertEqual(o2.gate.detail["stage"], "rebase")
        self.assertIn("app.py", o2.gate.detail["files"])
        self.assertEqual(self.store.get(E_UNIT, "U2")["state"], "ready")
        self.assertEqual(sh(self.repo, "rev-parse", "main"), o1.sha)   # main untouched by the conflict
        req = self.store.events_after(0, kinds=[codes.UNIT_REQUEUED])
        self.assertEqual(len(req), 1)
        self.assertEqual(req[0].body["code"], codes.MERGE_CONFLICT)
        self.assertEqual(req[0].env.unit, "U2")
        self.assertEqual(self.store.get(E_MERGE, "R1:U2")["state"], "conflict")
        self.assertTrue(self.mq.drained("R1"))

    def test_red_acceptance_is_a_semantic_conflict(self):
        self.unit("U1", 1, {}, test_body=RED_TEST)
        old = sh(self.repo, "rev-parse", "main")
        self.mq.enqueue("R1", "U1")
        (o,) = self.mq.drain("R1")
        self.assertFalse(o.merged)
        self.assertEqual(o.gate.code, codes.MERGE_TESTS_RED)    # not a git conflict: its own code
        self.assertEqual(o.gate.detail["stage"], "tests")
        self.assertEqual(sh(self.repo, "rev-parse", "main"), old)
        self.assertEqual(self.store.get(E_UNIT, "U1")["state"], "ready")

    def test_merged_units_tests_rerun_as_regression(self):
        self.unit("U1", 1, {})
        self.mq.enqueue("R1", "U1")
        self.assertTrue(self.mq.drain("R1")[0].merged)
        # U2 breaks U1's module: its own test is green but U1's acceptance goes red
        self.unit("U2", 2, {"f_u1.py": "V = 99\n"})
        self.mq.enqueue("R1", "U2")
        (o,) = self.mq.drain("R1")
        self.assertFalse(o.merged)
        self.assertIn("tests.test_f_u1.T.test_a", o.gate.detail["tests"])

    def test_fifo_by_wave(self):
        self.unit("U2", 2, {})
        self.unit("U1", 1, {})
        self.mq.enqueue("R1", "U2")
        self.mq.enqueue("R1", "U1")
        self.assertEqual([r["unit"] for r in self.mq.pending("R1")], ["U1", "U2"])
        out = self.mq.drain("R1")
        self.assertEqual([o.unit for o in out], ["U1", "U2"])
        self.assertTrue(all(o.merged for o in out))

    def test_unit_not_verified_is_dropped(self):
        self.unit("U1", 1, {})
        self.mq.enqueue("R1", "U1")
        self.store.transition(E_UNIT, "U1", "failed", "verified")
        (o,) = self.mq.drain("R1")
        self.assertFalse(o.merged)
        self.assertTrue(self.mq.drained("R1"))


if __name__ == "__main__":
    unittest.main()
