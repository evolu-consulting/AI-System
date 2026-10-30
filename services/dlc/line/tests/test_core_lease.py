"""S1 core: LeaseManager behaviour (FakeLeases and SqliteLeases) + Heartbeat."""

import threading
import time
import unittest

from line import codes
from line.codes import LineError
from line.contracts import LeaseManager, unit_lease_name
from line.tests.test_core_store import fake_env, sqlite_env


class LeaseContract:
    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.e = self.make()
        self.L = self.e.leases

    def test_is_lease_manager(self):
        self.assertIsInstance(self.L, LeaseManager)

    def test_six_thread_race_exactly_one_winner(self):
        for round_ in range(3):
            name = "unit:race%d" % round_
            barrier = threading.Barrier(6)
            results = []
            lock = threading.Lock()

            def go(i):
                barrier.wait()
                r = self.L.acquire(name, "w%d" % i)
                with lock:
                    results.append(r)

            ts = [threading.Thread(target=go, args=(i,)) for i in range(6)]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
            winners = [r for r in results if r is not None]
            self.assertEqual(len(results), 6)
            self.assertEqual(len(winners), 1, results)
            self.assertEqual(winners[0].epoch, 1)
            self.assertEqual(self.L.current(name).owner, winners[0].owner)

    def test_epoch_increments_per_grant(self):
        name = unit_lease_name("U1")
        l1 = self.L.acquire(name, "a", ttl_s=300)
        self.assertEqual(l1.epoch, 1)
        self.assertEqual(l1.expires_ms, self.e.clock.now_ms() + 300_000)
        self.assertIsNone(self.L.acquire(name, "b"))
        self.L.release(l1)
        l2 = self.L.acquire(name, "b")
        self.assertEqual(l2.epoch, 2)
        self.e.clock.advance(300)
        l3 = self.L.acquire(name, "c")      # expired holder: anyone may take it
        self.assertEqual(l3.epoch, 3)

    def test_stale_epoch_refused(self):
        name = unit_lease_name("U1")
        l1 = self.L.acquire(name, "a")
        self.L.check(name, l1.epoch)
        self.e.clock.advance(301)
        with self.assertRaises(LineError) as cm:
            self.L.check(name, l1.epoch)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        with self.assertRaises(LineError) as cm:
            self.L.renew(l1)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        l2 = self.L.acquire(name, "b")
        for fn in (lambda: self.L.check(name, l1.epoch), lambda: self.L.renew(l1)):
            with self.assertRaises(LineError) as cm:
                fn()
            self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.L.release(l1)                  # no-op: not the holder
        self.assertEqual(self.L.current(name).epoch, l2.epoch)

    def test_renew_extends(self):
        name = "n"
        l1 = self.L.acquire(name, "a", ttl_s=300)
        self.e.clock.advance(200)
        l1b = self.L.renew(l1)
        self.assertEqual(l1b.epoch, l1.epoch)
        self.assertEqual(l1b.expires_ms, self.e.clock.now_ms() + 300_000)
        self.e.clock.advance(200)           # 400 s after grant, alive thanks to renew
        self.L.check(name, l1.epoch)
        self.assertEqual(self.L.expired(), [])

    def test_expired_and_reap(self):
        a = self.L.acquire("unit:A", "x", ttl_s=10)
        self.L.acquire("unit:B", "y", ttl_s=1000)
        self.assertEqual(self.L.expired(), [])
        self.e.clock.advance(11)
        exp = self.L.expired()
        self.assertEqual([(l.name, l.epoch) for l in exp], [("unit:A", a.epoch)])
        self.assertIsNone(self.L.current("unit:A"))
        self.L.reap(exp[0])
        self.assertEqual(self.L.expired(), [])
        self.assertEqual(self.L.acquire("unit:A", "z").epoch, a.epoch + 1)
        later = self.L.expired(now_ms=self.e.clock.now_ms() + 2_000_000)
        self.assertEqual(sorted(l.name for l in later), ["unit:A", "unit:B"])

    def test_heartbeat_renews_then_reports_loss(self):
        from line.lease import Heartbeat
        name = "unit:HB"
        lease = self.L.acquire(name, "a", ttl_s=300)
        hb = Heartbeat(self.L, lease, interval_s=0.01)
        self.assertTrue(hb.beat())
        self.e.clock.advance(250)
        self.assertTrue(hb.beat())
        self.e.clock.advance(250)           # 500 s since grant, still alive
        self.L.check(name, lease.epoch)
        lost = []
        hb2 = Heartbeat(self.L, hb.lease, interval_s=0.01, on_lost=lost.append).start()
        deadline = time.time() + 5
        while hb2.renewals < 2 and time.time() < deadline:
            time.sleep(0.01)
        self.assertGreaterEqual(hb2.renewals, 2)
        self.L.release(hb2.lease)           # lease gone -> next beat reports loss and stops
        deadline = time.time() + 5
        while not lost and time.time() < deadline:
            time.sleep(0.01)
        hb2.stop()
        self.assertEqual(len(lost), 1)
        self.assertEqual(lost[0].code, codes.LEASE_LOST)
        self.assertIsNotNone(hb2.lost)


class FakeLeasesTest(LeaseContract, unittest.TestCase):
    def make(self):
        return fake_env()


class SqliteLeasesTest(LeaseContract, unittest.TestCase):
    def make(self):
        return sqlite_env(self)

    def test_race_across_instances(self):
        """6 contenders on 6 separate store connections to one file: still exactly one winner."""
        from line.lease import SqliteLeases
        from line.store import SqliteStore
        mgrs = []
        for _ in range(6):
            s = SqliteStore(self.e.path, clock=self.e.clock)
            self.addCleanup(s.close)
            mgrs.append(SqliteLeases(s))
        barrier = threading.Barrier(6)
        results = []

        def go(i):
            barrier.wait()
            results.append(mgrs[i].acquire("unit:X", "w%d" % i))

        ts = [threading.Thread(target=go, args=(i,)) for i in range(6)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(sum(r is not None for r in results), 1)

    def test_epoch_survives_reopen(self):
        from line.lease import SqliteLeases
        from line.store import SqliteStore
        l1 = self.L.acquire("unit:P", "a")
        self.L.release(l1)
        self.e.store.close()
        s2 = SqliteStore(self.e.path, clock=self.e.clock)
        self.addCleanup(s2.close)
        self.assertEqual(SqliteLeases(s2).acquire("unit:P", "b").epoch, l1.epoch + 1)


if __name__ == "__main__":
    unittest.main()
