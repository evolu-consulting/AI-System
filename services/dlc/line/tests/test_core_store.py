"""S1 core: Store behaviour, run against FakeStore and SqliteStore so the two agree.

Fixtures (imported by the other test_core_* modules):
  fake_env()            SimpleNamespace(clock, store, leases, budget, kind="fake")
  sqlite_env(testcase)  same over a temp-file SqliteStore (cleanup registered on the testcase)
"""

import os
import shutil
import tempfile
import threading
import types
import unittest

from line import codes
from line.codes import LineError
from line.contracts import Envelope, Run, Store, Unit, unit_lease_name
from line.tests.fakes import FakeBudget, FakeLeases, FakeStore, ManualClock


def env(run="R1", unit="", epoch=0, attempt=0):
    return {"run": run, "unit": unit, "attempt": attempt, "epoch": epoch, "agent_version": "t", "model": "m",
            "spec_hash": "h"}


def fake_env(ttl_s=300):
    clock = ManualClock()
    leases = FakeLeases(clock, ttl_s)
    return types.SimpleNamespace(kind="fake", clock=clock, leases=leases, store=FakeStore(clock, leases),
                                 budget=FakeBudget())


def sqlite_env(tc, ttl_s=300, path=None):
    from line.budget import SqliteBudget
    from line.lease import SqliteLeases
    from line.store import SqliteStore
    if path is None:
        d = tempfile.mkdtemp(prefix="line-core-")
        tc.addCleanup(shutil.rmtree, d, True)
        path = os.path.join(d, "line.db")
    clock = ManualClock()
    store = SqliteStore(path, clock=clock)
    tc.addCleanup(store.close)
    leases = SqliteLeases(store, ttl_s=ttl_s)
    return types.SimpleNamespace(kind="sqlite", clock=clock, leases=leases, store=store,
                                 budget=SqliteBudget(store), path=path)


class StoreContract:
    """Behaviour every contracts.Store must show. Subclass sets make()."""

    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.e = self.make()
        self.s = self.e.store

    def assertCode(self, code, fn, *a, **kw):
        with self.assertRaises(LineError) as cm:
            fn(*a, **kw)
        self.assertEqual(cm.exception.code, code, cm.exception)
        return cm.exception

    # ---- events

    def test_is_store(self):
        self.assertIsInstance(self.s, Store)

    def test_emit_and_read(self):
        self.assertEqual(self.s.last_seq(), 0)
        self.assertEqual(self.s.emit(codes.RUN_ADMITTED, env(), {"a": 1}), 1)
        self.assertEqual(self.s.emit(codes.RUN_STATE, Envelope("R2", agent_version="t"), {"to": "x"}), 2)
        evs = self.s.events_after(0)
        self.assertEqual([e.seq for e in evs], [1, 2])
        self.assertEqual(evs[0].kind, codes.RUN_ADMITTED)
        self.assertEqual(evs[0].env, Envelope("R1", "", 0, 0, "t", "m", "h"))
        self.assertEqual(evs[0].body, {"a": 1})
        self.assertEqual([e.seq for e in self.s.events_after(0, run="R2")], [2])
        self.assertEqual([e.seq for e in self.s.events_after(1)], [2])
        self.assertEqual([e.seq for e in self.s.events_after(0, kinds=[codes.RUN_STATE])], [2])
        self.assertEqual(len(self.s.events_after(0, limit=1)), 1)

    def test_envelope_missing_field_rejected(self):
        for field in ("run", "unit", "attempt", "epoch", "agent_version", "model", "spec_hash"):
            bad = env()
            del bad[field]
            e = self.assertCode(codes.ENVELOPE_INVALID, self.s.emit, codes.RUN_ADMITTED, bad, {})
            self.assertIn(field, e.detail["fields"])
        self.assertCode(codes.ENVELOPE_INVALID, self.s.emit, codes.RUN_ADMITTED, dict(env(), run=""), {})
        self.assertCode(codes.ENVELOPE_INVALID, self.s.emit, codes.RUN_ADMITTED, dict(env(), epoch=-1), {})
        self.assertCode(codes.ENVELOPE_INVALID, self.s.emit, codes.RUN_ADMITTED, "not-an-env", {})
        self.assertEqual(self.s.last_seq(), 0, "nothing written")

    def test_unknown_kind_rejected(self):
        self.assertCode(codes.UNKNOWN_KIND, self.s.emit, "run.exploded", env(), {})
        self.assertCode(codes.UNKNOWN_KIND, self.s.emit, "", env(), {})
        self.assertEqual(self.s.last_seq(), 0)

    def test_gapless_seq_under_8_concurrent_writers(self):
        n_threads, per = 8, 40
        barrier = threading.Barrier(n_threads)
        got, errors = [], []
        lock = threading.Lock()

        def writer(i):
            try:
                barrier.wait()
                mine = [self.s.emit(codes.RUN_STATE, env("R%d" % i), {"i": i, "k": k}) for k in range(per)]
                with lock:
                    got.extend(mine)
            except Exception as ex:  # pragma: no cover - reported below
                errors.append(ex)

        ts = [threading.Thread(target=writer, args=(i,)) for i in range(n_threads)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(errors, [])
        total = n_threads * per
        self.assertEqual(sorted(got), list(range(1, total + 1)))
        self.assertEqual([e.seq for e in self.s.events_after(0, limit=10 * total)], list(range(1, total + 1)))
        self.assertEqual(self.s.last_seq(), total)
        # per writer, its own events are in its own order
        for i in range(n_threads):
            self.assertEqual([e.body["k"] for e in self.s.events_after(0, run="R%d" % i, limit=total)], list(range(per)))

    def test_refused_write_leaves_no_gap(self):
        self.s.emit(codes.RUN_ADMITTED, env(), {})
        self.assertRaises(LineError, self.s.emit, codes.UNIT_SUBMITTED, env(unit="U1", epoch=7), {})
        self.assertEqual(self.s.emit(codes.RUN_STATE, env(), {}), 2)

    def test_stale_epoch_write_refused(self):
        name = unit_lease_name("U1")
        l1 = self.e.leases.acquire(name, "a")
        self.assertEqual(self.s.emit(codes.UNIT_DISPATCHED, env(unit="U1", epoch=l1.epoch), {}), 1)
        self.e.clock.advance(301)            # l1 expires
        l2 = self.e.leases.acquire(name, "b")
        self.assertEqual(l2.epoch, l1.epoch + 1)
        e = self.assertCode(codes.LEASE_LOST, self.s.emit, codes.UNIT_SUBMITTED, env(unit="U1", epoch=l1.epoch), {})
        self.assertEqual(e.detail["epoch"], l1.epoch)
        self.assertEqual(self.s.emit(codes.UNIT_SUBMITTED, env(unit="U1", epoch=l2.epoch), {}), 2)
        # epoch 0 (watchdog / unfenced) always allowed; a lease never granted refuses epoch > 0
        self.assertEqual(self.s.emit(codes.LEASE_EXPIRED, env(unit="U1", epoch=0), {}), 3)
        self.assertCode(codes.LEASE_LOST, self.s.emit, codes.UNIT_SUBMITTED, env(unit="U9", epoch=1), {})
        # released lease -> stale too
        self.e.leases.release(l2)
        self.assertCode(codes.LEASE_LOST, self.s.emit, codes.UNIT_SUBMITTED, env(unit="U1", epoch=l2.epoch), {})
        self.assertEqual(self.s.last_seq(), 3)

    def test_unsynced_cursor(self):
        for _ in range(3):
            self.s.emit(codes.RUN_STATE, env(), {})
        self.assertEqual([e.seq for e in self.s.unsynced()], [1, 2, 3])
        self.s.mark_synced([1, 3])
        self.assertEqual([e.seq for e in self.s.unsynced()], [2])
        self.assertTrue(self.s.events_after(0)[0].synced)

    # ---- records

    def test_records_versions_and_cas(self):
        self.assertIsNone(self.s.get("unit", "U1"))
        self.assertEqual(self.s.version("unit", "U1"), 0)
        self.assertEqual(self.s.put("unit", "U1", Unit("U1", "R1")), 1)
        self.assertEqual(self.s.get("unit", "U1")["state"], "pending")
        self.assertEqual(self.s.put("unit", "U1", dict(self.s.get("unit", "U1"), title="t"), if_version=1), 2)
        e = self.assertCode(codes.STATE_CONFLICT, self.s.put, "unit", "U1", {"id": "U1", "run": "R1"}, if_version=1)
        self.assertEqual(e.detail["version"], 2)
        self.assertCode(codes.STATE_CONFLICT, self.s.put, "unit", "U2", {"id": "U2", "run": "R1"}, if_version=3)
        self.assertEqual(self.s.put("unit", "U2", {"id": "U2", "run": "R1", "state": "ready"}, if_version=0), 1)
        self.assertCode(codes.NOT_FOUND, self.s.put, "no_such_entity", "x", {})
        self.assertEqual(self.s.get("unit", "U1")["title"], "t")

    def test_query(self):
        self.s.put("unit", "U2", Unit("U2", "R1", state="ready"))
        self.s.put("unit", "U1", Unit("U1", "R1"))
        self.s.put("unit", "X1", Unit("X1", "R2", state="ready"))
        self.s.put("unit", "U2", dict(self.s.get("unit", "U2"), wave=2))     # update keeps order
        self.assertEqual([u["id"] for u in self.s.query("unit", run="R1")], ["U2", "U1"])
        self.assertEqual([u["id"] for u in self.s.query("unit", state="ready")], ["U2", "X1"])
        from line.contracts import UnitState
        self.assertEqual([u["id"] for u in self.s.query("unit", run="R1", state=UnitState.READY)], ["U2"])
        self.assertEqual([u["id"] for u in self.s.query("unit", wave=2)], ["U2"])
        self.assertEqual(self.s.query("run"), [])

    # ---- transitions

    def test_transition_cas_and_illegal(self):
        self.s.put("run", "R1", Run("R1", "/p"))
        row = self.s.transition("run", "R1", "understanding", "admitted")
        self.assertEqual(row["state"], "understanding")
        self.assertEqual(self.s.get("run", "R1")["state"], "understanding")
        self.assertEqual(self.s.version("run", "R1"), 2)
        # CAS: expected state is stale
        e = self.assertCode(codes.STATE_CONFLICT, self.s.transition, "run", "R1", "planning", "admitted")
        self.assertEqual(e.detail["state"], "understanding")
        # illegal: understanding -> green skips the machine
        self.assertCode(codes.ILLEGAL_TRANSITION, self.s.transition, "run", "R1", "green", "understanding")
        self.assertCode(codes.ILLEGAL_TRANSITION, self.s.transition, "run", "R1", "understanding", ["understanding"])
        self.assertCode(codes.NOT_FOUND, self.s.transition, "run", "nope", "planning", "admitted")
        self.assertCode(codes.ILLEGAL_TRANSITION, self.s.transition, "graph", "R1", "x", "y")
        self.assertEqual(self.s.get("run", "R1")["state"], "understanding", "refused transitions change nothing")
        # terminal
        self.s.put("unit", "U1", Unit("U1", "R1", state="merged"))
        self.assertCode(codes.ILLEGAL_TRANSITION, self.s.transition, "unit", "U1", "ready", "merged")

    def test_transition_cas_race_one_winner(self):
        self.s.put("unit", "U1", Unit("U1", "R1", state="ready"))
        barrier = threading.Barrier(6)
        wins, conflicts = [], []

        def go(i):
            barrier.wait()
            try:
                self.s.transition("unit", "U1", "leased", "ready")
                wins.append(i)
            except LineError as e:
                conflicts.append(e.code)

        ts = [threading.Thread(target=go, args=(i,)) for i in range(6)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(len(wins), 1)
        self.assertEqual(conflicts, [codes.STATE_CONFLICT] * 5)

    # ---- outbox

    def test_outbox(self):
        a = self.s.outbox_push("append_events", {"batch": [1]}, "k1")
        b = self.s.outbox_push("metric", {"name": "x"}, "k2")
        self.assertLess(a, b)
        items = self.s.outbox_peek()
        self.assertEqual([(i.op, i.idem_key, i.tries) for i in items], [("append_events", "k1", 0), ("metric", "k2", 0)])
        self.assertEqual(items[0].args, {"batch": [1]})
        self.s.outbox_fail(a)
        self.assertEqual(self.s.outbox_peek(1)[0].tries, 1)
        self.s.outbox_ack(a)
        self.assertEqual([i.id for i in self.s.outbox_peek()], [b])


class FakeStoreTest(StoreContract, unittest.TestCase):
    def make(self):
        return fake_env()


class SqliteStoreTest(StoreContract, unittest.TestCase):
    def make(self):
        return sqlite_env(self)

    def test_wal_and_reopen(self):
        from line.store import SqliteStore
        mode = self.s._conn().execute("PRAGMA journal_mode").fetchone()[0]
        self.assertEqual(mode.lower(), "wal")
        self.s.emit(codes.RUN_ADMITTED, env(), {"x": 1})
        self.s.put("run", "R1", Run("R1", "/p"))
        self.s.outbox_push("metric", {}, "k")
        self.s.close()
        s2 = SqliteStore(self.e.path, clock=self.e.clock)
        self.addCleanup(s2.close)
        self.assertEqual(s2.last_seq(), 1)
        self.assertEqual(s2.get("run", "R1")["pack_path"], "/p")
        self.assertEqual(s2.version("run", "R1"), 1)
        self.assertEqual(len(s2.outbox_peek()), 1)
        self.assertEqual(s2.emit(codes.RUN_STATE, env(), {}), 2)

    def test_gapless_across_instances(self):
        """4 store instances (separate connections, as separate processes would have) on one file."""
        from line.store import SqliteStore
        stores = [SqliteStore(self.e.path, clock=self.e.clock) for _ in range(4)]
        for s in stores:
            self.addCleanup(s.close)
        barrier = threading.Barrier(8)
        got, errors = [], []
        lock = threading.Lock()

        def writer(i):
            try:
                barrier.wait()
                mine = [stores[i % 4].emit(codes.RUN_STATE, env("R%d" % i), {}) for _ in range(25)]
                with lock:
                    got.extend(mine)
            except Exception as ex:  # pragma: no cover
                errors.append(ex)

        ts = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(sorted(got), list(range(1, 201)))
        self.assertEqual([e.seq for e in self.s.events_after(0, limit=500)], list(range(1, 201)))

    def test_external_fence(self):
        """leases=<other LeaseManager>: fencing follows that authority."""
        from line.store import SqliteStore
        other = FakeLeases(self.e.clock)
        s = SqliteStore(os.path.join(os.path.dirname(self.e.path), "b.db"), clock=self.e.clock, leases=other)
        self.addCleanup(s.close)
        self.assertIs(s.leases, other)
        l1 = other.acquire(unit_lease_name("U1"), "a")
        self.assertEqual(s.emit(codes.UNIT_SUBMITTED, env(unit="U1", epoch=l1.epoch), {}), 1)
        with self.assertRaises(LineError) as cm:
            s.emit(codes.UNIT_SUBMITTED, env(unit="U1", epoch=l1.epoch + 1), {})
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)


class SqliteMemoryStoreTest(StoreContract, unittest.TestCase):
    def make(self):
        from line.lease import SqliteLeases
        from line.store import SqliteStore
        clock = ManualClock()
        store = SqliteStore(":memory:", clock=clock)
        self.addCleanup(store.close)
        return types.SimpleNamespace(kind="sqlite-mem", clock=clock, store=store, leases=SqliteLeases(store))


if __name__ == "__main__":
    unittest.main()
