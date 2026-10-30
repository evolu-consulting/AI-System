"""Settling a BLOCKED unit before the ladder (line.build.arbiter): claims granted or waited for, a locked test ruled
on and repaired."""

from __future__ import annotations

import os
import shutil
import tempfile
import types
import unittest

from line.build import arbiter
from line.config import load_config
from line.contracts import E_ACC_TEST, E_UNIT, UnitState
from line.pipeline import init_target
from line.ship._util import git, git_out
from line.statemachine import StateMachine
from line.store import SqliteStore
from line.understand.test_check import sha256_bytes

TEST = "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_c1(self):\n        self.assertTrue(%s)\n"


def write(root, rel, text):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


class Llm:
    """The arbiter answers `verdict`; the repairer writes `fixed` into the test file."""

    def __init__(self, verdict="test_wrong", fixed=None):
        self.verdict, self.fixed, self.calls = verdict, fixed, []

    def agentic(self, role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
        self.calls.append(role)
        if role == arbiter.REPAIR_ROLE and self.fixed:
            write(workdir, "tests/acceptance/test_f1.py", self.fixed)
        text = ('{"verdict": "%s", "files": ["tests/acceptance/test_f1.py"], "why": "it needs a browser", '
                '"change": "call the API instead"}\nSUBMIT' % self.verdict)
        return types.SimpleNamespace(text=text, usd=0.1, outcome="SUBMIT")


class ArbiterTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="arbiter-")
        self.repo = init_target(os.path.join(self.d, "repo"))
        write(self.repo, "app/package.json", "{}")
        write(self.repo, "app/a.js", "a")
        write(self.repo, "app/b.js", "b")
        write(self.repo, "tests/acceptance/test_f1.py", TEST % "False")
        git(self.repo, "add", "-A")
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base")
        self.store = SqliteStore(os.path.join(self.d, "line.db"))
        with open(os.path.join(self.repo, "tests", "acceptance", "test_f1.py"), "rb") as fh:
            sha = sha256_bytes(fh.read())
        self.store.put(E_ACC_TEST, "T1", {"id": "T1", "f_item": "F1", "criterion": "C1", "span_id": "s",
                                          "path": "tests/acceptance/test_f1.py", "name": "tests.acceptance.test_f1.T"
                                          ".test_c1", "sha": sha, "locked": True}, run="R")
        for uid, claims, state in (("U1", ["app/a.js"], "waiting"), ("U2", ["app/b.js"], "leased")):
            self.store.put(E_UNIT, uid, {"id": uid, "run": "R", "state": state, "claims": claims, "tests": ["T1"],
                                         "f_items": ["F1"], "detail": {}}, run="R")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def pipe(self, llm=None):
        cleaned = []
        p = types.SimpleNamespace(
            cfg=load_config(env={}, line_json=None, rag_local_json=None, llm="cli"), run="R", repo=self.repo,
            workdir=self.d, sstore=self.store, wstore=self.store, store=self.store, sm=StateMachine(self.store),
            llm=llm or Llm(), log=lambda m: None, _charge_stage=lambda: None, _spec_for=lambda u: "F1: list notes",
            _units=lambda: self.store.query(E_UNIT, run="R"), _set_detail=lambda **kw: None,
            sandbox=types.SimpleNamespace(path=lambda u: os.path.join(self.d, "wt"),
                                          cleanup=lambda u, delete_branch=False: cleaned.append(u.id)))
        p.cleaned = cleaned
        return p

    def unit(self, uid):
        return self.store.get(E_UNIT, uid)

    def test_a_shared_manifest_is_granted_at_once(self):
        p = self.pipe()
        self.assertTrue(arbiter.resolve(p, "U1", "package.json must add esbuild, which is outside my claims"))
        u = self.unit("U1")
        self.assertEqual((u["state"], u["claims"]), ("ready", ["app/a.js", "app/package.json"]))
        self.assertIn("app/package.json", u["detail"]["nudge"])

    def test_a_file_another_running_unit_owns_waits_for_its_merge(self):
        p = self.pipe()
        self.assertTrue(arbiter.resolve(p, "U1", "the fix must wire app/b.js, outside my claims"))
        self.assertEqual((self.unit("U1")["state"], self.unit("U1")["detail"]["wait_for"]), ("waiting", ["U2"]))
        arbiter.on_tick(p)
        self.assertEqual(self.unit("U1")["state"], "waiting")              # U2 still building
        self.store.put(E_UNIT, "U2", dict(self.unit("U2"), state="merged"), run="R")
        arbiter.on_tick(p)
        self.assertEqual(self.unit("U1")["state"], "ready")
        self.assertEqual(p.cleaned, ["U1"])                                 # starts again from the merged main

    def test_a_locked_test_ruled_wrong_is_repaired_relocked_and_the_unit_restarts(self):
        llm = Llm("test_wrong", fixed=TEST % "True")
        p = self.pipe(llm)
        self.assertTrue(arbiter.resolve(p, "U1", "the locked acceptance test tests/acceptance/test_f1.py opens a "
                                                 "browser that is not installed"))
        self.assertEqual(llm.calls, [arbiter.ARBITER_ROLE, arbiter.REPAIR_ROLE])
        with open(os.path.join(self.repo, "tests", "acceptance", "test_f1.py"), "rb") as fh:
            body = fh.read()
        self.assertIn(b"assertTrue(True)", body)
        self.assertEqual(self.store.get(E_ACC_TEST, "T1")["sha"], sha256_bytes(body))   # re-locked
        self.assertIn("repaired", git_out(self.repo, "log", "-1", "--format=%s"))
        self.assertEqual(self.unit("U1")["state"], "ready")
        self.assertEqual(p.cleaned, ["U1"])

    def test_a_fair_test_sends_the_ruling_to_the_builder(self):
        p = self.pipe(Llm("code_wrong"))
        self.assertTrue(arbiter.resolve(p, "U1", "the locked acceptance test tests/acceptance/test_f1.py is wrong"))
        self.assertIn("ruled the test fair", self.unit("U1")["detail"]["nudge"])

    def test_a_repair_that_drops_a_test_is_refused(self):
        p = self.pipe(Llm("test_wrong", fixed="import unittest\n"))
        self.assertFalse(arbiter.resolve(p, "U1", "the locked acceptance test tests/acceptance/test_f1.py is wrong"))
        with open(os.path.join(self.repo, "tests", "acceptance", "test_f1.py"), encoding="utf-8") as fh:
            self.assertIn("assertTrue(False)", fh.read())                  # main untouched

    def test_off_with_the_fake_model(self):
        p = self.pipe()
        p.cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="fake")
        self.assertFalse(arbiter.resolve(p, "U1", "package.json is outside my claims"))


if __name__ == "__main__":
    unittest.main()
