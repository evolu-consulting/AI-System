"""Retrieval carries the situation in words (query), not only the (role, step, stack) key.

Without it a RAG System can only serve items stored under the exact key, so lessons imported without keys
never reach a prompt (found 2026-10-13 on a fresh customer install: every keyed step returned nothing).
"""

from __future__ import annotations

import types
import unittest

from line.contracts import Unit
from line.learn.serve import serve_lessons
from line.pipeline import Pipeline
from line.rag.resilient import ResilientRag


class _Port:
    def __init__(self, with_query: bool = True):
        self.calls = []
        self.with_query = with_query

    def retrieve(self, role, step, stack, max_chars, **kw):
        if kw and not self.with_query:
            raise TypeError("unexpected keyword argument 'query'")
        self.calls.append((role, step, list(stack), kw.get("query", "")))
        return [{"text": "Check the import path after moving a module.", "source": "s1"}]


class UnitQueryTests(unittest.TestCase):
    def test_builder_query_names_the_unit_and_its_files(self) -> None:
        u = Unit(id="U1", run="r", title="CLI add command", claims=["app/cli.py", "app/store.py"])
        q = Pipeline._unit_query(u)
        self.assertIn("CLI add command", q)
        self.assertIn("app/cli.py", q)
        self.assertNotIn("Failing", q)

    def test_fixer_query_carries_the_failure_and_the_correction(self) -> None:
        u = Unit(id="U9", run="r", title="Fix F2", fixer_gen=1,
                 detail={"evidence": {"failing": ["tests/test_f2.py::test_add ImportError: no module named store"]}})
        q = Pipeline._unit_query(u, nudge="keep the public function names")
        self.assertIn("ImportError: no module named store", q)
        self.assertIn("Correction: keep the public function names", q)
        self.assertLessEqual(len(Pipeline._unit_query(Unit(id="U", run="r", title="t" * 9000))), 3000)

    def test_digest_query_lists_feature_titles(self) -> None:
        d = types.SimpleNamespace(f_items=[types.SimpleNamespace(title="Add a todo"),
                                           types.SimpleNamespace(title="List todos")])
        self.assertEqual(Pipeline._digest_query(d), "Features: Add a todo; List todos")
        self.assertEqual(Pipeline._digest_query(types.SimpleNamespace(f_items=[])), "")


class PassThroughTests(unittest.TestCase):
    def test_serve_lessons_passes_the_query_to_the_rag(self) -> None:
        port = _Port()
        sv = serve_lessons(None, "fixer", "build", "python", rag=port, max_chars=500, query="ImportError")
        self.assertEqual(port.calls[-1], ("fixer", "build", ["python"], "ImportError"))
        self.assertIn("import path", sv.text)

    def test_a_port_without_query_still_answers_keyed_calls(self) -> None:
        port = _Port(with_query=False)
        sv = serve_lessons(None, "builder", "build", "python", rag=port, max_chars=500)
        self.assertEqual(port.calls[-1][3], "")
        self.assertIn("import path", sv.text)

    def test_resilient_adapter_forwards_the_query(self) -> None:
        port = _Port()
        r = ResilientRag.__new__(ResilientRag)
        r.remote = port
        r._read = lambda cap, remote, local: remote()
        r.retrieve("planner", "plan", ["python"], 300, query="Features: Add a todo")
        self.assertEqual(port.calls[-1][3], "Features: Add a todo")


if __name__ == "__main__":
    unittest.main()
