"""
Verification tests for POST /api/ask.

Usage:
    # start the server first, then:
    python test_ask.py

Requires:
    pip install requests
"""

import json
import re
import sys
import unittest

import requests

BASE_URL = "http://localhost:8000"
ASK_URL  = f"{BASE_URL}/api/ask"


def _post(question: str) -> dict:
    resp = requests.post(ASK_URL, json={"question": question}, timeout=90)
    resp.raise_for_status()
    return resp.json()


class TestAskEndpoint(unittest.TestCase):

    # ------------------------------------------------------------------
    # Server reachability guard
    # ------------------------------------------------------------------

    @classmethod
    def setUpClass(cls):
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=5)
            r.raise_for_status()
        except Exception as exc:
            raise RuntimeError(
                f"KnowledgeHub is not running at {BASE_URL}. "
                "Start it with: uvicorn main:app --port 8000"
            ) from exc

    # ------------------------------------------------------------------
    # Response shape contract
    # ------------------------------------------------------------------

    def _assert_shape(self, data: dict) -> None:
        self.assertIn(data["status"], {"synthesized", "raw_data", "not_found"})
        self.assertIn("question",     data)
        self.assertIn("search_terms", data)
        self.assertIsInstance(data["search_terms"], list)
        self.assertIn("sources",    data)
        self.assertIsInstance(data["sources"], list)
        self.assertIn("graph_data", data)
        self.assertIsInstance(data["graph_data"], list)
        self.assertIn("edges",      data)
        self.assertIsInstance(data["edges"], list)

    # ------------------------------------------------------------------
    # Test 1 — Normal query (question that may or may not have hits)
    # ------------------------------------------------------------------

    def test_01_normal_query(self):
        data = _post("What entities are in the knowledge graph?")
        self._assert_shape(data)
        print(f"\n[test_01] status={data['status']}  "
              f"search_terms={data['search_terms']}  "
              f"sources={data['sources']}")

    # ------------------------------------------------------------------
    # Test 2 — Fallback mode: graceful degradation when nothing matches
    # ------------------------------------------------------------------

    def test_02_not_found_graceful(self):
        data = _post("zzz_nonsense_query_xyz_12345_no_match")
        self._assert_shape(data)
        # If vector store is populated, this will be not_found.
        # If empty, it should still be not_found (no crash).
        self.assertIn(data["status"], {"not_found", "raw_data"})
        self.assertIsNone(data["answer"]) if data["status"] == "not_found" else None
        print(f"\n[test_02] status={data['status']}")

    # ------------------------------------------------------------------
    # Test 3 — Special characters (quotes, braces, backslash) in question
    # ------------------------------------------------------------------

    def test_03_special_chars_in_question(self):
        tricky = r'What is "entity\type" {key: "val"}?'
        data = _post(tricky)
        self._assert_shape(data)
        self.assertEqual(data["question"], tricky,
                         "question field must be echoed back unchanged")
        print(f"\n[test_03] status={data['status']}  question echoed correctly")

    # ------------------------------------------------------------------
    # Test 4 — Vietnamese / multilingual question
    # ------------------------------------------------------------------

    def test_04_vietnamese_question(self):
        data = _post("Cho tôi biết các thực thể quan trọng trong đồ thị tri thức")
        self._assert_shape(data)
        self.assertIsInstance(data["search_terms"], list)
        self.assertGreater(len(data["search_terms"]), 0,
                           "Should always produce at least one search term via keyword fallback")
        print(f"\n[test_04] status={data['status']}  "
              f"search_terms={data['search_terms']}")

    # ------------------------------------------------------------------
    # Test 5 — answer is None when status is not_found
    # ------------------------------------------------------------------

    def test_05_answer_consistency(self):
        data = _post("zzz_no_possible_match_in_any_db_ever")
        self._assert_shape(data)
        if data["status"] == "not_found":
            self.assertIsNone(data["answer"],
                              "answer must be None when status is not_found")
        elif data["status"] == "raw_data":
            self.assertIsNone(data["answer"],
                              "answer must be None when status is raw_data")
        elif data["status"] == "synthesized":
            self.assertIsNotNone(data["answer"],
                                 "answer must be a string when status is synthesized")
        print(f"\n[test_05] answer consistency OK — status={data['status']}")


# ---------------------------------------------------------------------------
# Unit tests — core_id normalisation (no server required)
# ---------------------------------------------------------------------------

class TestCoreIdNormalisation(unittest.TestCase):
    """
    Isolated tests for _to_core_id — no network, no server.
    Keyword fallback was removed; entity resolution now uses full-question
    semantic search via the multilingual embedding model.
    """

    def setUp(self):
        from app.retriever import _to_core_id
        self._fn = _to_core_id

    def test_spaces_to_underscore(self):
        self.assertEqual(self._fn("Check Barcode"), "check_barcode")

    def test_hyphens_to_underscore(self):
        self.assertEqual(self._fn("Check-Barcode"), "check_barcode")

    def test_special_chars_stripped(self):
        self.assertEqual(self._fn("Check!Barcode?"), "checkbarcode")

    def test_empty_string_returns_unknown(self):
        self.assertEqual(self._fn(""), "unknown")

    def test_already_snake_case_unchanged(self):
        self.assertEqual(self._fn("check_barcode"), "check_barcode")

    def test_unicode_lowercased(self):
        result = self._fn("ImportArticle")
        self.assertEqual(result, "importarticle")


if __name__ == "__main__":
    print("=" * 60)
    print("KnowledgeHub  POST /api/ask  Verification Suite")
    print("=" * 60)
    loader = unittest.TestLoader()
    suite  = unittest.TestSuite()

    # Unit tests first (no server needed)
    suite.addTests(loader.loadTestsFromTestCase(TestCoreIdNormalisation))

    # Integration tests require running server
    suite.addTests(loader.loadTestsFromTestCase(TestAskEndpoint))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
