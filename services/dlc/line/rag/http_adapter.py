"""RagPort over the RAG System's /v1 HTTP API (stdlib urllib only).

Wire contract (paths relative to the base URL; {ns} = config.rag_ns):
  POST /v1/token                                 client credentials -> {access_token, expires_in}
  GET  /v1/capabilities                          {capabilities:[{name, version, status}]}
  GET/PUT /v1/{ns}/manifest                      the line's manifest (rag.manifest), If-Match
  POST /v1/{ns}/events                           {"events":[...]} -> {accepted:[{id, seq}], rejected}
                                                 event id: 1-64 of [A-Za-z0-9_-] (wire_event_id); a repeated id
                                                 is a duplicate, so ids must be unique across Stores
  GET  /v1/{ns}/events?after_seq=&limit=         {events:[...], next_after_seq}
  POST /v1/{ns}/leases/{name}:acquire|:renew|:release   {ttl_s, epoch} -> {epoch, until_ms}; 409 lease_held|lease_lost
                                                 (the holder may be the calling identity: see the leases section)
  PUT/GET /v1/{ns}/records/{type}/{id}           If-None-Match: * (create) | If-Match: <etag> (update); ETag
  POST /v1/{ns}/packs/{pack}/versions            {project, parts:[{path, page, text}], freeze: true} -> {version}
  POST /v1/{ns}/packs/{pack}/quotes              {version?, path, text} -> {quote_id, ...}
  GET  /v1/{ns}/packs/{pack}?version=&text=true  parts with text (to turn a quote into line numbers)
  POST /v1/{ns}/context/step                     {project, keyspace, key{role, step, stack}, query?, budget_chars}
  POST /v1/{ns}/metrics                          {observations:[{series, value, dims, ts_ms}]}

Behaviour
  * token: fetched with LINE_RAG_CLIENT_ID / LINE_RAG_CLIENT_SECRET, refreshed 90 s before it expires;
    a 401 that says the token expired is retried once with a fresh token.
  * every POST / PUT / PATCH carries an Idempotency-Key (the caller's key, else a new uuid).
  * records use ETag / If-Match.
  * errors -> LineError: transport / 5xx / 423 / 429 / auth -> RAG_DEGRADED; 404 without a JSON error
    (route absent) -> RAG_DEGRADED; 409 stale_epoch | lease_lost -> LEASE_LOST; 409 write_conflict and
    412 -> VERSION_CONFLICT; 409 duplicate and 428 -> PRECONDITION_REQUIRED; 400/413/422 -> SCHEMA_INVALID.
    Validation errors of the body ("errors" / "rejected"[].errors: pointer + message) are named in the
    LineError message and kept in detail["errors"].
  * event batches: Idempotency-Key ev-<first seq>-<last seq>-<digest of the batch's event ids> (two Stores
    both start at seq 1; a bare seq range would replay the other Store's answer).

Deployment-specific wire details come from config.rag_extra (local RAG wire config, LINE_RAG_LOCAL), generic keys:
  header_run, header_unit, header_attempt, header_lease, header_epoch   envelope / fencing header names
  project, pack_id, keyspace, token_path, capabilities_path, capability_map {line cap: remote name},
  redaction_packs, idempotency_hours, include_people_lanes (manifest)
"""

from __future__ import annotations

import hashlib
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import Lease, RagCapabilities, Span
from . import manifest as line_manifest
from .local_adapter import find_span

TOKEN_REFRESH_MARGIN_S = 90
QUERY_MAX = 4000            # the RAG System's limit for context/step query text

DEFAULT_CAPABILITY_MAP: Dict[str, str] = {
    "events": "events", "leases": "coord", "records": "records", "packs": "packs",
    "quote": "packs", "retrieve": "retrieval", "metrics": "metrics",
}

DEFAULT_HEADERS: Dict[str, str] = {
    "run": "X-Line-Run", "unit": "X-Line-Unit", "attempt": "X-Line-Attempt",
    "lease": "X-Line-Lease", "epoch": "X-Line-Epoch",
}

#: method -> capability (for error detail and the resilient layer)
OP_CAPABILITY: Dict[str, str] = {
    "append_events": "events", "events_after": "events",
    "lease_acquire": "leases", "lease_renew": "leases", "lease_release": "leases",
    "put_record": "records", "get_record": "records",
    "freeze_pack": "packs", "quote": "quote", "retrieve": "retrieve", "metric": "metrics",
}


class Resp:
    __slots__ = ("status", "headers", "body", "text")

    def __init__(self, status: int, headers: Mapping[str, str], text: str):
        self.status = status
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.text = text
        try:
            self.body = json.loads(text) if text else None
        except ValueError:
            self.body = None

    @property
    def j(self) -> Dict[str, Any]:
        return self.body if isinstance(self.body, dict) else {}

    @property
    def error(self) -> str:
        e = self.j.get("error")
        return e if isinstance(e, str) else ""

    def header(self, name: str) -> Optional[str]:
        return self.headers.get(name.lower())


def _redact(text: str) -> str:
    return (text or "")[:300]


_ID_UNSAFE = re.compile(r"[^A-Za-z0-9_-]")
EVENT_ID_MAX = 64


def wire_event_id(ev: Mapping[str, Any]) -> str:
    """Deterministic remote id of a line event: <run>-<seq>-<digest>, only [A-Za-z0-9_-], <= 64 chars.

    The digest covers the whole event (kind, envelope, seq, ts_ms, body), so two Stores whose events share
    a run name and seq (the "_line" system run, a re-created database) still get different ids, while a
    replay of the same event always gets the same id (the remote deduplicates by id)."""
    env = dict(ev.get("env") or {})
    canon = json.dumps({"kind": ev.get("kind"), "env": env, "seq": ev.get("seq"), "ts_ms": ev.get("ts_ms"),
                        "body": ev.get("body")}, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha256(canon.encode("utf-8")).hexdigest()[:16]
    run = _ID_UNSAFE.sub("_", str(env.get("run") or "_"))[:24]
    return ("%s-%d-%s" % (run, int(ev.get("seq") or 0), digest))[:EVENT_ID_MAX]


def _error_points(j: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """[{pointer, message, index?}] from an error body: top-level "errors" and per-item "rejected"[].errors."""
    out: List[Dict[str, Any]] = []
    for e in j.get("errors") or []:
        if isinstance(e, Mapping):
            out.append({"pointer": str(e.get("pointer", "")), "message": _redact(str(e.get("message", "")))})
    for rej in j.get("rejected") or []:
        if isinstance(rej, Mapping):
            for e in rej.get("errors") or []:
                if isinstance(e, Mapping):
                    out.append({"index": rej.get("index"), "pointer": str(e.get("pointer", "")),
                                "message": _redact(str(e.get("message", "")))})
    return out[:10]


def batch_key(wire_ids: Sequence[str], first: int, last: int) -> str:
    """Idempotency key of an event batch: seq range plus a digest of the batch's event ids (unique per Store)."""
    h = hashlib.sha256("|".join(wire_ids).encode("utf-8")).hexdigest()[:16]
    return "ev-%d-%d-%s" % (first, last, h)


class HttpRagAdapter:
    """RagPort over HTTP. Thread-safe enough for the line (token refresh is serialised)."""

    def __init__(self, base_url: str, ns: str, client_id: str = "", client_secret: str = "",
                 timeout_s: float = 15.0, extra: Optional[Mapping[str, Any]] = None,
                 now: Optional[Callable[[], float]] = None, sleep: Callable[[float], None] = time.sleep):
        self.base = base_url.rstrip("/")
        self.ns = ns
        self._client_id = client_id
        self._client_secret = client_secret
        self.timeout_s = float(timeout_s)
        self.extra = dict(extra or {})
        self._now = now or time.time
        self._sleep = sleep
        self._tok: Optional[str] = None
        self._exp = 0.0
        self._tlock = threading.Lock()
        self.token_fetches = 0
        self.project = str(self.extra.get("project") or ns)
        self.shared_project = str(self.extra.get("shared_project") or "")   # lessons pool read after the project
        self.pack_id = str(self.extra.get("pack_id") or "spec")
        self.keyspace = str(self.extra.get("keyspace") or line_manifest.KEYSPACE)
        self.hdr = dict(DEFAULT_HEADERS)
        for k in DEFAULT_HEADERS:
            v = self.extra.get("header_" + k)
            if v:
                self.hdr[k] = str(v)
        self.cap_map = dict(DEFAULT_CAPABILITY_MAP)
        self.cap_map.update(dict(self.extra.get("capability_map") or {}))
        self._pack_files: Dict[str, Dict[str, str]] = {}   # remote version -> files (for quote line numbers)
        self._held: Dict[str, Tuple[str, int, float]] = {}  # lease name -> (owner, epoch, local expiry s)
        self._llock = threading.RLock()

    @classmethod
    def from_config(cls, cfg: Any, **kw: Any) -> "HttpRagAdapter":
        return cls(cfg.rag_url, cfg.rag_ns, cfg.rag_client_id, cfg.rag_client_secret, cfg.rag_timeout_s,
                   cfg.rag_extra, **kw)

    # ------------------------------------------------------------ transport

    def _raw(self, method: str, url: str, body: Any = None, headers: Optional[Mapping[str, str]] = None) -> Resp:
        data = None if body is None else json.dumps(body, default=str).encode("utf-8")
        h = {"Accept": "application/json"}
        if data is not None:
            h["Content-Type"] = "application/json"
        h.update({k: str(v) for k, v in (headers or {}).items() if v is not None})
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                return Resp(r.status, dict(r.headers.items()), r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            try:
                text = e.read().decode("utf-8", "replace")
            except Exception:  # noqa: BLE001
                text = ""
            return Resp(e.code, dict(e.headers.items()) if e.headers else {}, text)
        except (urllib.error.URLError, ConnectionError, socket.timeout, TimeoutError, OSError) as e:
            return Resp(599, {}, json.dumps({"error": "transport", "detail": repr(e)[:200]}))

    def _fetch_token(self) -> Tuple[str, float]:
        if not self._client_id or not self._client_secret:
            raise LineError(codes.RAG_DEGRADED, "RAG System client id/secret not set (LINE_RAG_CLIENT_ID/SECRET)",
                            {"capability": "auth"})
        path = str(self.extra.get("token_path") or "/v1/token")
        r = self._raw("POST", self.base + path, {"grant_type": "client_credentials",
                                                  "client_id": self._client_id,
                                                  "client_secret": self._client_secret})
        if r.status != 200 or not r.j.get("access_token"):
            raise LineError(codes.RAG_DEGRADED, "token request failed: HTTP %d" % r.status,
                            {"capability": "auth", "status": r.status, "error": r.error})
        self.token_fetches += 1
        return r.j["access_token"], self._now() + float(r.j.get("expires_in", 900))

    def token(self, force: bool = False) -> str:
        with self._tlock:
            if force or self._tok is None or self._now() > self._exp - TOKEN_REFRESH_MARGIN_S:
                self._tok, self._exp = self._fetch_token()
            return self._tok

    def url(self, path: str, params: Optional[Mapping[str, Any]] = None) -> str:
        u = self.base + (path if path.startswith("/v1/") else "/v1/%s%s" % (urllib.parse.quote(self.ns), path))
        if params:
            u += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return u

    def call(self, method: str, path: str, body: Any = None, *, headers: Optional[Mapping[str, str]] = None,
             params: Optional[Mapping[str, Any]] = None, idem_key: str = "", cap: str = "",
             ok: Sequence[int] = (200, 201)) -> Resp:
        """One request. Writes get an Idempotency-Key. Returns the Resp if its status is in ok,
        else raises the mapped LineError (see map_error)."""
        h = dict(headers or {})
        if method in ("POST", "PUT", "PATCH"):
            h["Idempotency-Key"] = idem_key or uuid.uuid4().hex
        url = self.url(path, params)
        r: Optional[Resp] = None
        busy_retry = auth_retry = True
        force = False
        for _ in range(3):
            h["Authorization"] = "Bearer " + self.token(force=force)
            force = False
            r = self._raw(method, url, body, h)
            if r.status == 401 and auth_retry and "expired" in r.text.lower():
                auth_retry, force = False, True               # one retry with a fresh token
                continue
            if r.status == 409 and r.error == "in_progress" and busy_retry:
                busy_retry = False                            # same key still running: wait once
                try:
                    wait = min(float(r.header("Retry-After") or 1), 2.0)
                except ValueError:
                    wait = 1.0
                self._sleep(wait)
                continue
            break
        assert r is not None
        if r.status in ok:
            return r
        raise self.map_error(r, cap=cap, method=method, path=path)

    @staticmethod
    def map_error(r: Resp, cap: str = "", method: str = "", path: str = "") -> LineError:
        st, err = r.status, r.error
        detail = {"status": st, "error": err, "capability": cap, "method": method, "path": path}
        msg = "%s %s -> HTTP %d %s" % (method, path, st, err or _redact(r.text))
        why = _error_points(r.j)
        if why:                                              # validation errors: say which field and why
            detail["errors"] = why
            msg += ": " + "; ".join("%s %s" % (e.get("pointer", ""), e.get("message", "")) for e in why[:3])[:300]
        elif isinstance(r.j.get("detail"), str) and r.j["detail"]:
            msg += ": " + _redact(r.j["detail"])
        if st == 409:
            if err in ("stale_epoch", "lease_lost"):
                d = dict(detail)
                for k in ("lease", "epoch", "current_epoch", "holder"):
                    if k in r.j:
                        d[k] = r.j[k]
                return LineError(codes.LEASE_LOST, msg, d)
            if err in ("write_conflict", "record_final", "pack_immutable"):
                if r.header("ETag"):
                    detail["etag"] = r.header("ETag")
                return LineError(codes.VERSION_CONFLICT, msg, detail)
            if err == "duplicate":
                return LineError(codes.PRECONDITION_REQUIRED, msg, detail)
            if err == "in_progress":
                return LineError(codes.RAG_DEGRADED, msg, detail)
            return LineError(codes.STATE_CONFLICT, msg, detail)
        if st == 412:
            if r.header("ETag"):
                detail["etag"] = r.header("ETag")
            return LineError(codes.VERSION_CONFLICT, msg, detail)
        if st == 428:
            return LineError(codes.PRECONDITION_REQUIRED, msg, detail)
        if st == 404:
            if err and err not in ("ns_not_active", "not_found_route"):
                return LineError(codes.NOT_FOUND, msg, detail)
            detail["missing"] = True                          # route absent: capability not offered
            return LineError(codes.RAG_DEGRADED, msg, detail)
        if st in (400, 413, 422):
            return LineError(codes.SCHEMA_INVALID, msg, detail)
        # 401/403 after retry, 423 suspended, 429 quota, 5xx, 599 transport
        if st == 599:
            detail["transport"] = True
        return LineError(codes.RAG_DEGRADED, msg, detail)

    # ------------------------------------------------------------ discovery / manifest

    def capabilities(self) -> RagCapabilities:
        path = str(self.extra.get("capabilities_path") or "/v1/capabilities")
        r = self.call("GET", path, cap="capabilities")
        remote = {}
        for c in r.j.get("capabilities") or []:
            if isinstance(c, Mapping) and c.get("name") and c.get("status", "stable") != "off":
                remote[str(c["name"])] = c
        on = {name: self.cap_map.get(name, name) in remote for name in RagCapabilities.NAMES}
        version = str(r.j.get("version") or r.j.get("server_version") or
                      next((v for k, v in r.j.items() if k.endswith("_version") and isinstance(v, str)), ""))
        return RagCapabilities(version=version, **on)

    def apply_manifest(self, doc: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        """PUT the line's manifest (idempotent; If-Match with the current ETag when there is one)."""
        doc = dict(doc or line_manifest.build(self.extra))
        cur = self.call("GET", "/manifest", cap="manifest", ok=(200, 404))
        h = {}
        if cur.status == 200 and cur.header("ETag"):
            h["If-Match"] = cur.header("ETag")
        r = self.call("PUT", "/manifest", doc, headers=h, cap="manifest")
        return r.j

    # ------------------------------------------------------------ events

    def _env_headers(self, run: str = "", unit: str = "", attempt: Any = None) -> Dict[str, str]:
        h = {}
        if run:
            h[self.hdr["run"]] = run
        if unit:
            h[self.hdr["unit"]] = unit
        if attempt not in (None, ""):
            h[self.hdr["attempt"]] = str(attempt)
        return h

    def to_wire_event(self, ev: Mapping[str, Any]) -> Dict[str, Any]:
        """to_dict(Event) -> the RAG System's event shape (envelope in columns, the rest in body)."""
        env = dict(ev.get("env") or {})
        body = dict(ev.get("body") or {})
        body.update({"agent_version": env.get("agent_version", ""), "model": env.get("model", ""),
                     "spec_hash": env.get("spec_hash", ""), "line_seq": int(ev.get("seq", 0) or 0)})
        out = {"kind": ev.get("kind"), "project": self.project, "run_id": env.get("run") or None,
               "unit_id": env.get("unit") or None, "attempt": env.get("attempt", 0),
               "epoch": env.get("epoch", 0) or None, "body": body}
        if ev.get("seq"):
            out["id"] = wire_event_id(ev)
        if ev.get("ts_ms"):
            out["ts_ms"] = int(ev["ts_ms"])
        return {k: v for k, v in out.items() if v is not None}

    def append_events(self, batch: Sequence[Mapping[str, Any]], idem_key: str) -> Dict[str, Any]:
        wire = [self.to_wire_event(e) for e in batch]
        r = self.call("POST", "/events", {"events": wire}, idem_key=idem_key, cap="events")
        acc = r.j.get("accepted") or []
        seqs = [int(a.get("seq", 0)) for a in acc if isinstance(a, Mapping)]
        return {"accepted": len(acc) if isinstance(acc, list) else int(acc or 0),
                "last_seq": max(seqs) if seqs else 0,
                "replay": (r.header("Idempotent-Replay") or "").lower() == "true"}

    def events_after(self, seq: int, limit: int = 500) -> List[Dict[str, Any]]:
        r = self.call("GET", "/events", params={"after_seq": int(seq), "limit": int(limit)}, cap="events")
        return [dict(e) for e in r.j.get("events") or []]

    # ------------------------------------------------------------ leases
    #
    # The RAG System may name the lease holder after the calling identity, not after the "owner" sent in the
    # body: every owner of this adapter (one client identity) then looks like the same holder, re-acquiring a
    # held lease succeeds and the epoch does not move. The adapter therefore keeps the owner of every lease it
    # handed out (_held) and separates owners itself: acquire for another owner while it is live -> None
    # (held); renew / release / fenced writes with a lease whose (owner, epoch) no longer holds it ->
    # LEASE_LOST / no-op, without asking the remote. The epoch number itself may then repeat between two
    # owners of one identity, so fence on the Lease (owner and epoch), not on the epoch alone. Between
    # identities (processes with their own client) the remote decides as before.

    def _lease_path(self, name: str, verb: str) -> str:
        return "/leases/%s:%s" % (urllib.parse.quote(name, safe="/:"), verb)

    def _check_owner(self, lease: Lease, op: str) -> None:
        cur = self._held.get(lease.name)
        if cur is not None and (cur[0] != lease.owner or cur[1] != lease.epoch):
            raise LineError(codes.LEASE_LOST, "%s: lease %s is now held by %s at epoch %d" % (
                op, lease.name, cur[0], cur[1]), {"lease": lease.name, "epoch": lease.epoch,
                                                  "current_epoch": cur[1], "holder": cur[0], "local": True})

    def lease_acquire(self, name: str, ttl_s: int, owner: str) -> Optional[Lease]:
        with self._llock:
            cur = self._held.get(name)
            if cur is not None and cur[0] != owner and cur[2] > self._now():
                return None                                   # another owner of this identity holds it
            r = self.call("POST", self._lease_path(name, "acquire"), {"ttl_s": int(ttl_s), "owner": owner},
                          cap="leases", ok=(200, 201, 409))
            if r.status == 409:
                if r.error in ("lease_held", ""):
                    return None
                raise self.map_error(r, cap="leases", method="POST", path=self._lease_path(name, "acquire"))
            epoch = int(r.j["epoch"])
            self._held[name] = (owner, epoch, self._now() + int(ttl_s))
            return Lease(name, epoch, int(r.j.get("until_ms", 0)), owner)

    def lease_renew(self, lease: Lease, ttl_s: int) -> Lease:
        with self._llock:
            self._check_owner(lease, "renew")
            r = self.call("POST", self._lease_path(lease.name, "renew"), {"epoch": lease.epoch, "ttl_s": int(ttl_s)},
                          cap="leases")
            epoch = int(r.j.get("epoch", lease.epoch))
            self._held[lease.name] = (lease.owner, epoch, self._now() + int(ttl_s))
            return Lease(lease.name, epoch, int(r.j.get("until_ms", 0)), lease.owner)

    def lease_release(self, lease: Lease) -> None:
        with self._llock:
            cur = self._held.get(lease.name)
            if cur is not None and (cur[0] != lease.owner or cur[1] != lease.epoch):
                return                                        # not ours any more: never free another owner's lease
            r = self.call("POST", self._lease_path(lease.name, "release"), {"epoch": lease.epoch}, cap="leases",
                          ok=(200, 201, 404, 409))
            self._held.pop(lease.name, None)
            if r.status == 409 and r.error not in ("lease_lost", "stale_epoch", "lease_held"):
                raise self.map_error(r, cap="leases", method="POST", path=self._lease_path(lease.name, "release"))

    # ------------------------------------------------------------ records

    def _rec_path(self, type: str, id: str) -> str:
        return "/records/%s/%s" % (urllib.parse.quote(type, safe=""), urllib.parse.quote(id, safe=""))

    def put_record(self, type: str, id: str, body: Mapping[str, Any], if_match: Optional[str] = None,
                   idem_key: str = "", lease: Optional[Lease] = None) -> str:
        h = {"If-Match": if_match} if if_match is not None else {"If-None-Match": "*"}
        if lease is not None:
            self._check_owner(lease, "put_record")
            h[self.hdr["lease"]] = lease.name
            h[self.hdr["epoch"]] = str(lease.epoch)
        params = {"project": self.project}
        r = self.call("PUT", self._rec_path(type, id), dict(body), headers=h, params=params, idem_key=idem_key,
                      cap="records")
        etag = r.header("ETag")
        if not etag and r.j.get("rev") is not None:
            etag = '"%s"' % r.j["rev"]
        return etag or ""

    def get_record(self, type: str, id: str) -> Optional[Tuple[Dict[str, Any], str]]:
        r = self.call("GET", self._rec_path(type, id), cap="records", ok=(200, 404))
        if r.status == 404:
            if not r.error:
                raise self.map_error(r, cap="records", method="GET", path=self._rec_path(type, id))
            return None
        body = r.j.get("body") if isinstance(r.j.get("body"), dict) else r.j
        etag = r.header("ETag") or ('"%s"' % r.j["rev"] if r.j.get("rev") is not None else "")
        return dict(body), etag

    # ------------------------------------------------------------ packs / quotes

    def freeze_pack(self, files: Mapping[str, str], idem_key: str = "") -> str:
        parts = [{"path": p, "page": 1, "text": files[p]} for p in sorted(files)]
        r = self.call("POST", "/packs/%s/versions" % urllib.parse.quote(self.pack_id, safe=""),
                      {"project": self.project, "parts": parts, "freeze": True}, idem_key=idem_key, cap="packs")
        ver = str(r.j.get("version") or "")
        if not ver:
            raise LineError(codes.RAG_DEGRADED, "pack upload returned no version", {"capability": "packs"})
        if r.j.get("state") not in (None, "frozen"):
            self.call("POST", "/packs/%s/versions/%s:freeze" % (self.pack_id, ver), {},
                      idem_key=(idem_key + ":freeze") if idem_key else "", cap="packs")
        self._pack_files[ver] = dict(files)
        return ver

    def _files_of(self, version: str) -> Dict[str, str]:
        if version in self._pack_files:
            return self._pack_files[version]
        r = self.call("GET", "/packs/%s" % urllib.parse.quote(self.pack_id, safe=""),
                      params={"version": version or "latest", "text": "true"}, cap="quote", ok=(200, 404))
        files: Dict[str, str] = {}
        for p in r.j.get("parts") or []:
            if isinstance(p, Mapping) and isinstance(p.get("text"), str):
                files[str(p.get("path"))] = p["text"]
        if version and files:
            self._pack_files[version] = files
        return files

    def quote(self, path: str, text: str, version: str = "") -> Optional[Span]:
        body = {"path": path, "text": text}
        if version:
            body["version"] = version
        r = self.call("POST", "/packs/%s/quotes" % urllib.parse.quote(self.pack_id, safe=""), body,
                      idem_key="", cap="quote", ok=(200, 201, 404, 422))
        if r.status in (404, 422):
            if r.status == 404 and not r.error:
                raise self.map_error(r, cap="quote", method="POST", path="/packs/%s/quotes" % self.pack_id)
            return None
        sp = find_span(self._files_of(version or str(r.j.get("version") or "")), path, text)
        if sp is not None:
            return sp
        qid = str(r.j.get("quote_id") or "")
        return Span(qid or path, path, 0, 0, "", text, "")

    # ------------------------------------------------------------ retrieval / metrics

    def retrieve(self, role: str, step: str, stack: Sequence[str], max_chars: int,
                 query: str = "") -> List[Dict[str, Any]]:
        """The run's project first; with a shared lessons project, that one fills what is left of the budget
        (the project gets at most half when both are read)."""
        if not self.shared_project or self.shared_project == self.project:
            return self._retrieve(self.project, role, step, stack, max_chars, query)
        own = self._retrieve(self.project, role, step, stack, max(int(max_chars) // 2, 0), query)
        used = sum(len(h["text"]) for h in own)
        rest = self._retrieve(self.shared_project, role, step, stack, max(int(max_chars) - used, 0), query)
        return own + rest

    def _retrieve(self, project: str, role: str, step: str, stack: Sequence[str], max_chars: int,
                  query: str = "") -> List[Dict[str, Any]]:
        if max_chars <= 0:
            return []
        body: Dict[str, Any] = {"project": project, "keyspace": self.keyspace,
                                "key": {"role": role, "step": step, "stack": ",".join(stack)},
                                "budget_chars": int(max_chars)}
        if query.strip():           # the situation in words: adds the by-meaning tiers to the exact key
            body["query"] = query.strip()[:QUERY_MAX]
        r = self.call("POST", "/context/step", body, cap="retrieve")
        text = str(r.j.get("pack_text") or "")[:max(int(max_chars), 0)]
        if not text:
            return []
        served = [s.get("id") for s in r.j.get("served") or [] if isinstance(s, Mapping)]
        return [{"text": text, "source": str(r.j.get("serve_id") or ""), "score": 1.0,
                 "served": [x for x in served if x]}]

    def write_worklog(self, subject: str, text: str, idem_key: str = "") -> str:
        """One line in the project worklog the people of the project read too (shared inside the project)."""
        r = self.call("POST", "/worklog", {"project": self.project, "subject": subject, "text": text},
                      idem_key=idem_key, cap="retrieve")
        return str(r.j.get("id") or "")

    def metric(self, name: str, value: float, dims: Optional[Mapping[str, Any]] = None, idem_key: str = "") -> None:
        d = dict(dims or {})
        obs: Dict[str, Any] = {"series": name, "value": float(value), "dims": d, "project": self.project}
        for k, w in (("run", "run_id"), ("unit", "unit_id")):
            if d.get(k):
                obs[w] = str(d[k])
        if d.get("ts_ms"):
            obs["ts_ms"] = int(d["ts_ms"])
        self.call("POST", "/metrics", {"observations": [obs]}, idem_key=idem_key, cap="metrics")


__all__ = ["HttpRagAdapter", "Resp", "OP_CAPABILITY", "DEFAULT_CAPABILITY_MAP", "DEFAULT_HEADERS",
           "TOKEN_REFRESH_MARGIN_S"]
