"""Consumer simulator client library: a generic many-agent consumer driving a dev KH over HTTP.

The simulated consumer is an autonomous software-delivery line in which many agents work at once. KH and the
consumer are separate products: everything here talks to KH only through /v1 HTTP routes, exactly as an
external consumer would. Nothing in KH is imported.

Secrets (the dev bootstrap token, the namespace client secret, principal tokens, webhook secrets) live only in
process memory. They are read from the container env through `docker inspect` (never printed), and every
detail that goes into a report passes `scrub()` first.

    sim = Sim.connect()                    # dev bootstrap token from the kh-dev-f container env
    sim.attach(manifest)                   # PUT /v1/admin/ns/sim1 + manifest, keeps the client secret in memory
    a = sim.principal("agent-01", "agent") # POST /v1/sim1/principals + token (refreshed before it expires)
    r = a.post("/events", {...}, route="POST /events")
"""
from __future__ import annotations

import json
import os
import random
import statistics
import subprocess
import sys
import threading
import time
import traceback
import uuid
from collections import Counter, defaultdict

import requests

BASE = os.getenv("KH_URL", "http://127.0.0.1:9102")
CONTAINER = os.getenv("KH_SIM_CONTAINER", "kh-dev-f")
NS = os.getenv("KH_SIM_NS", "sim1")
PROJECT = os.getenv("KH_SIM_PROJECT", "simline")
DEV_PREFIX = "khdev."
SECRET_KEYS = {"client_secret", "access_token", "secret", "token", "authorization", "password"}


# ── secrets from the container env (never printed) ───────────────────────────

def container_env(name: str, container: str = CONTAINER) -> str:
    out = subprocess.run(["docker", "inspect", container, "--format", "{{json .Config.Env}}"],
                         capture_output=True, text=True, check=True).stdout
    for kv in json.loads(out):
        k, _, v = kv.partition("=")
        if k == name:
            return v
    return ""


def scrub(x, depth=0):
    """A copy of x with every secret-looking value replaced (for reports and details)."""
    if depth > 6:
        return "..."
    if isinstance(x, dict):
        return {k: ("<hidden>" if str(k).lower() in SECRET_KEYS else scrub(v, depth + 1)) for k, v in x.items()}
    if isinstance(x, list):
        return [scrub(v, depth + 1) for v in x[:20]]
    if isinstance(x, str):
        s = x
        for marker in ("khdev.", "eyJ"):
            i = s.find(marker)
            if i >= 0:
                s = s[:i] + "<hidden>"
        return s[:600]
    return x


# ── latency + status statistics ──────────────────────────────────────────────

class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.lat: dict[str, list[float]] = defaultdict(list)
        self.codes: dict[str, Counter] = defaultdict(Counter)

    def add(self, route: str, ms: float, status: int):
        with self.lock:
            self.lat[route].append(ms)
            self.codes[route][status] += 1

    @staticmethod
    def pct(xs, p):
        if not xs:
            return None
        xs = sorted(xs)
        k = max(0, min(len(xs) - 1, int(round(p / 100.0 * (len(xs) - 1)))))
        return xs[k]

    def summary(self) -> dict:
        with self.lock:
            out = {}
            for r, xs in sorted(self.lat.items()):
                out[r] = {"n": len(xs), "p50_ms": round(self.pct(xs, 50), 1), "p95_ms": round(self.pct(xs, 95), 1),
                          "max_ms": round(max(xs), 1), "codes": dict(sorted(self.codes[r].items()))}
            return out


class Resp:
    __slots__ = ("status", "headers", "text", "ms", "_json", "content")

    def __init__(self, status, headers, content, ms):
        self.status, self.headers, self.content, self.ms = status, headers, content, ms
        self.text = content.decode("utf-8", "replace") if isinstance(content, bytes) else str(content)
        self._json = None

    def json(self):
        if self._json is None:
            try:
                self._json = json.loads(self.text or "null")
            except ValueError:
                self._json = {}
        return self._json

    @property
    def j(self):
        b = self.json()
        return b if isinstance(b, dict) else {}

    @property
    def error(self):
        return self.j.get("error")

    def brief(self):
        return f"{self.status} {scrub(self.text)[:300]}"


# ── HTTP client ──────────────────────────────────────────────────────────────

class Client:
    """One identity (person, namespace admin, or a KH principal). Thread-safe: a session per thread."""

    def __init__(self, sim: "Sim", name: str, token_fn, ns: str | None = None):
        self.sim, self.name, self._token_fn = sim, name, token_fn
        self.ns = ns or sim.ns
        self._tok, self._exp = None, 0.0
        self._tlock = threading.Lock()
        self._local = threading.local()
        self.headers: dict[str, str] = {}

    def _session(self):
        s = getattr(self._local, "s", None)
        if s is None:
            s = self._local.s = requests.Session()
            a = requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=8)
            s.mount("http://", a)
        return s

    def token(self, force=False) -> str:
        with self._tlock:
            if force or self._tok is None or time.time() > self._exp - 90:
                self._tok, self._exp = self._token_fn()
            return self._tok

    def url(self, path: str) -> str:
        if path.startswith("/v1/") or path.startswith("/health"):
            return self.sim.base + path
        return f"{self.sim.base}/v1/{self.ns}{path}"

    def call(self, method, path, body=None, headers=None, route=None, params=None, data=None, timeout=60,
             auth=True) -> Resp:
        h = dict(self.headers)
        if auth:
            h["Authorization"] = "Bearer " + self.token()
        if headers:
            h.update({k: str(v) for k, v in headers.items() if v is not None})
        kw = {"headers": h, "params": params, "timeout": timeout}
        if data is not None:
            kw["data"] = data
        elif body is not None:
            kw["json"] = body
        for attempt in range(2):
            t0 = time.perf_counter()
            try:
                r = self._session().request(method, self.url(path), **kw)
                status, hdrs, content = r.status_code, r.headers, r.content
            except requests.RequestException as exc:
                status, hdrs, content = 599, {}, repr(exc).encode()
            ms = (time.perf_counter() - t0) * 1000
            if status == 401 and auth and attempt == 0 and b"expired" in content:
                h["Authorization"] = "Bearer " + self.token(force=True)
                continue
            break
        self.sim.stats.add(route or f"{method} {path}", ms, status)
        return Resp(status, hdrs, content, ms)

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.call("POST", path, body if body is not None else {}, **kw)

    def put(self, path, body=None, **kw):
        return self.call("PUT", path, body, **kw)

    def patch(self, path, body=None, **kw):
        return self.call("PATCH", path, body, **kw)

    def delete(self, path, **kw):
        return self.call("DELETE", path, **kw)


# ── the simulator context ────────────────────────────────────────────────────

class Sim:
    """The consumer: one namespace, its admin (namespace client), and many principals."""

    def __init__(self, base: str, dev_token: str, ns: str = NS, project: str = PROJECT):
        self.base, self.ns, self.project = base.rstrip("/"), ns, project
        self.stats = Stats()
        self._dev = dev_token if dev_token.startswith(DEV_PREFIX) else DEV_PREFIX + dev_token
        self.person = Client(self, "person", lambda: (self._dev, time.time() + 10 ** 9))
        self._client_id = self._client_secret = None
        self.admin = Client(self, "admin", self._admin_token)
        self.principals: dict[str, Client] = {}
        self.state: dict = {}          # shared between scenarios (names, ids, epochs, ...)

    @classmethod
    def connect(cls, base: str = BASE, ns: str = NS) -> "Sim":
        raw = os.getenv("KH_DEV_BOOTSTRAP_TOKEN") or container_env("KH_DEV_BOOTSTRAP_TOKEN")
        if not raw:
            raise SystemExit("no dev bootstrap token in the container env (KH_DEV_BOOTSTRAP_TOKEN)")
        return cls(base, raw, ns)

    # namespace client -> admin token
    def _admin_token(self):
        if not self._client_secret:
            raise RuntimeError("namespace client secret unknown: attach the namespace in this process first")
        r = requests.post(self.base + "/v1/token", json={"grant_type": "client_credentials",
                                                          "client_id": self._client_id,
                                                          "client_secret": self._client_secret}, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"POST /v1/token -> {r.status_code} {scrub(r.text)[:200]}")
        b = r.json()
        return b["access_token"], time.time() + int(b.get("expires_in", 900))

    def set_client(self, client: dict):
        self._client_id, self._client_secret = client.get("client_id"), client.get("client_secret")
        self.admin._tok = None

    def principal(self, pid: str, role: str, projects=None, create=True, ns: str | None = None) -> Client:
        key = f"{ns or self.ns}:{pid}"
        if key in self.principals:
            return self.principals[key]
        admin = self.admin
        if create:
            body = {"principal_id": pid, "role": role}
            if projects:
                body["projects"] = projects
            r = admin.post("/principals", body, route="POST /principals")
            if r.status not in (200, 201) and not (r.status == 409):
                raise RuntimeError(f"create principal {pid}: {r.brief()}")

        def tok():
            r = admin.post(f"/principals/{pid}/token", {}, route="POST /principals/{id}/token")
            if r.status not in (200, 201):
                raise RuntimeError(f"token for {pid}: {r.brief()}")
            return r.j["access_token"], time.time() + int(r.j.get("expires_in", 900))

        c = Client(self, pid, tok, ns=ns)
        c.role = role
        self.principals[key] = c
        return c

    def forget_principals(self):
        self.principals.clear()

    def wait(self, fn, timeout=10.0, every=0.2):
        """Poll fn() until truthy; returns (value, seconds)."""
        t0 = time.monotonic()
        while True:
            v = fn()
            if v or time.monotonic() - t0 > timeout:
                return v, time.monotonic() - t0
            time.sleep(every)

    def top_seq(self) -> int:
        """The highest event seq of the namespace right now (admin cursor read from the last known top)."""
        cur = self.state.get("seq_top", 0)
        while True:
            r = self.admin.get("/events", params={"after_seq": cur, "limit": 1000}, route="GET /events")
            evs = r.j.get("events", [])
            if evs:
                cur = evs[-1]["seq"]
            if len(evs) < 1000:
                self.state["seq_top"] = cur
                return cur

    def kh_events(self, kind, after_seq) -> list[dict]:
        return self.events(kind=kind, after_seq=after_seq)

    def events(self, kind=None, after_seq=0, limit=1000, client=None, **filters) -> list[dict]:
        """Every event (admin read, paged)."""
        c = client or self.admin
        out, cur = [], after_seq
        while True:
            params = {"after_seq": cur, "limit": limit, **filters}
            if kind:
                params["kind"] = kind
            r = c.get("/events", params=params, route="GET /events")
            if r.status != 200:
                raise RuntimeError(f"GET /events -> {r.brief()}")
            evs = r.j.get("events", [])
            out += evs
            if len(evs) < limit:
                return out
            cur = r.j.get("next_after_seq") or evs[-1]["seq"]


# ── scenario bookkeeping ─────────────────────────────────────────────────────

class Scenario:
    def __init__(self, sid: str, title: str, sim: Sim):
        self.id, self.title, self.sim = sid, title, sim
        self.checks: list[dict] = []
        self.numbers: dict = {}
        self.notes: list[str] = []
        self.t0 = time.monotonic()
        self.error = None

    def check(self, name, cond, detail=None) -> bool:
        ok = bool(cond)
        self.checks.append({"name": name, "ok": ok, "detail": None if ok else scrub(detail if not isinstance(
            detail, Resp) else detail.brief())})
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else
                                                          f"  -> {str(scrub(detail if not isinstance(detail, Resp) else detail.brief()))[:400]}"),
              flush=True)
        return ok

    def note(self, text):
        self.notes.append(text)
        print("  note " + text, flush=True)

    @property
    def passed(self):
        return self.error is None and all(c["ok"] for c in self.checks)

    def result(self) -> dict:
        return {"id": self.id, "title": self.title, "passed": self.passed, "seconds": round(time.monotonic() - self.t0, 1),
                "checks": len(self.checks), "failed": [c for c in self.checks if not c["ok"]],
                "numbers": self.numbers, "notes": self.notes, "error": self.error}


def run_scenario(sim: Sim, sid: str, title: str, fn) -> dict:
    print(f"\n=== {sid}: {title}", flush=True)
    sim.stats = Stats()
    sc = Scenario(sid, title, sim)
    try:
        fn(sim, sc)
    except Exception as exc:  # noqa: BLE001
        sc.error = scrub(f"{type(exc).__name__}: {exc}")
        print("  ERROR " + sc.error, flush=True)
        traceback.print_exc()
    res = sc.result()
    res["latency"] = sim.stats.summary()
    print(f"=== {sid}: {'PASS' if res['passed'] else 'FAIL'} ({res['checks']} checks, {res['seconds']} s)", flush=True)
    return res


def uid(prefix="x") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def env_headers(run=None, unit=None, attempt=None, session=None, lease=None, epoch=None) -> dict:
    h = {}
    if run:
        h["X-KH-Run"] = run
    if unit:
        h["X-KH-Unit"] = unit
    if attempt is not None:
        h["X-KH-Attempt"] = str(attempt)
    if session:
        h["X-KH-Session"] = session
    if lease:
        h["X-KH-Lease"] = lease
    if epoch is not None:
        h["X-KH-Epoch"] = str(epoch)
    return h


def ev_body(**extra) -> dict:
    """A body that satisfies the line's event schema (required consumer fields)."""
    b = {"agent_version": "line-agent/3.4.1", "model_snapshot": "model-2026-09-30", "spec_hash": "sha256:" + "ab" * 8}
    b.update(extra)
    return b


def standalone(fn, sid, title, fresh=True):
    """Run one scenario script on its own: attach a fresh namespace first (s01), then the scenario."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import s01_attach
    sim = Sim.connect()
    res = [run_scenario(sim, "S01", s01_attach.TITLE, s01_attach.run)]
    if sid != "S01":
        res.append(run_scenario(sim, sid, title, fn))
    s01_attach.stop_receiver()
    print(json.dumps([{k: r[k] for k in ("id", "passed", "checks", "numbers")} for r in res], indent=1, default=str))
    sys.exit(0 if all(r["passed"] for r in res) else 1)


__all__ = ["Sim", "Client", "Scenario", "Stats", "Resp", "run_scenario", "uid", "env_headers", "ev_body", "scrub",
           "standalone", "container_env", "NS", "PROJECT", "BASE", "CONTAINER", "random"]
