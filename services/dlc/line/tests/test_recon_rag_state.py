"""rag_state: the RAG System as lease authority (RagLeases, mirrored in the local lease table) and as a
record mirror with If-Match and conflict handling (RagRecords, MirroringStore); the reconciler's
rag_records check; the hooks are off by default."""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from contextlib import ExitStack

from line import codes
from line.chaos import SkewClock
from line.codes import LineError
from line.config import load_config
from line.contracts import E_RUN, E_UNIT, Lease, LeaseAuthority, Run, Unit, unit_lease_name
from line.lease import SqliteLeases
from line.rag.resilient import ResilientRag
from line.rag_state import (
    RAG_CONFLICT, MirroringStore, RagLeases, RagRecords, make_leases, on_admit, record_id, records_of,
    skew_margin_ms, wrap_store,
)
from line.reconciler import Reconciler
from line.scope import ScopedStore
from line.statemachine import StateMachine, update_row
from line.store import SqliteStore
from line.tests.fakes import FakeRag, ManualClock


class LeaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = SkewClock()
        self.store = SqliteStore(":memory:", clock=self.clock)
        self.remote = FakeRag(ManualClock(start_ms=self.clock.now_ms() + 86_400_000))   # remote clock a day ahead
        self.lm = RagLeases(self.remote, self.store, ttl_s=30)

    def tearDown(self) -> None:
        self.store.close()

    def test_grant_is_remote_first_and_mirrored_with_a_local_epoch(self) -> None:
        l1 = self.lm.acquire("unit:R:U1", "a")
        self.assertIsNotNone(l1)
        self.assertEqual(self.remote.calls[-1][0], "lease_acquire")
        self.assertIsNone(self.lm.acquire("unit:R:U1", "b"))                    # held
        self.assertEqual(self.store.leases.current("unit:R:U1").epoch, l1.epoch)  # store fencing sees it
        self.lm.release(l1)
        self.assertIsNone(self.remote.leases.current("unit:R:U1"))
        l2 = self.lm.acquire("unit:R:U1", "b")
        self.assertGreater(l2.epoch, l1.epoch)
        with self.assertRaises(LineError) as cm:
            self.lm.check("unit:R:U1", l1.epoch)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)

    def test_held_remotely_by_another_process(self) -> None:
        self.remote.leases.acquire("unit:R:U1", "elsewhere", 30)
        self.assertIsNone(self.lm.acquire("unit:R:U1", "a"))

    def test_local_expiry_comes_from_the_local_clock(self) -> None:
        t0 = self.clock.now_ms()
        l1 = self.lm.acquire("unit:R:U1", "a")
        self.assertLessEqual(l1.expires_ms, t0 + 30_000 - skew_margin_ms(30_000) + 50)
        self.assertGreater(l1.expires_ms, t0)
        r = self.lm.renew(l1)
        self.assertLess(r.expires_ms, self.clock.now_ms() + 30_000)
        self.clock.jump(31)                                                      # local time passes the TTL
        with self.assertRaises(LineError) as cm:
            self.lm.renew(r)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)

    def test_outage_no_new_grant_and_renew_runs_out_locally(self) -> None:
        l1 = self.lm.acquire("unit:R:U1", "a")
        self.remote.down = True
        self.assertIsNone(self.lm.acquire("unit:R:U2", "a"))                    # no silent local switch
        same = self.lm.renew(l1)
        self.assertEqual(same.expires_ms, l1.expires_ms)                         # not extended
        self.clock.jump(30)
        with self.assertRaises(LineError) as cm:
            self.lm.renew(l1)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.assertGreaterEqual(self.lm.outages, 2)
        self.lm.release(l1)                                                      # remote down: best effort

    def test_remote_lease_lost_releases_the_mirror(self) -> None:
        l1 = self.lm.acquire("unit:R:U1", "a")
        self.remote.leases.release(self.remote.leases.current("unit:R:U1"))      # the authority took it back
        with self.assertRaises(LineError) as cm:
            self.lm.renew(l1)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.assertIsNone(self.lm.current("unit:R:U1"))

    def test_make_leases_default_is_local(self) -> None:
        cfg = load_config(env={}, line_json=None, rag_local_json=None)
        rag = ResilientRag(self.remote, self.store, probe_interval_s=0)
        self.assertEqual(rag.admit_run("R"), LeaseAuthority.RAG.value)
        self.assertIs(type(make_leases(cfg, self.store, rag, "R")), SqliteLeases)
        cfg.rag_leases = True                                                    # proposed config field
        lm = make_leases(cfg, self.store, rag, "R")
        self.assertIsInstance(lm, RagLeases)
        self.remote.down = True
        rag2 = ResilientRag(self.remote, self.store, probe_interval_s=0)
        self.assertEqual(rag2.admit_run("R2"), LeaseAuthority.LOCAL.value)
        self.assertIs(type(make_leases(cfg, self.store, rag2, "R2")), SqliteLeases)


class RecordTests(unittest.TestCase):
    def setUp(self) -> None:
        self._x = ExitStack()
        self.store = SqliteStore(":memory:")
        self.remote = FakeRag()
        self.rag = ResilientRag(self.remote, self.store, probe_interval_s=0)
        self.rec = RagRecords(self.rag, self.store)
        StateMachine(self.store).admit_run(Run(id="R1", pack_path="p"))

    def tearDown(self) -> None:
        self._x.close()
        self.store.close()

    def remote_row(self, type: str, key: str):
        return self.remote.records.get((type, record_id(key)))

    def test_create_then_update_with_if_match(self) -> None:
        r1 = self.rec.push(E_RUN, "R1")
        self.assertEqual(r1.status, "written")
        self.assertEqual(self.rec.push(E_RUN, "R1").status, "same")              # nothing new
        update_row(self.store, E_RUN, "R1", {"detail": {"x": 1}})
        r2 = self.rec.push(E_RUN, "R1")
        self.assertEqual(r2.status, "written")
        body, etag = self.remote_row("run", "R1")
        self.assertEqual(body["row"]["detail"], {"x": 1})
        self.assertEqual(body["line_version"], self.store.version(E_RUN, "R1"))
        self.assertEqual(etag, r2.etag)
        puts = [c for c in self.remote.calls if c[0] == "put_record"]
        self.assertEqual(len(puts), 2)

    def test_stale_etag_with_older_remote_is_overwritten(self) -> None:
        self.rec.push(E_RUN, "R1")
        body, _ = self.remote_row("run", "R1")
        self.remote.records[("run", "R1")] = (dict(body, row={"old": True}), "other-etag")   # someone touched it
        update_row(self.store, E_RUN, "R1", {"detail": {"y": 2}})
        r = self.rec.push(E_RUN, "R1")
        self.assertEqual(r.status, "written")
        self.assertEqual(self.remote_row("run", "R1")[0]["row"]["detail"], {"y": 2})

    def test_newer_remote_is_a_conflict_and_not_overwritten(self) -> None:
        self.remote.records[("run", "R1")] = ({"line_version": 99, "row": {"theirs": 1}}, "e99")
        r = self.rec.push(E_RUN, "R1")
        self.assertEqual(r.status, "conflict")
        self.assertEqual(self.remote_row("run", "R1")[0]["row"], {"theirs": 1})
        ev = self.store.events_after(0, kinds=[RAG_CONFLICT])
        self.assertEqual(ev[-1].body["remote_version"], 99)
        self.assertEqual(ev[-1].env.run, "_line")
        behind = self.rec.behind("R1")
        self.assertTrue(behind and behind[0].get("conflict"))

    def test_same_content_adopts_the_remote_etag(self) -> None:
        v = self.store.version(E_RUN, "R1")
        self.remote.records[("run", "R1")] = ({"entity": E_RUN, "key": "R1", "line_version": v,
                                               "row": self.store.get(E_RUN, "R1")}, "eX")
        r = self.rec.push(E_RUN, "R1")
        self.assertEqual((r.status, r.etag), ("same", "eX"))

    def test_degraded_write_is_queued_and_the_next_write_resolves_its_etag(self) -> None:
        self.remote.down = True
        self.assertEqual(self.rec.push(E_RUN, "R1").status, "queued")
        update_row(self.store, E_RUN, "R1", {"detail": {"z": 3}})
        self.assertEqual(self.rec.push(E_RUN, "R1").status, "queued")
        self.remote.down = False
        self.rag.probe()
        self.assertEqual(self.store.outbox_peek(), [])
        self.assertEqual(self.rag.dead, [])
        self.assertEqual(self.remote_row("run", "R1")[0]["row"]["detail"], {"z": 3})

    def test_mirroring_store_pushes_after_local_writes(self) -> None:
        ms = MirroringStore(self.store, self.rec)
        sst = ScopedStore(ms, "R1")
        sm = StateMachine(sst)
        sm.put_unit(Unit(id="U1", run="R1"))
        sm.advance_unit("U1", "ready", "pending")
        body, _ = self.remote_row("unit", "R1:U1")
        self.assertEqual(body["row"]["state"], "ready")
        self.assertIs(records_of(sst), self.rec)
        self.assertEqual(self.rec.behind("R1"), [{"entity": E_RUN, "key": "R1", "type": "run",
                                                  "version": self.store.version(E_RUN, "R1"), "mirrored": 0,
                                                  "unit": ""}])

    def test_reconciler_pushes_rows_behind(self) -> None:
        cfg = load_config(env={}, line_json=None, rag_local_json=None,
                          workroot=tempfile.mkdtemp(prefix="line-rs-"))
        try:
            rep = Reconciler(self.store, cfg, records=self.rec).run_pass()
            d = [x for x in rep.drifts if x.check == "rag_records"]
            self.assertEqual([(x.status, x.detail["key"]) for x in d], [("repaired", "R1")])
            self.assertIsNotNone(self.remote_row("run", "R1"))
            self.assertTrue(Reconciler(self.store, cfg, records=self.rec).run_pass().clean)
        finally:
            shutil.rmtree(cfg.workroot, ignore_errors=True)

    def test_errors_never_raise(self) -> None:
        class Broken:
            def put_record(self, *a, **kw):
                raise LineError(codes.SCHEMA_INVALID, "bad")

            def get_record(self, *a, **kw):
                return None

        r = RagRecords(Broken(), self.store).push(E_RUN, "R1")
        self.assertEqual(r.status, "error")

    def test_hooks_default_off(self) -> None:
        cfg = load_config(env={}, line_json=None, rag_local_json=None)
        self.assertIs(wrap_store(self.store, cfg, self.rag), self.store)
        self.assertEqual(on_admit(self.store, cfg, self.rag, "R1"), [])
        cfg.rag_records = True                                                   # proposed config field
        ws = wrap_store(self.store, cfg, self.rag)
        self.assertIsInstance(ws, MirroringStore)
        self.assertIs(wrap_store(ws, cfg, self.rag), ws)
        self.assertEqual([r.status for r in on_admit(self.store, cfg, self.rag, "R1")], ["written"])


if __name__ == "__main__":
    unittest.main()
