"""Chaos suite (kill / cancel / lease expiry / corrupt worktree):
line.chaos scenarios against the dry pipeline; every invariant must hold."""

from __future__ import annotations

import unittest

from line.chaos import run_scenario


class ChaosBuildTests(unittest.TestCase):
    def check(self, name: str):
        r = run_scenario(name)
        self.assertTrue(r.ok, "\n".join([r.line()] + r.violations))
        return r

    def test_kill_resume(self) -> None:
        r = self.check("kill_resume")
        self.assertEqual(r.state, "green")

    def test_cancel_resume(self) -> None:
        r = self.check("cancel_resume")
        self.assertEqual((r.state, r.code), ("escalated", "CANCELLED"))

    def test_lease_expiry(self) -> None:
        r = self.check("lease_expiry")
        self.assertEqual(r.state, "green")
        # the builder takes its submit back when the fenced event is refused (no stuck unit left for the
        # reconciler; it would requeue the unit had the builder died there)
        self.assertGreaterEqual(r.notes["builder_take_backs"] + r.notes["reconciler_requeues"], 1)

    def test_corrupt_worktree(self) -> None:
        r = self.check("corrupt_worktree")
        self.assertEqual(r.state, "green")


if __name__ == "__main__":
    unittest.main()
