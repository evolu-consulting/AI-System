"""S1 core: watchdog (expired leases) and loop breaker ladder (fakes and SQLite)."""

import unittest

from line import codes
from line.codes import LineError
from line.contracts import Attempt, Run, Unit, UnitState, unit_lease_name
from line.statemachine import StateMachine
from line.tests.test_core_store import fake_env, sqlite_env
from line.watchdog import RUNG_ESCALATE, RUNG_RETRY, RUNG_SWITCH_MODEL, Watchdog, decide, same_block


class DecideTest(unittest.TestCase):
    def test_pure_ladder(self):
        self.assertEqual(decide([], "fp1", 0, 3), (0, "retry"))
        h = [{"rung": 0, "fingerprint": "fp1"}]
        self.assertEqual(decide(h, "fp1", 0, 3), (1, "repeat"))
        self.assertEqual(decide(h, "fp2", 0, 3), (0, "retry"))
        h2 = h + [{"rung": 0, "fingerprint": "fp2"}]
        self.assertEqual(decide(h2, "fp3", 0, 3), (1, "exhausted"))
        # fingerprints of an earlier rung do not count on the new one
        self.assertEqual(decide(h2, "fp1", 1, 3), (1, "retry"))
        self.assertEqual(decide(h2 + [{"rung": 1, "fingerprint": "fp1"}], "fp1", 1, 3), (2, "repeat"))
        self.assertEqual(decide([], "", 0, 1), (1, "exhausted"))
        self.assertEqual(decide([{"rung": 0, "fingerprint": ""}], "", 0, 3), (0, "retry"), "no fingerprint, no repeat")


#: run R20261016-014516-7a66, unit U2: five BLOCKED attempts in other words, one cause
U2_BLOCKS = [
    "F1 tests can't start the app - Python 3.12.0 resolves npm to a shell script Windows can't run (WinError 193), "
    "and `npm start` needs `client/index.html` from F2; both fixes are outside my claims",
    "npm start cannot launch: Python 3.12.0's shutil.which returns the npm bash script (WinError 193), and "
    "package.json \"start\" needs a Vite build of client/index.html, which doesn't exist yet; both are outside U2's "
    "claims.",
    "tests cannot start the app on this host (python 3.12.0 shutil.which picks the npm bash shim, WinError 193; npm "
    "start also needs F2's client/index.html and npm install), none of which is fixable in store.js/app.js/index.js",
]


CLAIM_BLOCKS = [
    "need U2's store.js first: the import fails because store.js is outside my claims",
    "store.js from U2 is still missing, and it is outside my claims",
]
TEST_BLOCK = ("locked tests/acceptance/test_f1.py starts app.py without a temporary NOTES_FILE, so test_f4.C2 always "
              "fails; the fix belongs in test_f1.py outside my claims")


class SameBlockTest(unittest.TestCase):
    def test_same_cause_in_other_words(self):
        for a in U2_BLOCKS:
            for b in U2_BLOCKS:
                self.assertTrue(same_block(a, b), (a, b))
        self.assertFalse(same_block(U2_BLOCKS[0], "the orders table has no user_id column; the migration of U1 "
                                                  "must add it"))
        self.assertFalse(same_block("", U2_BLOCKS[0]))


class WatchdogContract:
    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.e = self.make()
        self.s = self.e.store
        self.sm = StateMachine(self.s, agent_version="t", model="m-main")
        self.sm.admit_run(Run("R1", "/pack", spec_hash="SH"))
        self.wd = Watchdog(self.s, self.e.leases, retry_n=3, model="m-main", model_alt="m-alt", agent_version="t")

    def leased_unit(self, uid="U1", checkpoint=None):
        u = Unit(uid, "R1", state="ready")
        if checkpoint:
            u.detail["checkpoint"] = checkpoint
        self.sm.put_unit(u)
        lease = self.sm.dispatch_unit(uid, self.e.leases, owner="b1")
        self.assertIsNotNone(lease)
        return lease

    def test_expired_lease_unit_back_to_ready(self):
        lease = self.leased_unit(checkpoint="sha-123")
        self.s.put("attempt", "U1#1", Attempt("U1", 1, epoch=lease.epoch))
        self.assertEqual(self.wd.tick(), [])               # still alive: nothing to do
        self.e.clock.advance(301)
        rep = self.wd.tick()
        self.assertEqual(rep, [{"lease": "unit:U1", "epoch": lease.epoch, "unit": "U1", "action": "requeued"}])
        row = self.s.get("unit", "U1")
        self.assertEqual(row["state"], "ready")
        self.assertEqual(row["detail"]["resume_from"], "sha-123")
        self.assertEqual(self.s.get("attempt", "U1#1")["outcome"], "lost")
        exp = self.s.events_after(0, kinds=[codes.LEASE_EXPIRED])
        self.assertEqual(len(exp), 1)
        self.assertEqual(exp[0].body, {"name": "unit:U1", "epoch": lease.epoch})
        self.assertEqual((exp[0].env.run, exp[0].env.unit, exp[0].env.epoch), ("R1", "U1", 0))
        req = self.s.events_after(0, kinds=[codes.UNIT_REQUEUED])
        self.assertEqual(req[0].body["code"], codes.LEASE_LOST)
        self.assertEqual(req[0].body["from"], "leased")
        st = self.s.events_after(0, kinds=[codes.UNIT_STATE])[-1]
        self.assertEqual(st.body, {"from": "leased", "to": "ready", "code": codes.LEASE_LOST})
        self.assertEqual(self.wd.tick(), [], "reaped: handled once")
        # the old holder is fenced out; the unit can be dispatched again with a new epoch
        with self.assertRaises(LineError) as cm:
            self.s.emit(codes.UNIT_SUBMITTED, {"run": "R1", "unit": "U1", "attempt": 1, "epoch": lease.epoch,
                                               "agent_version": "t", "model": "m", "spec_hash": "SH"}, {})
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        l2 = self.sm.dispatch_unit("U1", self.e.leases, owner="b2")
        self.assertEqual(l2.epoch, lease.epoch + 1)
        self.assertEqual(self.s.get("unit", "U1")["attempt"], 2)

    def test_expiry_after_unit_moved_on_is_stale(self):
        lease = self.leased_unit()
        self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
        self.e.clock.advance(301)
        self.assertEqual(self.wd.tick()[0]["action"], "stale")
        self.assertEqual(self.s.get("unit", "U1")["state"], "submitted")

    def test_non_unit_lease_just_reaped(self):
        self.e.leases.acquire("merge-queue", "m", ttl_s=5)
        self.e.clock.advance(6)
        self.assertEqual(self.wd.tick()[0]["action"], "reaped")
        self.assertEqual(self.e.leases.expired(), [])

    def test_fingerprint_ladder(self):
        lease = self.leased_unit()
        self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
        # 1st failure: retry same model
        d = self.wd.record_failure("U1", codes.TEST_FAIL, "fpA")
        self.assertEqual((d.action, d.rung, d.reason, d.model), ("retry", RUNG_RETRY, "retry", "m-main"))
        self.assertEqual(self.s.get("unit", "U1")["state"], "ready")
        # same fingerprint twice -> next rung: switch model
        lease = self.sm.dispatch_unit("U1", self.e.leases, owner="b")
        self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
        d = self.wd.record_failure("U1", codes.TEST_FAIL, "fpA")
        self.assertEqual((d.action, d.rung, d.reason, d.model), ("switch_model", RUNG_SWITCH_MODEL, "repeat", "m-alt"))
        row = self.s.get("unit", "U1")
        self.assertEqual((row["state"], row["rung"], row["model"]), ("ready", 1, "m-alt"))
        lease = self.sm.dispatch_unit("U1", self.e.leases, owner="b")
        self.assertEqual(self.s.events_after(0, kinds=[codes.UNIT_DISPATCHED])[-1].env.model, "m-alt")
        # new rung: a fingerprint seen on rung 0 is a first sighting here
        self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
        d = self.wd.record_failure("U1", codes.TEST_FAIL, "fpA")
        self.assertEqual((d.action, d.rung), ("retry", RUNG_SWITCH_MODEL))
        # ... and its repeat escalates with NO_PROGRESS
        lease = self.sm.dispatch_unit("U1", self.e.leases, owner="b")
        self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
        d = self.wd.record_failure("U1", codes.TEST_FAIL, "fpA")
        self.assertEqual((d.action, d.rung, d.code), ("escalate", RUNG_ESCALATE, codes.NO_PROGRESS))
        row = self.s.get("unit", "U1")
        self.assertEqual((row["state"], row["rung"]), ("failed", RUNG_ESCALATE))
        self.assertEqual(len(row["detail"]["failures"]), 4)
        esc = self.s.events_after(0, kinds=[codes.ESCALATED])
        self.assertEqual(esc[-1].body["code"], codes.NO_PROGRESS)
        self.assertEqual(esc[-1].env.unit, "U1")
        self.assertEqual(self.s.get("escalation", "R1:U1")["code"], codes.NO_PROGRESS)

    def test_retry_n_exhausted_with_distinct_failures(self):
        reasons = []
        for i in range(6):
            lease = self.sm.dispatch_unit("U1", self.e.leases, owner="b") if i else self.leased_unit()
            self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
            d = self.wd.record_failure("U1", codes.BUILD_FAIL, "fp%d" % i)
            reasons.append((d.action, d.rung))
            if d.action == "escalate":
                break
        self.assertEqual(reasons, [("retry", 0), ("retry", 0), ("switch_model", 1),
                                   ("retry", 1), ("retry", 1), ("escalate", 2)])
        self.assertEqual(self.s.get("escalation", "R1:U1")["code"], codes.BUILD_FAIL)

    def test_blocked_twice_for_the_same_cause_escalates_at_once(self):
        lease = self.leased_unit()
        self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
        d = self.wd.record_failure("U1", codes.BLOCKED, "fp0", {"key": "blocked:" + CLAIM_BLOCKS[0]})
        self.assertEqual((d.action, d.rung), ("retry", RUNG_RETRY))       # another unit's work may land meanwhile
        lease = self.sm.dispatch_unit("U1", self.e.leases, owner="b")
        self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
        d = self.wd.record_failure("U1", codes.BLOCKED, "fp1", {"key": "blocked:" + CLAIM_BLOCKS[1]})
        # not a retry, not the pricier model: a person decides
        self.assertEqual((d.action, d.rung, d.code), ("escalate", RUNG_ESCALATE, codes.BLOCKED_OUTSIDE_CLAIMS))
        esc = self.s.get("escalation", "R1:U1")
        self.assertEqual(esc["code"], codes.BLOCKED_OUTSIDE_CLAIMS)
        self.assertIn("another unit's files", esc["message"])
        self.assertIn("store.js", esc["message"])

    def test_blocked_by_the_host_or_a_locked_test_escalates_at_the_first_block(self):
        for reason, kind, says in ((U2_BLOCKS[0], "host", "machine"), (TEST_BLOCK, "test", "acceptance test")):
            self.setUp()
            lease = self.leased_unit()
            self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
            d = self.wd.record_failure("U1", codes.BLOCKED, "fp0", {"key": "blocked:" + reason[:200]})
            self.assertEqual((d.action, d.code), ("escalate", codes.BLOCKED_OUTSIDE_CLAIMS), reason)
            esc = self.s.get("escalation", "R1:U1")
            self.assertEqual(esc["detail"]["blocked_kind"], kind)
            self.assertIn(says, esc["message"])

    def test_blocked_never_climbs_to_the_alternate_model(self):
        lease = self.leased_unit()
        for i in range(3):
            self.sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch)
            d = self.wd.record_failure("U1", codes.BLOCKED, "fp%d" % i, {"key": "blocked:%s" % ("abc", "the spec "
                                       "does not say the colour", "max_turns")[i]})
            if d.action == "escalate":
                break
            self.assertEqual(d.model, "m-main", d)
            lease = self.sm.dispatch_unit("U1", self.e.leases, owner="b")

    def test_failure_while_leased_releases_lease(self):
        self.leased_unit()
        d = self.wd.record_failure("U1", codes.BUILD_FAIL, "x")
        self.assertEqual(d.action, "retry")
        self.assertIsNone(self.e.leases.current(unit_lease_name("U1")))
        self.assertEqual(self.s.get("unit", "U1")["state"], "ready")


class FakeWatchdogTest(WatchdogContract, unittest.TestCase):
    def make(self):
        return fake_env()


class SqliteWatchdogTest(WatchdogContract, unittest.TestCase):
    def make(self):
        e = sqlite_env(self)
        e.leases = e.store.leases
        return e

    def test_thread_start_stop(self):
        lease = self.leased_unit()
        self.e.clock.advance(301)
        wd = Watchdog(self.s, self.e.leases, interval_s=0.01).start()
        import time
        deadline = time.time() + 5
        while self.s.get("unit", "U1")["state"] != "ready" and time.time() < deadline:
            time.sleep(0.01)
        wd.stop()
        self.assertEqual(self.s.get("unit", "U1")["state"], "ready")
        self.assertEqual(lease.epoch, 1)


if __name__ == "__main__":
    unittest.main()
