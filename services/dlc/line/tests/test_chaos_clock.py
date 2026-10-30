"""Chaos suite (clock skew):
line.chaos scenarios against the dry pipeline; every invariant must hold."""

from __future__ import annotations

import unittest

from line.chaos import run_scenario


class ChaosClockTests(unittest.TestCase):
    def check(self, name: str):
        r = run_scenario(name)
        self.assertTrue(r.ok, "\n".join([r.line()] + r.violations))
        return r

    def test_skew_forward(self) -> None:
        r = self.check("skew_forward")
        self.assertEqual(r.state, "green")            # paused (not terminal) when the run lease was lost, then resumed

    def test_skew_backward(self) -> None:
        r = self.check("skew_backward")
        self.assertEqual(r.state, "green")


if __name__ == "__main__":
    unittest.main()
