"""ResilientRag (degraded mode + outbox replay), LocalRagAdapter, make_rag and the manifest.

Outage tests run the real HttpRagAdapter against the in-process StubServer from test_rag_http.
The optional live test runs only with LINE_RAG_LIVE=1 against LINE_RAG_URL (required)
with LINE_RAG_CLIENT_ID / LINE_RAG_CLIENT_SECRET set.
"""

from __future__ import annotations

import os
import unittest
import uuid

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import Envelope, LeaseAuthority, RagPort
from line.rag import manifest
from line.rag.http_adapter import HttpRagAdapter
from line.rag.local_adapter import LocalRagAdapter
from line.rag.port import make_rag
from line.rag.resilient import QUEUED_ETAG_PREFIX, ResilientRag
from line.tests.fakes import FakeRag, FakeStore
from line.tests.test_rag_http import StubServer, make_adapter


def kinds(store, *ks):
    return [e for e in store.events_after(0) if e.kind in ks]


def emit(store, kind=codes.RUN_ADMITTED, run="r1", **body):
    return store.emit(kind, Envelope(run=run, agent_version="line-0.1", spec_hash="h"), body)


class ResilientHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.srv = StubServer()
        self.st = self.srv.state
        self.store = FakeStore()
        self.rag = ResilientRag(make_adapter(self.srv), self.store, probe_interval_s=0)

    def tearDown(self) -> None:
        self.srv.stop()

    def test_is_a_ragport(self) -> None:
        self.assertIsInstance(self.rag, RagPort)
        self.assertIsInstance(LocalRagAdapter(self.store), RagPort)
        self.assertIsInstance(make_adapter(self.srv), RagPort)

    def test_healthy_writes_go_straight_through(self) -> None:
        emit(self.store)
        self.assertEqual(self.rag.sync_events(), 1)
        self.assertEqual(len(self.st.events), 1)
        etag = self.rag.put_record("run", "r1", {"state": "admitted"})
        self.assertEqual(etag, '"1"')
        self.assertEqual(self.store.outbox_peek(), [])
        self.assertEqual(self.rag.degraded(), [])
        self.assertEqual(kinds(self.store, codes.RAG_DEGRADED_KIND), [])

    def test_two_stores_with_the_same_seqs_are_not_replays(self) -> None:
        emit(self.store, run="_line")
        self.assertEqual(self.rag.sync_events(), 1)
        other = FakeStore()
        other.clock.t += 1                        # a second database: same run name and seq, another moment
        emit(other, run="_line")
        self.assertEqual(ResilientRag(make_adapter(self.srv), other, probe_interval_s=0).sync_events(), 1)
        self.assertEqual(len(self.st.events), 2)
        keys = [w["idem"] for w in self.st.writes("/events")]
        self.assertEqual(len(set(keys)), 2, keys)
        self.assertFalse(any(w["replay"] for w in self.st.writes("/events")))

    def _outage_then_restore(self, break_fn, heal_fn) -> None:
        emit(self.store)
        self.rag.sync_events()
        self.rag.put_record("run", "r1", {"state": "admitted"}, idem_key="rec-0")
        break_fn()
        # writes during the outage never raise; they queue in order
        emit(self.store, codes.SPEC_FROZEN)
        emit(self.store, codes.DIGEST_DONE)
        self.assertEqual(self.rag.sync_events(), 2)
        e1 = self.rag.put_record("run", "r1", {"state": "understanding"}, if_match='"1"', idem_key="rec-1")
        e2 = self.rag.put_record("run", "r1", {"state": "planning"}, if_match=e1, idem_key="rec-2")
        self.assertTrue(e1.startswith(QUEUED_ETAG_PREFIX) and e2.startswith(QUEUED_ETAG_PREFIX))
        self.rag.metric("run_usd", 0.1, {"run": "r1"})
        self.assertEqual(self.rag.retrieve("builder", "build", ["py"], 500), [])
        queued = self.store.outbox_peek()
        self.assertEqual([i.op for i in queued], ["append_events", "put_record", "put_record", "metric"])
        self.assertTrue(queued[0].idem_key.startswith("ev-2-3-"), queued[0].idem_key)
        self.assertEqual([i.idem_key for i in queued][1:3], ["rec-1", "rec-2"])
        self.assertIn("events", self.rag.degraded())
        self.assertTrue(kinds(self.store, codes.RAG_DEGRADED_KIND))
        self.assertTrue(all(i.tries == 0 for i in queued))
        n_before = len(self.st.writes())
        heal_fn()
        restored = self.rag.probe()
        self.assertEqual(self.store.outbox_peek(), [])
        self.assertEqual(self.rag.degraded(), [])
        self.assertTrue({"events", "records", "metrics", "retrieve"} <= set(restored))
        replay = self.st.writes()[n_before:]
        self.assertEqual([w["idem"] for w in replay], [i.idem_key for i in queued])   # same keys, same order
        self.assertEqual([e["kind"] for e in self.st.events], [codes.RUN_ADMITTED, codes.SPEC_FROZEN, codes.DIGEST_DONE])
        self.assertEqual([e["seq"] for e in self.st.events], [1, 2, 3])
        body, rev = self.st.records[("run", "r1")]
        self.assertEqual((body["state"], rev), ("planning", 3))       # queued etags resolved on replay
        self.assertEqual(len(self.st.metrics), 1)
        rest = {e.body["capability"]: e.body["replayed"] for e in kinds(self.store, codes.RAG_RESTORED)}
        self.assertEqual((rest["events"], rest["records"], rest["metrics"]), (1, 2, 1))
        # a second replay of the same keys is harmless (idempotent on the server)
        self.assertEqual(self.rag.probe(), [])

    def test_5xx_outage_degrades_queues_and_replays(self) -> None:
        self._outage_then_restore(lambda: setattr(self.st, "down", True), lambda: setattr(self.st, "down", False))

    def test_connection_refused_degrades_queues_and_replays(self) -> None:
        self._outage_then_restore(self.srv.stop, self.srv.start)

    def test_outbox_survives_restart_and_replays_with_same_key(self) -> None:
        self.st.down = True
        self.rag.put_record("unit", "U1", {"state": "ready"}, idem_key="k-restart")
        self.assertEqual(len(self.store.outbox_peek()), 1)
        self.st.down = False
        fresh = ResilientRag(make_adapter(self.srv), self.store, probe_interval_s=0)   # new process, same Store
        self.assertEqual(fresh.pending("records"), 1)
        fresh.put_record("unit", "U2", {"state": "ready"}, idem_key="k-after")
        self.assertEqual([w["idem"] for w in self.st.writes("/records/")], ["k-restart", "k-after"])

    def test_missing_capability_degrades_only_that_capability(self) -> None:
        self.st.missing = {"retrieval", "metrics"}
        caps = self.rag.capabilities()
        self.assertEqual(caps.degraded, ["metrics", "retrieve"])
        self.assertTrue(caps.has("records") and not caps.has("retrieve"))
        self.assertEqual(self.rag.retrieve("builder", "build", [], 100), [])
        self.rag.metric("run_usd", 1.0)
        self.assertEqual(self.rag.put_record("run", "r1", {"x": 1}), '"1"')       # records still live
        emit(self.store)
        n = self.rag.sync_events()               # run.admitted + the two rag.degraded events
        self.assertEqual(len(self.st.events), n)
        self.assertEqual(n, 3)
        self.assertEqual([i.op for i in self.store.outbox_peek()], ["metric"])
        self.assertFalse([w for w in self.st.log if w["path"].startswith("/context")])
        degraded = sorted(e.body["capability"] for e in kinds(self.store, codes.RAG_DEGRADED_KIND))
        self.assertEqual(degraded, ["metrics", "retrieve"])
        self.st.missing = set()
        self.assertEqual(sorted(self.rag.probe()), ["metrics", "retrieve"])
        self.assertEqual(len(self.st.metrics), 1)

    def test_domain_errors_are_not_swallowed(self) -> None:
        self.rag.put_record("graph", "r1", {"units": []})
        with self.assertRaises(LineError) as cm:
            self.rag.put_record("graph", "r1", {"units": [1]}, if_match='"7"')
        self.assertEqual(cm.exception.code, codes.VERSION_CONFLICT)
        self.assertEqual(self.store.outbox_peek(), [])

    def test_lease_authority_fixed_at_admission(self) -> None:
        self.assertEqual(self.rag.admit_run("r1"), LeaseAuthority.RAG.value)
        lease = self.rag.lease_port("r1").lease_acquire("unit:U1", 60, "b1")
        self.assertEqual(lease.epoch, 1)
        self.st.down = True
        with self.assertRaises(LineError) as cm:                     # no silent switch to local fencing
            self.rag.lease_port("r1").lease_renew(lease, 60)
        self.assertEqual(cm.exception.code, codes.RAG_DEGRADED)
        self.assertEqual(self.rag.admit_run("r2"), LeaseAuthority.LOCAL.value)
        self.assertEqual(self.rag.admit_run("r1"), LeaseAuthority.RAG.value)   # unchanged
        local = self.rag.lease_port("r2")
        self.assertIs(local, self.rag.local)
        self.assertEqual(local.lease_acquire("unit:U1", 60, "b2").epoch, 1)
        self.st.down = False
        self.rag.probe()
        self.assertEqual(self.rag.lease_authority("r2"), LeaseAuthority.LOCAL.value)

    def test_quote_falls_back_to_local_pack(self) -> None:
        self.st.down = True
        self.assertEqual(self.rag.freeze_pack({"spec.md": "# A\nexit 1\n"}), "")
        sp = self.rag.quote("spec.md", "exit 1")
        self.assertEqual(sp.id, "spec.md#L2-2")
        self.assertIsNone(self.rag.quote("spec.md", "nothing"))


class ResilientFakeTests(unittest.TestCase):
    """Same rules against FakeRag (no HTTP)."""

    def test_fake_outage_and_restore(self) -> None:
        store, remote = FakeStore(), FakeRag()
        rag = ResilientRag(remote, store, probe_interval_s=0)
        rag.append_events([{"seq": 1}], "a")
        remote.down = True
        rag.append_events([{"seq": 2}], "b")
        rag.append_events([{"seq": 3}], "c")
        self.assertEqual([i.idem_key for i in store.outbox_peek()], ["b", "c"])
        remote.down = False
        rag.probe()
        self.assertEqual([e["seq"] for e in remote.events], [1, 2, 3])
        self.assertEqual(rag.degraded(), [])

    def test_probe_interval_limits_probing(self) -> None:
        t = [0.0]
        store, remote = FakeStore(), FakeRag()
        rag = ResilientRag(remote, store, probe_interval_s=30, now=lambda: t[0])
        remote.down = True
        rag.metric("x", 1)
        n = len(remote.calls)
        remote.down = False
        rag.metric("x", 2)                       # within the interval: queued, no probe
        self.assertEqual(len(remote.calls), n)
        t[0] += 31
        rag.metric("x", 3)
        self.assertEqual([m[1] for m in remote.metrics], [1.0, 2.0, 3.0])

    def test_permanent_replay_error_goes_dead_after_max_tries(self) -> None:
        store, remote = FakeStore(), FakeRag()
        rag = ResilientRag(remote, store, probe_interval_s=0, max_tries=2)
        remote.records[("run", "r1")] = ({"a": 1}, "etag-x")
        remote.down = True
        rag.put_record("run", "r1", {"a": 2}, if_match="stale")
        remote.down = False
        rag.probe()
        self.assertEqual(len(store.outbox_peek()), 1)
        rag.probe()
        self.assertEqual(store.outbox_peek(), [])
        self.assertEqual(rag.dead[0]["error"]["code"], codes.VERSION_CONFLICT)


class LocalAndFactoryTests(unittest.TestCase):
    def test_off_mode_is_local(self) -> None:
        store = FakeStore()
        rag = make_rag(load_config(env={}, line_json=None, rag_local_json=None), store)
        self.assertIsInstance(rag, LocalRagAdapter)
        self.assertEqual(rag.admit_run("r1"), LeaseAuthority.LOCAL.value)
        self.assertEqual(rag.retrieve("a", "b", [], 100), [])
        emit(store)
        self.assertEqual([e["kind"] for e in rag.events_after(0)], [codes.RUN_ADMITTED])

    def test_env_off_overrides(self) -> None:
        cfg = load_config(env={"LINE_RAG": "off"}, line_json=None, rag_local_json=None)
        self.assertIsInstance(make_rag(cfg, FakeStore()), LocalRagAdapter)

    def test_http_mode_is_resilient(self) -> None:
        cfg = load_config(env={"LINE_RAG": "http", "LINE_RAG_URL": "http://rag.invalid"}, line_json=None,
                          rag_local_json=None)
        rag = make_rag(cfg, FakeStore())
        self.assertIsInstance(rag, ResilientRag)
        self.assertIsInstance(rag.remote, HttpRagAdapter)

    def test_http_mode_needs_url(self) -> None:
        with self.assertRaises(LineError) as cm:
            load_config(env={"LINE_RAG": "http"}, line_json=None, rag_local_json=None)
        self.assertEqual(cm.exception.code, codes.CONFIG_INVALID)

    def test_local_records_and_leases(self) -> None:
        store = FakeStore()
        rag = LocalRagAdapter(store)
        e1 = rag.put_record("digest", "r1:A", {"v": 1})
        with self.assertRaises(LineError) as cm:
            rag.put_record("digest", "r1:A", {"v": 2})
        self.assertEqual(cm.exception.code, codes.PRECONDITION_REQUIRED)
        with self.assertRaises(LineError) as cm:
            rag.put_record("digest", "r1:A", {"v": 2}, if_match="bad")
        self.assertEqual(cm.exception.code, codes.VERSION_CONFLICT)
        rag.put_record("digest", "r1:A", {"v": 2}, if_match=e1)
        self.assertEqual(rag.get_record("digest", "r1:A")[0], {"v": 2})
        store.put("run", "r9", {"id": "r9", "run": "r9", "state": "admitted"})
        self.assertEqual(rag.get_record("run", "r9"), ({"id": "r9", "run": "r9", "state": "admitted"}, "v1"))
        lease = rag.lease_acquire("unit:U1", 60, "b1")
        self.assertIsNone(rag.lease_acquire("unit:U1", 60, "b2"))
        self.assertIsNotNone(rag.lease_renew(lease, 60))


class ManifestTests(unittest.TestCase):
    def test_manifest_shape(self) -> None:
        doc = manifest.build({"redaction_packs": ["p@1"]})
        types = {t["type"]: t for t in doc["types"]}
        for k in codes.EVENT_KINDS:
            self.assertEqual(types[k]["kind_of"], "event")
        for r in ("run", "unit", "digest", "test", "graph"):
            self.assertEqual(types[r]["kind_of"], "record")
            self.assertTrue(types[r]["require_if_match"])
        for m in manifest.METRICS:
            self.assertEqual(types[m]["kind_of"], "metric")
        self.assertEqual(doc["redaction"], {"packs": ["p@1"]})
        self.assertNotIn("redaction", manifest.build())
        self.assertEqual(doc["keyspaces"][0]["dims"], ["role", "step", "stack"])


@unittest.skipUnless(os.environ.get("LINE_RAG_LIVE") == "1", "live RAG System test: set LINE_RAG_LIVE=1")
class LiveRagTests(unittest.TestCase):
    def test_live_round_trip(self) -> None:
        cfg = load_config(rag="http")
        if not cfg.rag_client_id or not cfg.rag_client_secret:
            self.skipTest("LINE_RAG_CLIENT_ID / LINE_RAG_CLIENT_SECRET not set")
        http = HttpRagAdapter.from_config(cfg)
        caps = http.capabilities()
        self.assertTrue(caps.events, caps)
        http.apply_manifest()
        store = FakeStore()
        rag = ResilientRag(http, store, probe_interval_s=0)
        run = "live-" + uuid.uuid4().hex[:8]
        emit(store, run=run)
        self.assertEqual(rag.sync_events(), 1)
        etag = rag.put_record("run", run, {"run": run, "state": "admitted"}, idem_key=run + "-rec")
        again = rag.put_record("run", run, {"run": run, "state": "admitted"}, idem_key=run + "-rec")
        self.assertEqual(etag, again)
        self.assertEqual(rag.get_record("run", run)[0]["state"], "admitted")
        self.assertEqual(store.outbox_peek(), [])

    def _live(self):
        cfg = load_config(rag="http")
        if not cfg.rag_client_id or not cfg.rag_client_secret:
            self.skipTest("LINE_RAG_CLIENT_ID / LINE_RAG_CLIENT_SECRET not set")
        http = HttpRagAdapter.from_config(cfg)
        http.apply_manifest()
        return http

    def test_live_events_read_back_by_id(self) -> None:
        http = self._live()
        store = FakeStore()
        rag = ResilientRag(http, store, probe_interval_s=0)
        run = "live-" + uuid.uuid4().hex[:8]
        for k in (codes.RUN_ADMITTED, codes.SPEC_FROZEN, codes.DIGEST_DONE):
            emit(store, k, run=run)
        top = 0
        while True:
            page = http.events_after(top, 1000)
            if not page:
                break
            top = page[-1]["seq"]
        self.assertEqual(rag.sync_events(), 3)
        mine = [e for e in http.events_after(top, 1000) if e.get("run_id") == run]
        self.assertEqual([e["body"]["line_seq"] for e in mine], [1, 2, 3])
        self.assertEqual([e["kind"] for e in mine], [codes.RUN_ADMITTED, codes.SPEC_FROZEN, codes.DIGEST_DONE])
        # a second Store with the same run name and seqs is not taken for a duplicate
        other = FakeStore()
        emit(other, codes.RUN_ADMITTED, run=run, note="second store")
        self.assertEqual(ResilientRag(http, other, probe_interval_s=0).sync_events(), 1)
        again = [e for e in http.events_after(top, 1000) if e.get("run_id") == run]
        self.assertEqual(len(again), 4)

    def test_live_records_if_match(self) -> None:
        http = self._live()
        rid = "live-" + uuid.uuid4().hex[:8]
        self.assertIsNone(http.get_record("unit", rid))
        e1 = http.put_record("unit", rid, {"run": rid, "state": "ready"})
        e2 = http.put_record("unit", rid, {"run": rid, "state": "leased"}, if_match=e1)
        self.assertNotEqual(e1, e2)
        with self.assertRaises(LineError) as cm:
            http.put_record("unit", rid, {"run": rid, "state": "stale"}, if_match=e1)
        self.assertEqual(cm.exception.code, codes.VERSION_CONFLICT)
        with self.assertRaises(LineError) as cm:
            http.put_record("unit", rid, {"run": rid, "state": "dup"})
        self.assertEqual(cm.exception.code, codes.PRECONDITION_REQUIRED)
        body, etag = http.get_record("unit", rid)
        self.assertEqual((body["state"], etag), ("leased", e2))

    def test_live_leases_fencing(self) -> None:
        http = self._live()
        name = "unit:live-%s:U1" % uuid.uuid4().hex[:8]
        a = http.lease_acquire(name, 30, "builder-a")
        self.assertIsNotNone(a)
        self.assertIsNone(http.lease_acquire(name, 30, "builder-b"))
        a2 = http.lease_renew(a, 30)
        self.assertEqual(a2.epoch, a.epoch)
        etag = http.put_record("unit", name.replace(":", "_"), {"run": "x", "state": "leased"}, lease=a2)
        self.assertTrue(etag)
        http.lease_release(a2)
        b = http.lease_acquire(name, 30, "builder-b")
        self.assertIsNotNone(b)
        # the zombie (old owner) is fenced even if the remote kept the epoch for this one client identity
        for op in (lambda: http.lease_renew(a2, 30),
                   lambda: http.put_record("unit", name.replace(":", "_"), {"run": "x", "state": "zombie"},
                                           if_match=etag, lease=a2)):
            with self.assertRaises(LineError) as cm:
                op()
            self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        http.lease_release(a2)                               # a no-op: never frees b's lease
        self.assertIsNone(http.lease_acquire(name, 30, "builder-c"))
        http.lease_release(b)

    def test_live_pack_quote_retrieve_metric(self) -> None:
        http = self._live()
        tag = uuid.uuid4().hex[:8]
        files = {"spec/a.md": "# A %s\nThe tool exits with code 2 on a bad flag.\n" % tag,
                 "spec/b.md": "# B\nEvery task has a title.\n"}
        ver = http.freeze_pack(files, idem_key="live-pack-" + tag)
        self.assertTrue(ver)
        self.assertEqual(http.freeze_pack(files, idem_key="live-pack-" + tag), ver)
        fresh = HttpRagAdapter.from_config(load_config(rag="http"))     # no cached files: reads the pack back
        sp = fresh.quote("spec/a.md", "exits with code 2", ver)
        self.assertIsNotNone(sp)
        self.assertEqual((sp.path, sp.start, sp.end), ("spec/a.md", 2, 2))
        self.assertIsNone(fresh.quote("spec/a.md", "text that is not in the pack", ver))
        hits = http.retrieve("builder", "build", ["python"], 2000)
        self.assertIsInstance(hits, list)
        http.metric("unit_attempts", 2, {"run": "live-" + tag, "unit": "U1"})


if __name__ == "__main__":
    unittest.main()
