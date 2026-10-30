"""The chaos invariant checker itself: it must see every kind of violation (on a hand-made store), and the
helpers (pack preparation, dedup remote, skew clock, kind registration) behave as documented."""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest

from line import codes
from line.chaos import (
    EXTRA_KINDS, PACK, SCENARIOS, SkewClock, check_invariants, dedup_rag, prepare_pack, run_scenario,
)
from line.contracts import E_UNIT, Envelope, Run, Unit
from line.statemachine import StateMachine
from line.store import SqliteStore


def env(run="R1", unit="", epoch=0):
    return Envelope(run=run, unit=unit, epoch=epoch)


class InvariantTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = SqliteStore(":memory:")
        self.sm = StateMachine(self.store)
        self.sm.admit_run(Run(id="R1", pack_path="p"))

    def tearDown(self) -> None:
        self.store.close()

    def test_clean_run_has_no_violation(self) -> None:
        self.sm.escalate_run("R1", codes.CANCELLED, "x")
        self.assertEqual(check_invariants(self.store, "R1"), [])

    def test_event_after_terminal(self) -> None:
        self.sm.escalate_run("R1", codes.CANCELLED, "x")
        self.store.emit(codes.BUDGET_WARN, env(), {})
        self.assertTrue(any(v.startswith("terminal_last") for v in check_invariants(self.store, "R1")))

    def test_seq_gap(self) -> None:
        self.store.emit(codes.BUDGET_WARN, env(), {})
        self.store.emit(codes.BUDGET_WARN, env(), {})
        with self.store.tx() as c:
            c.execute("DELETE FROM event WHERE seq=2")
        self.assertTrue(any(v.startswith("gapless") for v in check_invariants(self.store, "R1")))

    def test_epoch_going_back(self) -> None:
        StateMachine(self.store).put_unit(Unit(id="U1", run="R1"))
        with self.store.tx() as c:
            for seq, ep in ((50, 3), (51, 2)):
                c.execute("INSERT INTO event(seq, kind, run, unit, attempt, epoch, body) VALUES (?,?,?,?,?,?,?)",
                          (seq, codes.UNIT_STATE, "R1", "U1", 1, ep, '{"to": "pending"}'))
        self.assertTrue(any(v.startswith("epochs") for v in check_invariants(self.store, "R1")))

    def test_projection_mismatch(self) -> None:
        StateMachine(self.store).put_unit(Unit(id="U1", run="R1"))
        self.store.transition(E_UNIT, "U1", "ready", "pending")
        self.assertTrue(any("projection: U1" in v for v in check_invariants(self.store, "R1")))


class HelperTests(unittest.TestCase):
    def test_prepare_pack_adds_attempts(self) -> None:
        d = tempfile.mkdtemp(prefix="line-chaos-pack-")
        try:
            p = prepare_pack(os.path.join(d, "pack"), extra_attempts=2)
            u3 = sorted(os.listdir(os.path.join(p, "dry", "builder", "U3")))
            self.assertEqual(u3, ["attempt1", "attempt2", "attempt3", "attempt4"])
            self.assertTrue(os.path.isdir(os.path.join(PACK, "dry", "builder", "U3", "attempt2")))
            self.assertFalse(os.path.isdir(os.path.join(PACK, "dry", "builder", "U3", "attempt3")))  # original untouched
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_dedup_remote(self) -> None:
        r = dedup_rag()
        ev = {"seq": 1, "kind": "run.admitted", "env": {"run": "R"}, "ts_ms": 1, "body": {}}
        r.append_events([ev], "a")
        r.append_events([ev, dict(ev, seq=2)], "b")
        self.assertEqual([e["seq"] for e in r.events], [1, 2])
        self.assertEqual(r.duplicates, 1)

    def test_skew_clock_and_kinds(self) -> None:
        c = SkewClock()
        t = c.now_ms()
        c.jump(-10)
        self.assertLess(c.now_ms(), t)
        self.assertTrue(EXTRA_KINDS <= codes.EVENT_KINDS)      # registered centrally (codes.W4_KINDS)
        self.assertIn("kill_resume", SCENARIOS)
        with self.assertRaises(ValueError):
            run_scenario("nope")


if __name__ == "__main__":
    unittest.main()
