"""HttpRagAdapter against an in-process stub of the RAG System's /v1 API.

StubRag (also used by test_rag_resilient) implements just enough of the wire contract described in
line/rag/http_adapter.py: client-credential tokens, capabilities, events with gapless seq, leases with
fencing epochs, records with ETag / If-Match / 428, packs + quotes, keyed retrieval, metrics, and
Idempotency-Key replay. Knobs: .down (503 everywhere), .missing (remote capability names whose routes
are absent), .expire_all() (every issued token now answers 401 expired), .holder_is_caller (the lease
holder is the calling identity, not the body's owner; the epoch moves only when the holder changes).
Event ids must be 1-64 of [A-Za-z0-9_-] (else 422 validation_failed with per-event errors).
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple

from line import codes
from line.codes import LineError
from line.contracts import Lease
from line.rag.http_adapter import DEFAULT_HEADERS, HttpRagAdapter

NS = "testns"
CLIENT_ID, CLIENT_SECRET = "line-client", "s3cret-for-tests"
ALL_REMOTE = ["events", "coord", "records", "packs", "retrieval", "metrics", "registry"]
EVENT_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
ROUTE_CAP = {"events": "events", "leases": "coord", "records": "records", "packs": "packs",
             "context": "retrieval", "metrics": "metrics", "manifest": "registry"}


class StubState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.down = False
        self.missing: set = set()
        self.expires_in = 900
        self.tokens: set = set()
        self.token_issued = 0
        self.reject_all_tokens = False
        self.holder_is_caller = False
        self.idem: Dict[str, Tuple[str, int, Any, Dict[str, str]]] = {}
        self.log: List[Dict[str, Any]] = []      # every namespace request: method, path, idem, replay
        self.events: List[Dict[str, Any]] = []
        self.event_ids: Dict[str, int] = {}
        self.records: Dict[Tuple[str, str], Tuple[Dict[str, Any], int]] = {}
        self.leases: Dict[str, Dict[str, Any]] = {}
        self.packs: Dict[str, Dict[str, Dict[str, str]]] = {}
        self.metrics: List[Dict[str, Any]] = []
        self.manifest: Optional[Dict[str, Any]] = None
        self.manifest_rev = 0

    def expire_all(self) -> None:
        with self.lock:
            self.tokens.clear()

    def writes(self, prefix: str = "") -> List[Dict[str, Any]]:
        return [x for x in self.log if x["method"] in ("POST", "PUT", "PATCH") and x["path"].startswith(prefix)]


class _Handler(BaseHTTPRequestHandler):
    state: StubState = None  # type: ignore[assignment]

    def log_message(self, *a: Any) -> None:  # silence
        pass

    def _send(self, status: int, body: Any = None, headers: Optional[Dict[str, str]] = None) -> None:
        data = b"" if body is None else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_PUT(self) -> None:
        self._handle("PUT")

    def _handle(self, method: str) -> None:
        st = self.state
        u = urllib.parse.urlsplit(self.path)
        path, q = urllib.parse.unquote(u.path), dict(urllib.parse.parse_qsl(u.query))
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        body = json.loads(raw) if raw else None
        if st.down:
            return self._send(503, {"error": "unavailable"})
        if path == "/v1/token":
            if (body or {}).get("client_secret") != CLIENT_SECRET:
                return self._send(401, {"error": "invalid_client"})
            with st.lock:
                st.token_issued += 1
                tok = "tok-%d" % st.token_issued
                st.tokens.add(tok)
            return self._send(200, {"access_token": tok, "expires_in": st.expires_in})
        auth = self.headers.get("Authorization", "")
        if st.reject_all_tokens or auth[7:] not in st.tokens:
            return self._send(401, {"error": "token_expired", "detail": "token expired"})
        if path == "/v1/capabilities":
            caps = [{"name": c, "version": "1.0.0", "status": "beta"} for c in ALL_REMOTE if c not in st.missing]
            return self._send(200, {"server_version": "stub-1", "api_versions": ["v1"], "capabilities": caps})
        prefix = "/v1/%s/" % NS
        if not path.startswith(prefix):
            return self._send(404, None)
        rest = path[len(prefix):]
        head = rest.split("/", 1)[0]
        if ROUTE_CAP.get(head) in st.missing:
            return self._send(404, None)                      # route absent: capability not offered
        key = self.headers.get("Idempotency-Key")
        entry = {"method": method, "path": "/" + rest, "idem": key, "replay": False}
        st.log.append(entry)
        if method in ("POST", "PUT", "PATCH") and key:
            h = hashlib.sha256(raw + ("%s %s" % (method, path)).encode()).hexdigest()
            with st.lock:
                prev = st.idem.get(key)
                if prev is not None:
                    if prev[0] != h:
                        return self._send(422, {"error": "idempotency_mismatch"})
                    entry["replay"] = True
                    return self._send(prev[1], prev[2], dict(prev[3], **{"Idempotent-Replay": "true"}))
                status, out, hdrs = self._route(method, rest, q, body)
                if 200 <= status < 300 or status in (400, 403, 404, 422):
                    st.idem[key] = (h, status, out, hdrs)
            return self._send(status, out, hdrs)
        with st.lock:
            status, out, hdrs = self._route(method, rest, q, body)
        return self._send(status, out, hdrs)

    # ---------------------------------------------------------------- routes (under state.lock)

    def _fence(self) -> Optional[Tuple[int, Any, Dict[str, str]]]:
        name = self.headers.get(DEFAULT_HEADERS["lease"])
        if not name:
            return None
        epoch = int(self.headers.get(DEFAULT_HEADERS["epoch"]) or 0)
        cur = self.state.leases.get(name)
        if cur is None or cur["epoch"] != epoch or cur["until"] < time.time():
            return 409, {"error": "stale_epoch", "lease": name, "epoch": epoch,
                         "current_epoch": cur["epoch"] if cur else None}, {}
        return None

    def _route(self, method: str, rest: str, q: Dict[str, str], body: Any) -> Tuple[int, Any, Dict[str, str]]:
        st = self.state
        if rest == "manifest":
            if method == "GET":
                if st.manifest is None:
                    return 404, {"error": "not_found"}, {}
                return 200, {"manifest": st.manifest}, {"ETag": '"%d"' % st.manifest_rev}
            changed = body != st.manifest
            if changed:
                st.manifest, st.manifest_rev = body, st.manifest_rev + 1
            return 200, {"manifest_rev": st.manifest_rev, "changed": changed}, {}
        if rest == "events" and method == "POST":
            evs = body.get("events") if isinstance(body, dict) and "events" in body else [body]
            bad = [{"index": i, "errors": [{"pointer": "/id", "message": "id must be 1-64 of [A-Za-z0-9_-]"}]}
                   for i, ev in enumerate(evs) if "id" in ev and not EVENT_ID_RE.match(str(ev["id"]))]
            if bad:
                return 422, {"error": "validation_failed", "detail": "no event stored", "accepted": [],
                             "rejected": bad}, {}
            acc = []
            for ev in evs:
                eid = ev.get("id") or "gen-%d" % (len(st.events) + 1)
                if eid in st.event_ids:
                    acc.append({"id": eid, "seq": st.event_ids[eid], "duplicate": True})
                    continue
                seq = len(st.events) + 1
                st.events.append(dict(ev, id=eid, seq=seq))
                st.event_ids[eid] = seq
                acc.append({"id": eid, "seq": seq})
            return 200, {"accepted": acc, "rejected": []}, {}
        if rest == "events" and method == "GET":
            after, limit = int(q.get("after_seq", 0)), int(q.get("limit", 1000))
            evs = [e for e in st.events if e["seq"] > after][:limit]
            return 200, {"events": evs, "next_after_seq": evs[-1]["seq"] if evs else after}, {}
        if rest.startswith("leases/"):
            name, _, verb = rest[len("leases/"):].rpartition(":")
            cur = st.leases.get(name)
            now = time.time()
            if verb == "acquire":
                owner = "client" if st.holder_is_caller else (body or {}).get("owner", "")
                if cur and cur["until"] >= now and cur["holder"] != owner:
                    return 409, {"error": "lease_held", "holder": cur["holder"], "until_ms": int(cur["until"] * 1000)}, {}
                if st.holder_is_caller:          # the epoch moves only when another identity takes the lease
                    epoch = (cur["epoch"] if cur else 0) + (0 if cur and cur["holder"] == owner else 1)
                else:
                    epoch = (cur["epoch"] if cur else 0) + (0 if cur and cur["holder"] == owner and cur["until"] >= now else 1)
                st.leases[name] = {"epoch": epoch, "holder": owner, "until": now + body.get("ttl_s", 30)}
                return 200, {"name": name, "epoch": epoch, "until_ms": int(st.leases[name]["until"] * 1000)}, {}
            ep = (body or {}).get("epoch")
            if verb == "renew":
                if not cur or cur["epoch"] != ep or cur["until"] < now:
                    return 409, {"error": "lease_lost", "lease": name, "epoch": ep,
                                 "current_epoch": cur["epoch"] if cur else None}, {}
                cur["until"] = now + body.get("ttl_s", 30)
                return 200, {"name": name, "epoch": ep, "until_ms": int(cur["until"] * 1000)}, {}
            if verb == "release":
                released = bool(cur and cur["epoch"] == ep)
                if released:
                    cur["until"] = 0
                return 200, {"name": name, "released": released}, {}
        if rest.startswith("records/"):
            rtype, rid = rest[len("records/"):].split("/", 1)
            cur = st.records.get((rtype, rid))
            if method == "GET":
                if cur is None:
                    return 404, {"error": "not_found"}, {}
                return 200, {"type": rtype, "id": rid, "rev": cur[1], "body": cur[0]}, {"ETag": '"%d"' % cur[1]}
            inm, im = self.headers.get("If-None-Match"), self.headers.get("If-Match")
            if inm == "*":
                if cur is not None:
                    return 409, {"error": "duplicate"}, {}
            elif im is not None:
                if cur is None or im != '"%d"' % cur[1]:
                    return 412, {"error": "precondition_failed", "current": {"rev": cur[1] if cur else 0}}, \
                        ({"ETag": '"%d"' % cur[1]} if cur else {})
            else:
                return 428, {"error": "if_match_required"}, {}
            fenced = self._fence()
            if fenced:
                return fenced
            rev = (cur[1] if cur else 0) + 1
            st.records[(rtype, rid)] = (body, rev)
            return (201 if rev == 1 else 200), {"rev": rev, "body": body}, {"ETag": '"%d"' % rev}
        if rest.startswith("packs/"):
            parts = rest.split("/")
            pack = parts[1]
            if len(parts) == 3 and parts[2] == "versions":
                vers = st.packs.setdefault(pack, {})
                ver = "v%d.0" % (len(vers) + 1)
                vers[ver] = {p["path"]: p["text"] for p in body["parts"]}
                return 201, {"version": ver, "state": "frozen" if body.get("freeze") else "draft",
                             "sha256": "0" * 64}, {}
            if len(parts) == 3 and parts[2] == "quotes":
                vers = st.packs.get(pack, {})
                ver = body.get("version") or (sorted(vers)[-1] if vers else "")
                text = vers.get(ver, {}).get(body["path"], "")
                off = text.find(body["text"]) if body.get("text") else -1
                if off < 0:
                    return 422, {"error": "quote_not_found"}, {}
                return 201, {"quote_id": "%s#1#%d" % (body["path"], off), "version": ver}, {}
            if len(parts) == 2 and method == "GET":
                ver = q.get("version")
                files = st.packs.get(pack, {}).get(ver)
                if files is None:
                    return 404, {"error": "not_found"}, {}
                return 200, {"version": ver, "parts": [{"path": p, "page": 1, "text": t} for p, t in files.items()]}, {}
        if rest == "context/step":
            st.last_step = dict(body)
            key = body.get("key") or {}
            text = "lesson for %s/%s: keep units small." % (key.get("role"), key.get("step"))
            return 200, {"pack_text": text[:body.get("budget_chars", 6000)], "served": [{"tier": "key", "id": "i-1"}],
                         "serve_id": "srv-1"}, {}
        if rest == "metrics" and method == "POST":
            st.metrics.extend(body.get("observations") or [])
            return 200, {"accepted": len(body.get("observations") or [])}, {}
        return 404, {"error": "not_found"}, {}


class StubServer:
    """Runs StubState behind a ThreadingHTTPServer on 127.0.0.1. stop()/start() keep state and port."""

    def __init__(self, state: Optional[StubState] = None, port: int = 0):
        self.state = state or StubState()
        self.port = port
        self.httpd: Optional[ThreadingHTTPServer] = None
        self.start()

    def start(self) -> None:
        handler = type("H", (_Handler,), {"state": self.state})
        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port), handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def stop(self) -> None:
        if self.httpd is not None:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None

    @property
    def url(self) -> str:
        return "http://127.0.0.1:%d" % self.port


def make_adapter(srv: StubServer, now: Any = None, **kw: Any) -> HttpRagAdapter:
    return HttpRagAdapter(srv.url, NS, CLIENT_ID, CLIENT_SECRET, timeout_s=5, now=now, sleep=lambda s: None, **kw)


class Clock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


class HttpAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.srv = StubServer()
        self.st = self.srv.state
        self.clock = Clock()
        self.rag = make_adapter(self.srv, now=self.clock)

    def tearDown(self) -> None:
        self.srv.stop()

    def test_capabilities_maps_remote_names(self) -> None:
        self.st.missing = {"retrieval"}
        caps = self.rag.capabilities()
        self.assertTrue(caps.events and caps.leases and caps.records and caps.packs and caps.quote and caps.metrics)
        self.assertFalse(caps.retrieve)
        self.assertEqual(caps.version, "stub-1")

    def test_token_refreshed_90s_before_expiry(self) -> None:
        self.rag.capabilities()
        self.assertEqual(self.st.token_issued, 1)
        self.clock.t += 900 - 90 - 10            # 100 s left: still good
        self.rag.capabilities()
        self.assertEqual(self.st.token_issued, 1)
        self.clock.t += 11                       # 89 s left: refresh before use
        self.rag.capabilities()
        self.assertEqual(self.st.token_issued, 2)

    def test_401_expired_retried_once_with_fresh_token(self) -> None:
        self.rag.capabilities()
        self.st.expire_all()                     # server-side expiry the client did not foresee
        caps = self.rag.capabilities()
        self.assertTrue(caps.events)
        self.assertEqual(self.st.token_issued, 2)

    def test_401_twice_is_degraded_after_one_retry(self) -> None:
        self.rag.capabilities()
        self.st.reject_all_tokens = True
        n0 = self.st.token_issued
        with self.assertRaises(LineError) as cm:
            self.rag.capabilities()
        self.assertEqual(cm.exception.code, codes.RAG_DEGRADED)
        self.assertEqual(self.st.token_issued, n0 + 1)   # exactly one refresh

    def test_every_write_carries_idempotency_key(self) -> None:
        self.rag.append_events([{"seq": 1, "kind": codes.RUN_ADMITTED, "env": {"run": "r1"}, "body": {}}], "k-ev")
        self.rag.put_record("run", "r1", {"run": "r1"})
        self.rag.metric("run_usd", 0.5, {"run": "r1"})
        lease = self.rag.lease_acquire("unit:U1", 60, "builder-1")
        self.rag.lease_renew(lease, 60)
        self.rag.lease_release(lease)
        self.rag.freeze_pack({"spec.md": "# T\nline\n"}, idem_key="pk")
        writes = self.st.writes()
        self.assertGreaterEqual(len(writes), 7)
        self.assertTrue(all(w["idem"] for w in writes), writes)
        self.assertEqual(writes[0]["idem"], "k-ev")

    def test_idempotent_replay_returns_same_result(self) -> None:
        batch = [{"seq": 1, "kind": codes.RUN_ADMITTED, "env": {"run": "r1"}, "body": {}},
                 {"seq": 2, "kind": codes.SPEC_FROZEN, "env": {"run": "r1"}, "body": {}}]
        a = self.rag.append_events(batch, "ev-1-2")
        b = self.rag.append_events(batch, "ev-1-2")
        self.assertEqual((a["accepted"], a["last_seq"]), (b["accepted"], b["last_seq"]))
        self.assertTrue(b["replay"])
        self.assertEqual(len(self.st.events), 2)
        e1 = self.rag.put_record("unit", "U1", {"state": "ready"}, idem_key="rec-1")
        e2 = self.rag.put_record("unit", "U1", {"state": "ready"}, idem_key="rec-1")
        self.assertEqual(e1, e2)
        self.assertEqual(self.st.records[("unit", "U1")][1], 1)
        self.assertEqual([w["replay"] for w in self.st.writes("/records/")], [False, True])

    def test_events_round_trip_with_envelope(self) -> None:
        ev = {"seq": 7, "kind": codes.UNIT_MERGED, "ts_ms": 5,
              "env": {"run": "r1", "unit": "U2", "attempt": 2, "epoch": 3, "agent_version": "line-0.1",
                      "model": "m", "spec_hash": "h"}, "body": {"sha": "abc"}}
        self.rag.append_events([ev], "k1")
        got = self.rag.events_after(0)
        self.assertEqual(len(got), 1)
        g = got[0]
        self.assertEqual((g["run_id"], g["unit_id"], g["attempt"], g["epoch"]), ("r1", "U2", 2, 3))
        self.assertEqual(g["body"]["spec_hash"], "h")
        self.assertEqual(g["body"]["line_seq"], 7)
        self.assertEqual(self.rag.events_after(1), [])

    def test_if_match_and_412_version_conflict(self) -> None:
        e1 = self.rag.put_record("graph", "r1", {"units": []})
        self.assertEqual(e1, '"1"')
        e2 = self.rag.put_record("graph", "r1", {"units": ["U1"]}, if_match=e1)
        self.assertEqual(e2, '"2"')
        with self.assertRaises(LineError) as cm:
            self.rag.put_record("graph", "r1", {"units": ["U9"]}, if_match=e1)
        self.assertEqual(cm.exception.code, codes.VERSION_CONFLICT)
        self.assertEqual(cm.exception.detail.get("etag"), '"2"')
        body, etag = self.rag.get_record("graph", "r1")
        self.assertEqual((body, etag), ({"units": ["U1"]}, '"2"'))
        self.assertIsNone(self.rag.get_record("graph", "nope"))

    def test_create_over_existing_needs_if_match(self) -> None:
        self.rag.put_record("run", "r1", {"state": "admitted"})
        with self.assertRaises(LineError) as cm:
            self.rag.put_record("run", "r1", {"state": "planning"})
        self.assertEqual(cm.exception.code, codes.PRECONDITION_REQUIRED)

    def test_428_precondition_required(self) -> None:
        with self.assertRaises(LineError) as cm:
            self.rag.call("PUT", "/records/run/r2", {"x": 1}, cap="records")   # no If-Match / If-None-Match
        self.assertEqual(cm.exception.code, codes.PRECONDITION_REQUIRED)
        self.assertEqual(cm.exception.detail["status"], 428)

    def test_409_stale_epoch_is_lease_lost(self) -> None:
        lease = self.rag.lease_acquire("unit:U1", 60, "builder-1")
        self.assertEqual(lease.epoch, 1)
        self.assertIsNone(self.rag.lease_acquire("unit:U1", 60, "builder-2"))   # held
        self.rag.put_record("unit", "U1", {"state": "leased"}, lease=lease)
        # the lease expires and another builder takes it at epoch 2
        self.st.leases["unit:U1"] = {"epoch": 2, "holder": "builder-2", "until": time.time() + 60}
        with self.assertRaises(LineError) as cm:
            self.rag.put_record("unit", "U1", {"state": "zombie"}, if_match='"1"', lease=lease)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.assertEqual(cm.exception.detail.get("current_epoch"), 2)
        with self.assertRaises(LineError) as cm:
            self.rag.lease_renew(lease, 60)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.rag.lease_release(lease)            # releasing a lost lease is a no-op

    def test_event_ids_are_wire_safe_deterministic_and_store_unique(self) -> None:
        from line.rag.http_adapter import wire_event_id
        ev = {"seq": 12, "kind": codes.RUN_ADMITTED, "ts_ms": 1000,
              "env": {"run": "R2026.10:11/" + "x" * 80, "agent_version": "line-0.1"}, "body": {"a": 1}}
        wid = wire_event_id(ev)
        self.assertRegex(wid, r"^[A-Za-z0-9_\-]{1,64}$")
        self.assertEqual(wid, wire_event_id(dict(ev)))                      # replay: same id
        self.assertNotEqual(wid, wire_event_id(dict(ev, ts_ms=1001)))       # another Store, same run and seq
        sys_ev = {"seq": 3, "kind": codes.RAG_DEGRADED_KIND, "env": {"run": "_line"}, "body": {"capability": "events"}}
        self.rag.append_events([ev, sys_ev], "k-ids")                       # the stub refuses unsafe ids
        self.assertEqual([e["id"] for e in self.st.events], [wid, wire_event_id(sys_ev)])

    def test_validation_errors_are_named_in_the_line_error(self) -> None:
        with self.assertRaises(LineError) as cm:
            self.rag.call("POST", "/events", {"events": [{"id": "ns.r1.1", "kind": codes.RUN_ADMITTED}]}, cap="events")
        e = cm.exception
        self.assertEqual(e.code, codes.SCHEMA_INVALID)
        self.assertIn("/id", e.message)
        self.assertEqual(e.detail["errors"][0], {"index": 0, "pointer": "/id",
                                                 "message": "id must be 1-64 of [A-Za-z0-9_-]"})

    def test_one_client_identity_leases_are_separated_by_owner(self) -> None:
        self.st.holder_is_caller = True          # remote holder = the calling identity, shared by every owner
        a = self.rag.lease_acquire("unit:R1:U1", 60, "builder-a")
        self.assertEqual(a.epoch, 1)
        self.assertIsNone(self.rag.lease_acquire("unit:R1:U1", 60, "builder-b"))   # remote alone would say yes
        etag = self.rag.put_record("unit", "U1", {"state": "leased"}, lease=a)
        self.rag.lease_release(a)
        b = self.rag.lease_acquire("unit:R1:U1", 60, "builder-b")
        self.assertEqual(b.epoch, a.epoch)       # the remote kept the epoch: same identity
        n = len(self.st.log)
        with self.assertRaises(LineError) as cm:
            self.rag.lease_renew(a, 60)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        with self.assertRaises(LineError) as cm:
            self.rag.put_record("unit", "U1", {"state": "zombie"}, if_match=etag, lease=a)
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.rag.lease_release(a)                # stale owner: no-op, b keeps the lease
        self.assertEqual(len(self.st.log), n)    # none of the zombie's calls reached the remote
        self.assertIsNone(self.rag.lease_acquire("unit:R1:U1", 60, "builder-c"))
        self.assertEqual(self.rag.lease_renew(b, 60).owner, "builder-b")
        self.rag.lease_release(b)
        self.assertIsNotNone(self.rag.lease_acquire("unit:R1:U1", 60, "builder-c"))

    def test_quote_returns_line_span(self) -> None:
        ver = self.rag.freeze_pack({"spec.md": "# Todo\nF1 add\nUnknown id exits 1.\n"})
        self.assertEqual(ver, "v1.0")
        sp = self.rag.quote("spec.md", "Unknown id exits 1.", ver)
        self.assertEqual((sp.start, sp.end, sp.id), (3, 3, "spec.md#L3-3"))
        self.assertIsNone(self.rag.quote("spec.md", "not in the spec", ver))
        fresh = make_adapter(self.srv)           # no local cache: reads the parts from the server
        self.assertEqual(fresh.quote("spec.md", "F1 add", ver).id, "spec.md#L2-2")

    def test_retrieve_and_metric(self) -> None:
        out = self.rag.retrieve("builder", "build", ["python"], 20)
        self.assertEqual(len(out), 1)
        self.assertLessEqual(len(out[0]["text"]), 20)
        self.rag.metric("unit_usd", 0.25, {"run": "r1", "unit": "U1"})
        self.assertEqual(self.st.metrics[0]["series"], "unit_usd")
        self.assertEqual(self.st.metrics[0]["unit_id"], "U1")

    def test_retrieve_sends_query_only_when_given(self) -> None:
        self.rag.retrieve("fixer", "build", ["python"], 500)
        self.assertNotIn("query", self.st.last_step)
        self.rag.retrieve("fixer", "build", ["python"], 500, query="  ImportError after moving a module  ")
        self.assertEqual(self.st.last_step["query"], "ImportError after moving a module")
        self.assertEqual(self.st.last_step["key"], {"role": "fixer", "step": "build", "stack": "python"})
        self.rag.retrieve("fixer", "build", ["python"], 500, query="x" * 5000)
        self.assertEqual(len(self.st.last_step["query"]), 4000)

    def test_manifest_people_lanes_follow_the_wire_config(self) -> None:
        from line.rag import manifest
        self.assertFalse(manifest.build({})["settings"]["include_people_lanes"])
        self.assertTrue(manifest.build({"include_people_lanes": True})["settings"]["include_people_lanes"])
        self.assertNotIn("retrieval", manifest.build({})["settings"])
        self.assertEqual(manifest.build({"include_people_lanes": True})["settings"]["retrieval"], {"cross_share": 1.0})
        self.assertEqual(manifest.build({"include_people_lanes": True, "people_share": 0.5})["settings"]["retrieval"],
                         {"cross_share": 0.5})

    def test_missing_route_and_5xx_are_degraded(self) -> None:
        self.st.missing = {"retrieval"}
        with self.assertRaises(LineError) as cm:
            self.rag.retrieve("builder", "build", [], 100)
        self.assertEqual(cm.exception.code, codes.RAG_DEGRADED)
        self.assertTrue(cm.exception.detail.get("missing"))
        self.st.down = True
        with self.assertRaises(LineError) as cm:
            self.rag.events_after(0)
        self.assertEqual(cm.exception.code, codes.RAG_DEGRADED)

    def test_connection_refused_is_degraded(self) -> None:
        self.srv.stop()
        with self.assertRaises(LineError) as cm:
            self.rag.capabilities()
        self.assertEqual(cm.exception.code, codes.RAG_DEGRADED)

    def test_apply_manifest_idempotent(self) -> None:
        r1 = self.rag.apply_manifest()
        r2 = self.rag.apply_manifest()
        self.assertTrue(r1["changed"])
        self.assertFalse(r2["changed"])
        kinds = {t["type"] for t in self.st.manifest["types"] if t["kind_of"] == "event"}
        self.assertEqual(kinds, set(codes.EVENT_KINDS))


if __name__ == "__main__":
    unittest.main()
