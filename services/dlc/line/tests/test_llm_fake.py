"""S3: fake LLM backend - deterministic fixtures, builder tree copy, typed errors."""

import json
import os
import shutil
import tempfile
import unittest

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import LlmPort
from line.llm import make_llm
from line.llm.fake import parse_agentic_key


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


class FakeLlmTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-llm-fake-")
        self.pack = os.path.join(self.tmp, "todo-pack")
        dry = os.path.join(self.pack, "dry")
        _write(os.path.join(dry, "reader", "A.json"), json.dumps({"f_items": [{"id": "F1"}]}))
        _write(os.path.join(dry, "builder", "U3", "attempt1", "todo", "store.py"), "X = 1\n")
        _write(os.path.join(dry, "builder", "U3", "attempt1", "_outcome.txt"), "BLOCKED:needs F2 answer\n")
        _write(os.path.join(dry, "builder", "U3", "attempt2", "todo", "store.py"), "X = 2\n")
        _write(os.path.join(dry, "builder", "U3", "attempt2", "tests", "test_x.py"), "# t\n")
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="fake", dry_pack=self.pack)
        self.llm = make_llm(self.cfg)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_is_llm_port(self):
        self.assertIsInstance(self.llm, LlmPort)

    def test_complete_is_deterministic(self):
        schema = {"type": "object", "required": ["f_items"]}
        a = self.llm.complete("reader", "read it", schema, key="A", run="r1")
        b = self.llm.complete("reader", "a different prompt", schema, key="A", run="r1")
        self.assertEqual(a.data, {"f_items": [{"id": "F1"}]})
        self.assertEqual(a.data, b.data)
        self.assertEqual(a.text, b.text)
        self.assertEqual(a.usd, 0.0)
        self.assertEqual(a.model, "claude-opus-5-5")
        self.assertIsNone(self.llm.complete("reader", "p", key="A").data)   # no schema -> data None

    def test_missing_fixture_names_path(self):
        with self.assertRaises(LineError) as cm:
            self.llm.complete("reader", "p", key="B")
        self.assertEqual(cm.exception.code, codes.LLM_ERROR)
        self.assertTrue(cm.exception.detail["path"].endswith(os.path.join("dry", "reader", "B.json")))
        self.assertIn("B.json", cm.exception.message)

    def test_builder_attempt_tree_copied_with_outcome(self):
        wd1 = os.path.join(self.tmp, "wt1")
        r1 = self.llm.agentic("builder", wd1, "build", 40, 1.0, key="U3#1", run="r1")
        self.assertEqual(r1.outcome, "BLOCKED:needs F2 answer")
        with open(os.path.join(wd1, "todo", "store.py"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "X = 1\n")
        self.assertFalse(os.path.exists(os.path.join(wd1, "_outcome.txt")))

        wd2 = os.path.join(self.tmp, "wt2")
        os.makedirs(wd2)
        _write(os.path.join(wd2, "keep.txt"), "mine")
        r2 = self.llm.agentic("builder", wd2, "build", 40, 1.0, key="U3/attempt2", run="r1")
        self.assertEqual(r2.outcome, "SUBMIT")                     # default outcome
        self.assertTrue(os.path.isfile(os.path.join(wd2, "tests", "test_x.py")))
        self.assertTrue(os.path.isfile(os.path.join(wd2, "keep.txt")))
        with open(os.path.join(wd2, "todo", "store.py"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "X = 2\n")

    def test_missing_attempt_tree(self):
        with self.assertRaises(LineError) as cm:
            self.llm.agentic("builder", os.path.join(self.tmp, "wt"), "b", 5, 1.0, key="U3#9")
        self.assertEqual(cm.exception.code, codes.LLM_ERROR)
        self.assertIn("attempt9", cm.exception.detail["path"])

    def test_pack_unset_or_missing(self):
        for pack in ("", os.path.join(self.tmp, "nope")):
            llm = make_llm(load_config(env={}, line_json=None, rag_local_json=None, llm="fake", dry_pack=pack))
            with self.assertRaises(LineError) as cm:
                llm.complete("reader", "p", key="A")
            self.assertEqual(cm.exception.code, codes.LLM_ERROR)

    def test_key_parsing(self):
        self.assertEqual(parse_agentic_key("U3#2"), ("U3", 2))
        self.assertEqual(parse_agentic_key("U3/attempt12"), ("U3", 12))
        self.assertEqual(parse_agentic_key("U3"), ("U3", None))


if __name__ == "__main__":
    unittest.main()
