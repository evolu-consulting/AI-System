"""S1 core: state machine helpers + board projection (fakes and SQLite)."""

import unittest

from line import codes
from line.codes import LineError
from line.contracts import Run, RunState, Unit, UnitState, unit_lease_name
from line.events import Emitter, check_gapless, envelope, project
from line.statemachine import StateMachine
from line.tests.test_core_store import fake_env, sqlite_env


class StateMachineContract:
    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.e = self.make()
        self.s = self.e.store
        self.sm = StateMachine(self.s, agent_version="t", model="m1")
        self.sm.admit_run(Run("R1", "/pack", spec_hash="SH"))

    def kinds(self, **kw):
        return [e.kind for e in self.s.events_after(0, **kw)]

    def test_run_happy_path_and_projection(self):
        path = [RunState.UNDERSTANDING, RunState.PLANNING, RunState.BUILDING, RunState.INTEGRATING, RunState.QAS]
        for st in path:
            self.sm.advance_run("R1", st)
        self.sm.advance_run("R1", RunState.GREEN, RunState.QAS, extra=[(codes.RUN_GREEN, {})])
        self.assertEqual(self.s.get("run", "R1")["state"], "green")
        evs = self.s.events_after(0)
        check_gapless(evs)
        self.assertEqual(evs[0].kind, codes.RUN_ADMITTED)
        self.assertEqual(evs[-1].kind, codes.RUN_GREEN)
        self.assertEqual(evs[0].env.spec_hash, "SH")
        self.assertEqual(evs[1].body, {"from": "admitted", "to": "understanding"})
        board = project(evs)
        self.assertEqual(board["runs"]["R1"]["state"], "green")
        self.assertEqual(board["last_seq"], len(evs))

    def test_illegal_and_cas(self):
        with self.assertRaises(LineError) as cm:
            self.sm.advance_run("R1", RunState.GREEN)
        self.assertEqual(cm.exception.code, codes.ILLEGAL_TRANSITION)
        with self.assertRaises(LineError) as cm:
            self.sm.advance_run("R1", RunState.PLANNING, expect_from=RunState.UNDERSTANDING)
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
        self.assertEqual(self.kinds(), [codes.RUN_ADMITTED], "refused changes emit nothing")
        with self.assertRaises(LineError) as cm:
            self.sm.admit_run(Run("R1", "/again"))
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)

    def test_escalate_run(self):
        self.sm.advance_run("R1", RunState.UNDERSTANDING)
        self.sm.escalate_run("R1", codes.READ_DIVERGED, "readers disagree", {"field": "F2"})
        row = self.s.get("run", "R1")
        self.assertEqual(row["state"], "escalated")
        self.assertEqual(row["detail"]["escalation"]["code"], codes.READ_DIVERGED)
        self.assertEqual(self.s.get("escalation", "R1:run")["code"], codes.READ_DIVERGED)
        self.assertEqual(self.kinds()[-2:], [codes.RUN_STATE, codes.ESCALATED])
        self.assertEqual(project(self.s.events_after(0))["runs"]["R1"]["escalations"][0]["code"], codes.READ_DIVERGED)

    def test_unit_lifecycle_fenced(self):
        self.sm.put_unit(Unit("U1", "R1"))
        self.sm.put_unit(Unit("U2", "R1", deps=["U1"]))
        self.assertEqual(self.sm.release_ready("R1"), ["U1"])
        lease = self.sm.dispatch_unit("U1", self.e.leases, owner="b1")
        self.assertIsNotNone(lease)
        self.assertIsNone(self.sm.dispatch_unit("U1", self.e.leases, owner="b2"), "held lease")
        row = self.s.get("unit", "U1")
        self.assertEqual((row["state"], row["attempt"], row["epoch"], row["model"]), ("leased", 1, lease.epoch, "m1"))
        self.sm.advance_unit("U1", UnitState.SUBMITTED, UnitState.LEASED, epoch=lease.epoch,
                             extra=[(codes.UNIT_SUBMITTED, {"sha": "abc"})])
        self.sm.advance_unit("U1", UnitState.VERIFIED, epoch=lease.epoch)
        self.e.leases.release(lease)
        self.sm.advance_unit("U1", UnitState.MERGED, extra=[(codes.UNIT_MERGED, {})])
        self.assertEqual(self.sm.release_ready("R1"), ["U2"])
        sub = self.s.events_after(0, kinds=[codes.UNIT_SUBMITTED])[0]
        self.assertEqual((sub.env.unit, sub.env.attempt, sub.env.epoch), ("U1", 1, lease.epoch))
        board = project(self.s.events_after(0))
        self.assertEqual(board["runs"]["R1"]["units"]["U1"]["state"], "merged")
        self.assertEqual(board["runs"]["R1"]["units"]["U2"]["state"], "ready")

    def test_stale_epoch_changes_nothing(self):
        self.sm.put_unit(Unit("U1", "R1", state="ready"))
        l1 = self.sm.dispatch_unit("U1", self.e.leases, owner="b1")
        self.e.clock.advance(301)
        self.s.transition("unit", "U1", UnitState.READY, UnitState.LEASED)     # as the watchdog would
        l2 = self.sm.dispatch_unit("U1", self.e.leases, owner="b2")
        self.assertEqual(l2.epoch, l1.epoch + 1)
        n = self.s.last_seq()
        with self.assertRaises(LineError) as cm:
            self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=l1.epoch)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.assertEqual(self.s.get("unit", "U1")["state"], "leased")
        self.assertEqual(self.s.last_seq(), n)

    def test_dispatch_not_ready_releases_lease(self):
        self.sm.put_unit(Unit("U1", "R1"))       # pending
        with self.assertRaises(LineError) as cm:
            self.sm.dispatch_unit("U1", self.e.leases, owner="b1")
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
        self.assertIsNone(self.e.leases.current(unit_lease_name("U1")))

    def test_emitter_envelopes(self):
        em = Emitter(self.s, agent_version="av", model="mm")
        self.assertEqual(em.run_env("R1").spec_hash, "SH")
        self.assertEqual(envelope("R1").epoch, 0)
        with self.assertRaises(LineError) as cm:
            envelope("")
        self.assertEqual(cm.exception.code, codes.ENVELOPE_INVALID)


class FakeStateMachineTest(StateMachineContract, unittest.TestCase):
    def make(self):
        return fake_env()


class SqliteStateMachineTest(StateMachineContract, unittest.TestCase):
    def make(self):
        e = sqlite_env(self)
        e.leases = e.store.leases            # the store fences on its own lease table
        return e


if __name__ == "__main__":
    unittest.main()
