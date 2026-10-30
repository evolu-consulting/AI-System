"""A failed run that merged nothing takes its locked acceptance tests back off main (pipeline._drop_failed_tests)."""

from __future__ import annotations

import os
import shutil
import tempfile
import types
import unittest

from line.contracts import E_UNIT, Unit
from line.pipeline import Pipeline
from line.tests.fakes import make_fakes
from line.tests.test_ship_merge import HAS_GIT, commit, make_repo, sh


@unittest.skipUnless(HAS_GIT, "git not installed")
class DropFailedTestsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-drop-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.env = {k: os.environ.get(k) for k in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME",
                                                   "GIT_COMMITTER_EMAIL")}
        os.environ.update(GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t",
                          GIT_COMMITTER_EMAIL="t@x")
        self.repo = make_repo(self.tmp)
        self.sha = commit(self.repo, {"tests/acceptance/test_f1.py": "# locked\n"}, "line R1: acceptance tests (locked)")
        self.store = make_fakes().store
        self.logs = []
        self.pipe = types.SimpleNamespace(store=self.store, run="R1", repo=self.repo, log=self.logs.append)

    def tearDown(self):
        for k, v in self.env.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

    def drop(self):
        return Pipeline._drop_failed_tests(self.pipe, {"detail": {"tests_commit": self.sha}})

    def test_reverted_when_nothing_merged(self):
        self.store.put(E_UNIT, "U1", Unit("U1", "R1", state="failed"), run="R1")
        self.assertTrue(self.drop())
        self.assertFalse(os.path.exists(os.path.join(self.repo, "tests", "acceptance", "test_f1.py")))
        self.assertIn("Revert", sh(self.repo, "log", "-1", "--format=%s"))
        self.assertEqual(sh(self.repo, "rev-parse", "HEAD~1"), self.sha)          # history keeps them

    def test_cancelling_a_parked_run_takes_its_tests_back(self):
        from line.config import load_config
        from line.contracts import E_RUN, Run
        from line.pipeline import make_driver
        from line.store import SqliteStore
        cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=os.path.join(self.tmp, "work"))
        st = SqliteStore(os.path.join(self.tmp, "line.db"))
        st.put(E_RUN, "R1", Run("R1", "pack", state="planning", detail={"target": self.repo, "tests_commit": self.sha}),
               run="R1")
        out = make_driver(st, cfg)("cancel", {"run": "R1", "reason": "test"})
        self.assertEqual(out["state"], "escalated")
        self.assertIn("Revert", sh(self.repo, "log", "-1", "--format=%s"))

    def test_kept_when_a_unit_merged(self):
        self.store.put(E_UNIT, "U1", Unit("U1", "R1", state="merged"), run="R1")
        self.assertFalse(self.drop())
        self.assertEqual(sh(self.repo, "rev-parse", "HEAD"), self.sha)

    def test_kept_when_the_checkout_is_dirty_or_the_commit_is_not_the_tests(self):
        with open(os.path.join(self.repo, "app.py"), "w", encoding="utf-8") as fh:
            fh.write("X = 9\n")
        self.assertFalse(self.drop())
        self.assertIn("not clean", self.logs[-1])
        sh(self.repo, "checkout", "--", "app.py")
        other = commit(self.repo, {"app.py": "X = 5\n"}, "something else")
        self.assertFalse(Pipeline._drop_failed_tests(self.pipe, {"detail": {"tests_commit": other}}))


if __name__ == "__main__":
    unittest.main()
