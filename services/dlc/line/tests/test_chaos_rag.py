"""Chaos suite (RAG outage / duplicate delivery / RAG lease authority):
line.chaos scenarios against the dry pipeline; every invariant must hold."""

from __future__ import annotations

import unittest

from line.chaos import run_scenario


class ChaosRagTests(unittest.TestCase):
    def check(self, name: str):
        r = run_scenario(name)
        self.assertTrue(r.ok, "\n".join([r.line()] + r.violations))
        return r

    def test_rag_outage(self) -> None:
        r = self.check("rag_outage")
        self.assertEqual(r.state, "green")
        self.assertGreater(r.notes["outbox_during"], 0)

    def test_duplicate_delivery(self) -> None:
        r = self.check("duplicate_delivery")
        self.assertGreater(r.notes["duplicates_delivered"], 0)

    def test_rag_leases_skew(self) -> None:
        r = self.check("rag_leases_skew")
        self.assertGreater(r.notes["remote_acquires"], 0)


if __name__ == "__main__":
    unittest.main()
