"""Understand stage block 9: acceptance test author + test check (red on empty, trace, lock)."""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import unittest

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import E_ACC_TEST, Criterion, Digest, FItem
from line.tests.fakes import FakeLlm, FakeStore
from line.understand import author_tests, check_tests, locked_tampered

CFG = load_config(env={}, line_json=None, rag_local_json=None)
SPAN = "spec.md#L6-8"
PATH = "tests/acceptance/test_f2.py"

GOOD = '''import importlib
import unittest


def _impl():
    try:
        return importlib.import_module("todo")
    except ImportError:
        return None


class TestF2(unittest.TestCase):
    # trace: F2.C1 spec.md#L6-8
    def test_c1(self):
        # Given task 1  When todo done 1  Then task 1 is done
        todo = _impl()
        self.assertIsNotNone(todo, "todo module missing")
        self.assertTrue(todo.done(1))

    # trace: F2.C2 spec.md#L6-8
    def test_c2(self):
        # Given no task 9  When todo done 9  Then exit code 1
        todo = _impl()
        self.assertIsNotNone(todo, "todo module missing")
        self.assertEqual(todo.main(["done", "9"]), 1)
'''

GREEN = GOOD.replace('''        todo = _impl()
        self.assertIsNotNone(todo, "todo module missing")
        self.assertEqual(todo.main(["done", "9"]), 1)''', '''        self.assertEqual(1, 1)''')

TESTS = [{"criterion": "F2.C1", "span_id": SPAN, "name": "TestF2.test_c1"},
         {"criterion": "F2.C2", "span_id": SPAN, "name": "TestF2.test_c2"}]


def answer(content=GOOD, tests=TESTS, path=PATH):
    return {"path": path, "content": content, "tests": [dict(t) for t in tests]}


def make_digest():
    crits = [Criterion("F2.C1", "F2", "done marks", SPAN, "`todo done <id>` marks a task done.",
                       "task 1", "todo done 1", "task 1 is done"),
             Criterion("F2.C2", "F2", "unknown id", SPAN, "An unknown id exits with code 1.",
                       "no task 9", "todo done 9", "exit code 1")]
    return Digest("v1", "R", [FItem("F2", "Done and remove", [SPAN], "`todo done <id>` marks a task done.", crits)])


class _Repo(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp(prefix="line-repo-")
        self.addCleanup(shutil.rmtree, self.repo, True)
        self.store = FakeStore()
        self.digest = make_digest()


class TestAuthor(_Repo):
    def test_writes_traced_tests(self):
        llm = FakeLlm({("test_author", "F2"): answer()})
        tests = author_tests(self.digest, llm, self.repo, run="R1", store=self.store)
        self.assertEqual([t.id for t in tests], ["T_F2_C1", "T_F2_C2"])
        self.assertEqual(tests[1].name, "tests.acceptance.test_f2.TestF2.test_c2")
        self.assertEqual((tests[1].f_item, tests[1].criterion, tests[1].span_id), ("F2", "F2.C2", SPAN))
        self.assertFalse(tests[0].locked)
        for rel in ("tests/__init__.py", "tests/acceptance/__init__.py", PATH):
            self.assertTrue(os.path.isfile(os.path.join(self.repo, *rel.split("/"))), rel)
        prompt = llm.calls[0]["prompt"]
        self.assertIn("An unknown id exits with code 1.", prompt)   # author sees the verbatim quote
        self.assertEqual(len(self.store.query(E_ACC_TEST, run="R1")), 2)

    def test_an_earlier_runs_locked_tests_are_never_overwritten(self):
        # project testarea: the enhancement and bug-fix runs rewrote test_f1.py of the first run
        os.makedirs(os.path.join(self.repo, "tests", "acceptance"))
        old = os.path.join(self.repo, "tests", "acceptance", "test_f2.py")
        with open(old, "w", encoding="utf-8") as fh:
            fh.write("# locked by R20261016-032200-5582\n")
        llm = FakeLlm({("test_author", "F2"): answer()})
        tests = author_tests(self.digest, llm, self.repo, run="R20261016-033906-e5c4", store=self.store)
        with open(old, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "# locked by R20261016-032200-5582\n")
        self.assertEqual({t.path for t in tests}, {"tests/acceptance/test_e5c4_f2.py"})
        self.assertEqual(tests[1].name, "tests.acceptance.test_e5c4_f2.TestF2.test_c2")
        self.assertTrue(os.path.isfile(os.path.join(self.repo, "tests", "acceptance", "test_e5c4_f2.py")))
        # the same tag taken too: a counter
        from line.understand.test_author import free_path
        self.assertEqual(free_path(self.repo, PATH, "R20261016-033906-e5c4"), "tests/acceptance/test_e5c4_f2_2.py")
        self.assertEqual(free_path(self.repo, "tests/acceptance/f2.test.js", "R1-ab12"), "tests/acceptance/f2.test.js")
        open(os.path.join(self.repo, "tests", "acceptance", "f2.test.js"), "w").close()
        self.assertEqual(free_path(self.repo, "tests/acceptance/f2.test.js", "R1-ab12"),
                         "tests/acceptance/ab12_f2.test.js")

    def test_untraced_rejected(self):
        bad = answer(tests=[TESTS[0], {"criterion": "F9.C1", "span_id": SPAN, "name": "TestF2.test_c2"}])
        llm = FakeLlm({("test_author", "F2"): bad})
        with self.assertRaises(LineError) as cm:
            author_tests(self.digest, llm, self.repo, run="R1")
        self.assertEqual(cm.exception.code, codes.TEST_UNTRACED)
        probs = " ".join(cm.exception.detail["problems"])
        self.assertIn("F9.C1", probs)
        self.assertIn("F2.C2 has no traced test", probs)
        self.assertEqual(len(llm.calls), 2)   # one feedback round
        self.assertIn("rejected", llm.calls[1]["prompt"])
        self.assertFalse(os.path.exists(os.path.join(self.repo, "tests")))   # nothing written

    def test_missing_tag_rejected_then_fixed(self):
        untagged = GOOD.replace("# trace: F2.C2 spec.md#L6-8", "# criterion two")
        llm = FakeLlm({("test_author", "F2"): [answer(content=untagged), answer()]})
        tests = author_tests(self.digest, llm, self.repo)
        self.assertEqual(len(tests), 2)
        self.assertIn("trace: F2.C2", llm.calls[1]["prompt"])

    def test_path_outside_test_dir_rejected(self):
        llm = FakeLlm({("test_author", "F2"): answer(path="src/../evil/test_x.py")})
        with self.assertRaises(LineError) as cm:
            author_tests(self.digest, llm, self.repo)
        self.assertEqual(cm.exception.code, codes.TEST_UNTRACED)


class TestCheck(_Repo):
    def author(self, content=GOOD):
        llm = FakeLlm({("test_author", "F2"): answer(content=content)})
        return author_tests(self.digest, llm, self.repo, run="R1", store=self.store)

    def test_red_on_empty_approved_and_locked(self):
        tests = self.author()
        # an implementation already in the repo must not matter: the check runs on an empty one
        with open(os.path.join(self.repo, "todo.py"), "w") as fh:
            fh.write("def done(i):\n    return True\n\ndef main(a):\n    return 1\n")
        gate = check_tests(self.repo, tests, digest=self.digest, run="R1", store=self.store, spec_hash="v1", cfg=CFG)
        self.assertTrue(gate.ok, gate.detail)
        self.assertEqual(gate.detail["outcomes"], {"T_F2_C1": "fail", "T_F2_C2": "fail"})
        with open(os.path.join(self.repo, *PATH.split("/")), "rb") as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        self.assertTrue(all(t.locked and t.sha == sha for t in tests))
        row = self.store.get(E_ACC_TEST, "R1:T_F2_C2")
        self.assertTrue(row["locked"])
        self.assertEqual(row["sha"], sha)
        ev = self.store.events_after(0, kinds=[codes.TESTS_APPROVED])
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0].env.run, "R1")
        self.assertEqual(ev[0].env.spec_hash, "v1")
        self.assertEqual(ev[0].body["files"], {PATH: sha})
        self.assertEqual(ev[0].body["trace"]["T_F2_C2"]["span_id"], SPAN)
        # locked: any edit is detected
        self.assertEqual(locked_tampered(self.repo, tests), [])
        with open(os.path.join(self.repo, *PATH.split("/")), "a") as fh:
            fh.write("\n# edited\n")
        self.assertEqual([t.id for t in locked_tampered(self.repo, tests)], ["T_F2_C1", "T_F2_C2"])

    def test_green_on_empty_rejected(self):
        tests = self.author(GREEN)
        gate = check_tests(self.repo, tests, digest=self.digest, run="R1", store=self.store, cfg=CFG)
        self.assertFalse(gate.ok)
        self.assertEqual(gate.code, codes.TEST_GREEN_ON_EMPTY)
        self.assertEqual(gate.detail["green"], ["T_F2_C2"])
        self.assertFalse(any(t.locked for t in tests))
        self.assertEqual(self.store.events_after(0, kinds=[codes.TESTS_APPROVED]), [])

    def test_untraced_file_rejected(self):
        tests = self.author()
        p = os.path.join(self.repo, *PATH.split("/"))
        with open(p, encoding="utf-8") as fh:
            src = fh.read()
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(src.replace("# trace: F2.C1 spec.md#L6-8", "# F2.C1"))
        gate = check_tests(self.repo, tests, digest=self.digest, cfg=CFG)
        self.assertEqual(gate.code, codes.TEST_UNTRACED)
        self.assertEqual(gate.detail["untraced"][0]["test"], "T_F2_C1")

    def test_uncovered_criterion_rejected(self):
        tests = self.author()
        gate = check_tests(self.repo, tests[:1], digest=self.digest, cfg=CFG)
        self.assertEqual(gate.code, codes.TEST_UNTRACED)
        self.assertEqual(gate.detail["untraced"][0]["criterion"], "F2.C2")


if __name__ == "__main__":
    unittest.main()


class SharedSpecTextTest(unittest.TestCase):
    """Every F-item's test author (and every builder) sees the spec sections no F-item owns, such as
    the interface (how the program is run) and the storage format."""

    def test_shared_spans_reach_every_test_author_prompt(self):
        from line.understand.ingest import ingest
        from line.understand.test_author import _prompt, shared_span_ids
        pack = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples", "todo-pack")
        pv = ingest(pack, None)
        f1 = FItem("F1", "Add and list", span_ids=["spec.md#L18-22", "spec.md#L6-10"],
                   criteria=[Criterion("F1.C1", "F1", "add", "spec.md#L18-22", "q")])
        f2 = FItem("F2", "Done", span_ids=["spec.md#L24-28"],
                   criteria=[Criterion("F2.C1", "F2", "done", "spec.md#L24-28", "q")])
        shared = shared_span_ids(pv, [f1, f2])
        self.assertEqual(shared, ["spec.md#L1-4", "spec.md#L6-10", "spec.md#L12-16", "spec.md#L30-34"])
        p2 = _prompt(f2, pv, [], shared)
        self.assertIn("python -m todo --file PATH", p2)                  # interface span, not owned by F2
        self.assertIn('{"tasks": [...]}', p2)                             # storage format
        self.assertIn("writing the\n  data file directly", p2)            # isolation rule of the prompt

    def test_prompt_says_how_to_start_a_node_app_on_windows(self):
        # run R20261016-014516-7a66: the tests found the extensionless npm (WinError 193) and ran `npm start`,
        # which needed the UI build of another F-item, so they could never turn green
        from line.understand.test_author import _prompt
        p = _prompt(FItem("F1", "API", criteria=[Criterion("F1.C1", "F1", "list", "spec.md#L1-2", "q")]), None, [])
        self.assertIn('shutil.which("npm.cmd") or shutil.which("npm")', p)
        self.assertIn("rather than through `npm start`", p)
        self.assertIn("must not need a\n  build of the UI", p)
