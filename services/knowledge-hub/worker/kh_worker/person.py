"""The sidecar identity: the worker signs in as a KH person account, and keeps its own books (Rowan 2026-10-24).

WHY. The ``principal`` identity (``khclient.KHClient``) needs ``kh_people`` attached on the KH it talks to
(``KH_CAP_PEOPLE=on``, ``KH_DISTILL_WORKER=dry|on``). A KH without it answers 404 ``ns_not_active`` on every
``/v1/kh_people`` route. With ``KH_WORKER_AUTH=person`` the worker runs as a separate instance next to such a KH:

* **Token.** A technical user of the ``knowledge-hub`` realm with the maintainer role (the distil routes are
  maintainer routes) signs in with a password grant on a confidential client that allows direct access grants
  only (the pattern of the chatbot's ``kh-agent-chatbot``). The refresh token is used while it lasts. The same
  person token reaches ``/distill/*``, ``/daily/*`` and ``/distill/approve``.
* **Books.** The lease, the ``worker.cost_usd`` ledger and the ``worker.run`` events live as files in
  ``KH_WORKER_STATE_DIR`` (a volume), not in ``kh_people``. The caps read the month total from that ledger, so
  keep the directory across restarts or the month starts over.
* **What is already distilled.** KH's own cursor per project (``/distill/cursor``) stays the source of truth:
  ``/distill/next`` serves only logs past it, and the first real submit of a batch moves it. The ledger
  ``runs.jsonl`` adds, per batch, which log ids were served and what came back, for a person to read.
"""
from __future__ import annotations

import calendar
import json
import logging
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any, Mapping

from .khclient import LEASE_TTL_S, KHClient, KHError, LeaseHeld, _Token

log = logging.getLogger("kh_worker.person")

LOCK_FILE = "lease-{name}.json"
SPEND_FILE = "spend.jsonl"
EVENTS_FILE = "runs.jsonl"


class PersonKHClient(KHClient):
    """``KHClient`` with a person token and file-backed lease, spend and events."""

    def __init__(self, base_url: str, *, token_url: str, kc_client_id: str, kc_client_secret: str = "",
                 username: str, password: str, state_dir: str, dry: bool = True, timeout_s: float = 60.0,
                 session: Any = None, clock=time.time, run_id: str = ""):
        if not (token_url and kc_client_id and username and password):
            raise ValueError("KH_WORKER_AUTH=person needs KH_WORKER_KC_TOKEN_URL, KH_WORKER_KC_CLIENT_ID, "
                             "KH_WORKER_USERNAME and KH_WORKER_PASSWORD")
        super().__init__(base_url, static_token="-", dry=dry, timeout_s=timeout_s, session=session, clock=clock,
                         run_id=run_id)
        self.static_token = ""                  # "-" only satisfied the base check; tokens come from Keycloak
        self.token_url = token_url
        self.kc_client_id, self.kc_client_secret = kc_client_id, kc_client_secret
        self.username, self.password = username, password
        self.state = Path(state_dir)
        self.state.mkdir(parents=True, exist_ok=True)
        self._person = _Token()
        self._refresh = _Token()
        self._file_lock = threading.Lock()

    # ------------------------------------------------------------------------------------------ identity
    def _grant(self, data: dict) -> dict:
        data = {"client_id": self.kc_client_id, **data}
        if self.kc_client_secret:
            data["client_secret"] = self.kc_client_secret
        r = self.http.request("POST", self.token_url, data=data, headers={"Accept": "application/json"},
                              timeout=self.timeout_s)
        if r.status_code >= 400:
            try:
                body = r.json()
            except ValueError:
                body = {}
            raise KHError(r.status_code, str(body.get("error") or "token_refused"),
                          str(body.get("error_description") or (r.text or "")[:200]))
        return r.json()

    def person_token(self) -> str:
        with self._tok_lock:
            now = self._clock()
            if self._person.fresh(now):
                return self._person.value
            out = None
            if self._refresh.fresh(now):
                try:
                    out = self._grant({"grant_type": "refresh_token", "refresh_token": self._refresh.value})
                except KHError as exc:
                    log.info("refresh refused (%s); signing in again", exc)
            if out is None:
                out = self._grant({"grant_type": "password", "username": self.username,
                                   "password": self.password, "scope": "openid"})
            self._person = _Token(out["access_token"], now + float(out.get("expires_in") or 300))
            if out.get("refresh_token"):
                self._refresh = _Token(out["refresh_token"], now + float(out.get("refresh_expires_in") or 1800))
            return self._person.value

    def ns_token(self) -> str:
        return self.person_token()

    def worker_token(self) -> str:
        return self.person_token()

    # ------------------------------------------------------------------------------------------ books
    def _append(self, name: str, row: Mapping[str, Any]) -> None:
        path = self.state / name
        with self._file_lock:
            # A crash can leave a torn last line; start on a fresh line so this row is not glued to it and lost.
            torn = False
            if path.exists() and path.stat().st_size:
                with open(path, "rb") as fh:
                    fh.seek(-1, os.SEEK_END)
                    torn = fh.read(1) != b"\n"
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(("\n" if torn else "") + json.dumps(row, ensure_ascii=False, default=str) + "\n")

    def _rows(self, name: str) -> list[dict]:
        path = self.state / name
        if not path.exists():
            return []
        out = []
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue                         # a torn last line after a crash
        return out

    def lease(self, name: str, ttl_s: int = LEASE_TTL_S) -> "FileLease":
        return FileLease(self, name, ttl_s)

    def record_cost(self, usd: float, *, job: str, kind: str, model: str, project: str = "",
                    usage: Mapping[str, Any] | None = None) -> Any:
        self._append(SPEND_FILE, {"ts": self._clock(), "usd": round(float(usd), 6), "job": job, "kind": kind,
                                  "model": model, "project": project, "run_id": self.run_id})
        return {"ok": True}

    def month_spend_usd(self, *, now: float | None = None) -> float:
        now = self._clock() if now is None else now
        t = time.gmtime(now)
        start = calendar.timegm((t.tm_year, t.tm_mon, 1, 0, 0, 0))
        return sum(float(r.get("usd") or 0.0) for r in self._rows(SPEND_FILE)
                   if r.get("kind") != "backfill" and float(r.get("ts") or 0) >= start)

    def append_event(self, kind: str, body: Mapping[str, Any], *, project: str = "", event_id: str = "") -> Any:
        self._append(EVENTS_FILE, {"ts": self._clock(), "kind": kind, "id": event_id, "project": project,
                                   "run_id": self.run_id, "body": dict(body)})
        return {"ok": True}

    # ------------------------------------------------------------------------------------------ extra routes
    def consented_projects(self) -> list[str]:
        """The projects KH serves to the distiller (KH_DISTILL_PROJECTS on the server), via /distill/patterns."""
        out = self._request("GET", "/distill/patterns", token=self.person_token(), params={"days": 1})
        return [p["project"] for p in out.get("projects") or [] if isinstance(p, dict) and p.get("project")]

    def distill_approve(self, project: str, ids: list[str], share: list[str] | None = None) -> dict:
        return self._request("POST", "/distill/approve", token=self.person_token(),
                             json={"project": project, "ids": list(ids), "share": list(share or [])})


class FileLease:
    """One run at a time per job on this volume: a lock file with an expiry, renewed while the job runs.

    Another instance on the same volume sees an unexpired file and skips (``LeaseHeld``). Two instances on
    different volumes are not stopped by it; KH still serves each batch once (a second submit of a batch is a
    409), so the worst case is wasted model calls, not double items."""

    def __init__(self, kh: PersonKHClient, name: str, ttl_s: int = LEASE_TTL_S):
        self.kh, self.name = kh, name
        self.ttl_s = max(30, int(ttl_s))
        self.path = kh.state / LOCK_FILE.format(name=name.replace(":", "_"))
        self.holder = f"{socket.gethostname()}:{os.getpid()}:{kh.run_id}"
        self.lost = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _write(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"holder": self.holder, "expires_at": self.kh._clock() + self.ttl_s}),
                       encoding="utf-8")
        os.replace(tmp, self.path)

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def acquire(self) -> "FileLease":
        cur = self._read()
        if cur.get("holder") not in (None, self.holder) and float(cur.get("expires_at") or 0) > self.kh._clock():
            raise LeaseHeld(409, "lease_held", f"held by {cur['holder']}", {"holder": cur["holder"]})
        self._write()
        return self

    def _renewer(self) -> None:
        while not self._stop.wait(self.ttl_s / 3):
            if self._read().get("holder") != self.holder:
                log.error("lease %s taken by %s; the job stops at its next step", self.name,
                          self._read().get("holder"))
                self.lost.set()
                return
            try:
                self._write()
            except OSError as exc:
                log.warning("lease %s renew failed: %s", self.name, exc)

    def release(self) -> None:
        if self._read().get("holder") == self.holder:
            try:
                self.path.unlink()
            except OSError:
                pass

    def __enter__(self) -> "FileLease":
        self.acquire()
        self._thread = threading.Thread(target=self._renewer, name=f"lease-{self.name}", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self.release()
