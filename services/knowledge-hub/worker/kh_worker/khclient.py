"""HTTP client for KH, as the worker sees it (design section 3.2, "Identity"; 3.5 reuse map).

Two tokens:

* the **namespace token** of ``kh_people`` (``POST /v1/token`` with the confidential client's id and secret).
  It reaches ``/v1/kh_people/*``: leases, ``worker.cost_usd`` metrics and ``worker.run`` events.
* the **worker principal token**: the namespace token creates the principal ``worker`` (role ``distiller``)
  and mints its 15-minute token. That token reaches only ``/distill/next|submit|cursor`` and
  ``/daily/next|submit``. It is re-minted before it expires.

``KH_WORKER_TOKEN`` (a ready token for both, dev only) skips the client-credentials step.

Dry mode is enforced here as well as in KH: while ``dry`` is set, every submit carries ``dry_run: true`` and
the client refuses any other write except to ``kh_people`` (lease, metric, event).
"""
from __future__ import annotations

import calendar
import hashlib
import logging
import re
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Mapping

import requests

log = logging.getLogger("kh_worker.khclient")

NS = "kh_people"
#: KH's event id rule (app/caps/events.py ID_RE). An id outside it makes KH refuse the whole append with 422.
EVENT_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
WORKER_PRINCIPAL = "worker"
WORKER_ROLE = "distiller"
TOKEN_SKEW_S = 90           # re-mint this long before expiry
LEASE_TTL_S = 900           # 15 min (design 3.2); KH clamps leases to 5..300 s, see Lease.acquire


class KHError(RuntimeError):
    def __init__(self, status: int, code: str, message: str = "", body: Any = None):
        self.status, self.code, self.body = status, code, body
        super().__init__(f"KH {status} {code}: {message}".strip())


class LeaseHeld(KHError):
    pass


class LeaseLost(KHError):
    pass


class BudgetRefused(KHError):
    """KH's own month cap (lock 3): 429 ``budget`` on /distill/next or /daily/next."""


@dataclass
class _Token:
    value: str = ""
    expires_at: float = 0.0

    def fresh(self, now: float) -> bool:
        return bool(self.value) and now < self.expires_at - TOKEN_SKEW_S


def safe_event_id(raw: str) -> str:
    """A KH event id for ``raw`` (e.g. ``worker.run:<run>:<batch>``): KH accepts [A-Za-z0-9_-]{1,64} only.
    Deterministic, so a retried append stays idempotent; a long id keeps its head and gets a hash tail."""
    if EVENT_ID_RE.match(raw):
        return raw
    clean = re.sub(r"[^A-Za-z0-9_\-]+", "_", raw).strip("_") or "ev"
    if len(clean) <= 64:
        return clean
    return clean[:43] + "_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


class KHClient:
    def __init__(self, base_url: str, *, client_id: str = "", client_secret: str = "", static_token: str = "",
                 dry: bool = True, timeout_s: float = 60.0, session: Any = None,
                 clock: Callable[[], float] = time.time, run_id: str = ""):
        if not base_url:
            raise ValueError("KH_URL is required")
        self.base = base_url.rstrip("/")
        self.client_id, self.client_secret = client_id, client_secret
        self.static_token = static_token
        if not static_token and not (client_id and client_secret):
            raise ValueError("set KH_WORKER_CLIENT_ID and KH_WORKER_CLIENT_SECRET (or KH_WORKER_TOKEN for dev)")
        self.dry = dry
        self.timeout_s = timeout_s
        self.http = session or requests.Session()
        self._clock = clock
        self.run_id = run_id or uuid.uuid4().hex[:16]
        self._ns = _Token()
        self._worker = _Token()
        self._tok_lock = threading.Lock()

    # ------------------------------------------------------------------------------------------ transport
    def _request(self, method: str, path: str, *, token: str | None = None, json: Any = None,
                 params: Mapping[str, Any] | None = None, headers: Mapping[str, str] | None = None) -> Any:
        h = {"Accept": "application/json", "X-KH-Run": self.run_id}
        if token:
            h["Authorization"] = f"Bearer {token}"
        if headers:
            h.update(headers)
        try:
            r = self.http.request(method, self.base + path, json=json, params=params, headers=h,
                                  timeout=self.timeout_s)
        except requests.RequestException as exc:
            # A slow /distill/submit (about 10 items) can pass the read timeout and still commit on KH; the
            # job treats it like any KH error, and the next `next` shows from the cursor whether it landed.
            raise KHError(0, "transport", f"{method} {path}: {type(exc).__name__}: {exc}"[:300]) from exc
        if r.status_code >= 400:
            try:
                body = r.json()
            except ValueError:
                body = {"detail": (r.text or "")[:300]}
            detail = body.get("detail", body) if isinstance(body, dict) else body
            code = ""
            msg = ""
            if isinstance(body, dict) and isinstance(body.get("error"), str):
                code = body["error"]                      # caps errors: {"error": code, "detail": text}
            if isinstance(detail, dict):
                code = code or str(detail.get("code") or detail.get("error") or "")
                msg = str(detail.get("message") or detail.get("detail") or "")
            else:
                msg = str(detail)[:300]
            code = code or {401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
                            423: "locked", 429: "rate_limited"}.get(r.status_code, "error")
            if r.status_code == 429 and ("budget" in code or "budget" in msg):
                raise BudgetRefused(429, "budget", msg, body)
            if r.status_code == 409 and code == "lease_held":
                raise LeaseHeld(409, code, msg, body)
            if r.status_code == 409 and code == "lease_lost":
                raise LeaseLost(409, code, msg, body)
            raise KHError(r.status_code, code, msg, body)
        if r.status_code == 204 or not r.content:
            return {}
        return r.json()

    # ------------------------------------------------------------------------------------------ identity
    def ns_token(self) -> str:
        if self.static_token:
            return self.static_token
        with self._tok_lock:
            now = self._clock()
            if not self._ns.fresh(now):
                out = self._request("POST", "/v1/token", json={
                    "grant_type": "client_credentials", "client_id": self.client_id,
                    "client_secret": self.client_secret})
                self._ns = _Token(out["access_token"], now + float(out.get("expires_in") or 300))
            return self._ns.value

    def worker_token(self) -> str:
        if self.static_token:
            return self.static_token
        ns = self.ns_token()
        with self._tok_lock:
            now = self._clock()
            if not self._worker.fresh(now):
                try:
                    self._request("POST", f"/v1/{NS}/principals", token=ns,
                                  json={"role": WORKER_ROLE, "principal_id": WORKER_PRINCIPAL})
                except KHError as exc:
                    if exc.status != 409:      # already exists: fine
                        raise
                out = self._request("POST", f"/v1/{NS}/principals/{WORKER_PRINCIPAL}/token", token=ns)
                self._worker = _Token(out["access_token"], now + float(out.get("expires_in") or 900))
            return self._worker.value

    # ------------------------------------------------------------------------------------------ kh_people
    def lease(self, name: str, ttl_s: int = LEASE_TTL_S) -> "Lease":
        return Lease(self, name, ttl_s)

    def record_cost(self, usd: float, *, job: str, kind: str, model: str, project: str = "",
                    usage: Mapping[str, Any] | None = None) -> Any:
        dims = {"job": job, "kind": kind, "model": model}
        obs = {"series": "worker.cost_usd", "value": round(float(usd), 6), "ts_ms": int(self._clock() * 1000),
               "run_id": self.run_id, "unit_id": f"worker:{job}", "dims": dims}
        if project:
            obs["project"] = project
        return self._request("POST", f"/v1/{NS}/metrics", token=self.ns_token(), json={"observations": [obs]})

    def month_spend_usd(self, *, now: float | None = None) -> float:
        """Billed spend of this calendar month (UTC) from ``worker.cost_usd``, backfill left out."""
        now = self._clock() if now is None else now
        t = time.gmtime(now)
        start = calendar.timegm((t.tm_year, t.tm_mon, 1, 0, 0, 0)) * 1000
        out = self._request("GET", f"/v1/{NS}/metrics:aggregate", token=self.ns_token(), params={
            "series": "worker.cost_usd", "group_by": "dims.kind", "from": start, "to": int(now * 1000) + 1})
        total = 0.0
        for g in out.get("groups") or []:
            key = g.get("key") or {}
            if (key.get("dims.kind") or key.get("kind")) == "backfill":
                continue
            total += float(g.get("sum") or 0.0)
        return total

    def append_event(self, kind: str, body: Mapping[str, Any], *, project: str = "", event_id: str = "") -> Any:
        ev: dict[str, Any] = {"kind": kind, "body": dict(body), "run_id": self.run_id,
                              "ts_ms": int(self._clock() * 1000)}
        if project:
            ev["project"] = project
        if event_id:
            ev["id"] = safe_event_id(event_id)
        return self._request("POST", f"/v1/{NS}/events", token=self.ns_token(), json=ev)

    # ------------------------------------------------------------------------------------------ distil / daily
    def distill_next(self, project: str, limit: int | None = None) -> dict:
        params: dict[str, Any] = {"project": project}
        if limit:
            params["limit"] = limit
        return self._request("GET", "/distill/next", token=self.worker_token(), params=params)

    def distill_submit(self, body: Mapping[str, Any]) -> dict:
        b = dict(body)
        if self.dry:
            b["dry_run"] = True                  # dry mode writes nothing, whatever the caller passed
        return self._request("POST", "/distill/submit", token=self.worker_token(), json=b)

    def distill_cursor(self, project: str) -> dict:
        return self._request("GET", "/distill/cursor", token=self.worker_token(), params={"project": project})

    def daily_next(self, project: str) -> dict:
        return self._request("GET", "/daily/next", token=self.worker_token(), params={"project": project})

    def session_sweep(self) -> dict:
        """Delete session project bindings idle past KH's TTL (KH app/session_project.py)."""
        return self._request("POST", "/session/sweep", token=self.worker_token(), json={})

    def promote_next(self) -> dict:
        """Personal and project feedback rows, the common tier and past proposals (KH app/promote.py)."""
        return self._request("GET", "/promote/next", token=self.worker_token())

    def promote_submit(self, body: Mapping[str, Any]) -> dict:
        b = dict(body)
        if self.dry:
            b["dry_run"] = True
        return self._request("POST", "/promote/submit", token=self.worker_token(), json=b)

    def daily_submit(self, body: Mapping[str, Any]) -> dict:
        b = dict(body)
        if self.dry:
            b["dry_run"] = True
        return self._request("POST", "/daily/submit", token=self.worker_token(), json=b)


class Lease:
    """``worker:<job>`` lease in ``kh_people``. KH caps one grant at 300 s, so a 15-minute lease is held as
    300-s grants renewed every TTL/3 by a daemon thread. ``lost`` is set when a renewal fails: the job must
    check it between steps and stop."""

    def __init__(self, kh: KHClient, name: str, ttl_s: int = LEASE_TTL_S):
        self.kh, self.name = kh, name
        self.ttl_s = max(5, min(int(ttl_s), 300))
        self.epoch: int | None = None
        self.lost = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _path(self, verb: str) -> str:
        return f"/v1/{NS}/leases/{self.name}:{verb}"

    def acquire(self) -> "Lease":
        out = self.kh._request("POST", self._path("acquire"), token=self.kh.ns_token(), json={"ttl_s": self.ttl_s})
        self.epoch = int(out["epoch"])
        return self

    def renew(self) -> None:
        out = self.kh._request("POST", self._path("renew"), token=self.kh.ns_token(),
                               json={"epoch": self.epoch, "ttl_s": self.ttl_s})
        self.epoch = int(out.get("epoch", self.epoch))

    def release(self) -> None:
        if self.epoch is None:
            return
        try:
            self.kh._request("POST", self._path("release"), token=self.kh.ns_token(), json={"epoch": self.epoch})
        except KHError as exc:
            log.warning("lease %s release failed: %s", self.name, exc)

    def _renewer(self) -> None:
        while not self._stop.wait(self.ttl_s / 3):
            try:
                self.renew()
            except LeaseLost:
                log.error("lease %s lost; the job stops at its next step", self.name)
                self.lost.set()
                return
            except Exception as exc:  # noqa: BLE001 - transient: keep trying until the grant runs out
                log.warning("lease %s renew failed: %s", self.name, exc)

    def __enter__(self) -> "Lease":
        self.acquire()
        self._thread = threading.Thread(target=self._renewer, name=f"lease-{self.name}", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self.release()
