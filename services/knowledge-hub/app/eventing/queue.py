"""EventBuffer: the shock absorber between event producers and the EventStore (fen 2026-10-24).

RabbitMQ or Kafka cannot run on this BTP space (no TCP route, no container-to-container policy for our role, no
persistent disk), so the queue is KH's own, kept small: producers hand batches to a buffer, a single writer drains
it into the store in batches. The buffer is a port too (KH_EVENT_BUFFER):

  direct   publish writes straight to the store (no buffer; the default without a sidecar)
  memory   a bounded in-process queue + one writer thread. The kh-events sidecar runs this one. Full means
           QueueFull (the sidecar answers 503 + Retry-After); the producer keeps its batch and retries.
  http     POST the batch to the kh-events sidecar (KH_EVENTS_URL, bearer KH_EVENTS_TOKEN)

Delivery is at least once: a batch the writer could not store goes back to the front of the queue, and the store
keeps the first copy of a repeated event id. The memory queue lives in RAM: on a graceful stop (SIGTERM, a CF
restart) the writer drains it first; a hard crash loses what was not yet written (seconds of events).
"""
from __future__ import annotations

import collections
import hmac
import logging
import os
import threading
import time
from typing import Protocol

logger = logging.getLogger(__name__)


class QueueFull(Exception):
    """The buffer cannot take more now; retry later."""


class EventBuffer(Protocol):
    name: str

    def publish(self, ns: str, rows: list[dict]) -> None: ...


class DirectBuffer:
    name = "direct"

    def __init__(self, store=None):
        self._store = store

    def publish(self, ns: str, rows: list[dict]) -> None:
        from app.eventing.store import get_store
        (self._store or get_store()).append(ns, [dict(r) for r in rows])


class MemoryQueue:
    """Bounded FIFO of (ns, row) and the writer that drains it into the store."""

    name = "memory"

    def __init__(self, store=None, max_events: int = 50000, batch_max: int = 500, flush_s: float = 1.0):
        self._store = store
        self.max_events, self.batch_max, self.flush_s = max_events, batch_max, flush_s
        self._q: collections.deque = collections.deque()
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.stats = {"accepted": 0, "written": 0, "refused_full": 0, "write_errors": 0, "last_error": None}

    def store(self):
        from app.eventing.store import get_store
        return self._store or get_store()

    def depth(self) -> int:
        return len(self._q)

    def publish(self, ns: str, rows: list[dict]) -> None:
        with self._lock:
            if len(self._q) + len(rows) > self.max_events:
                self.stats["refused_full"] += len(rows)
                raise QueueFull(f"the event queue holds {len(self._q)} of {self.max_events}")
            self._q.extend((ns, dict(r)) for r in rows)
            self.stats["accepted"] += len(rows)
        if len(self._q) >= self.batch_max:
            self._wake.set()

    def flush_once(self) -> int:
        """Write up to batch_max queued events, grouped by namespace. Returns how many were written."""
        with self._lock:
            batch = [self._q.popleft() for _ in range(min(self.batch_max, len(self._q)))]
        if not batch:
            return 0
        by_ns: dict[str, list[dict]] = {}
        for ns, row in batch:
            by_ns.setdefault(ns, []).append(row)
        done, stored = 0, set()
        try:
            for ns, rows in by_ns.items():
                self.store().append(ns, rows)       # one transaction per namespace: all of it or none
                stored.add(ns)
                done += len(rows)
        except Exception as exc:  # noqa: BLE001 - keep the events, retry on the next tick
            self.stats["write_errors"] += 1
            self.stats["last_error"] = str(exc)[:300]
            rest = [(ns, row) for ns, row in batch if ns not in stored]
            logger.warning("event queue: store write failed, %d event(s) kept: %s", len(rest), exc)
            with self._lock:
                self._q.extendleft(reversed(rest))   # back to the front, in their order
        self.stats["written"] += done
        return done

    def drain(self, deadline_s: float = 8.0) -> int:
        """Write everything queued (a graceful stop), within ``deadline_s``."""
        end, total = time.monotonic() + deadline_s, 0
        while self._q and time.monotonic() < end:
            n = self.flush_once()
            total += n
            if n == 0:
                time.sleep(0.2)
        return total

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self.flush_s)
            self._wake.clear()
            while self.flush_once() >= self.batch_max:
                pass

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="kh-event-writer", daemon=True)
            self._thread.start()

    def stop(self, drain_s: float = 8.0) -> int:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(2)
        return self.drain(drain_s)


class HttpBuffer:
    """Hands batches to the kh-events sidecar. A refused or failed post raises, so the caller keeps the batch."""

    name = "http"

    def __init__(self, url: str, token: str, timeout: float = 5.0):
        self.url, self.token, self.timeout = url.rstrip("/"), token, timeout

    def publish(self, ns: str, rows: list[dict]) -> None:
        import requests
        resp = requests.post(self.url + "/queue/publish", timeout=self.timeout,
                             headers={"Authorization": f"Bearer {self.token}"},
                             json={"events": [{"ns": ns, "row": r} for r in rows]})
        if resp.status_code == 503:
            raise QueueFull("the kh-events sidecar is full")
        if resp.status_code >= 300:
            raise RuntimeError(f"kh-events answered {resp.status_code}: {resp.text[:200]}")


_buffer: EventBuffer | None = None


def get_buffer() -> EventBuffer:
    """The buffer KH_EVENT_BUFFER names; default http when KH_EVENTS_URL is set, else direct."""
    global _buffer
    if _buffer is None:
        url = (os.getenv("KH_EVENTS_URL") or "").strip()
        name = (os.getenv("KH_EVENT_BUFFER") or ("http" if url else "direct")).strip().lower()
        if name == "http":
            if not url:
                raise ValueError("KH_EVENT_BUFFER=http needs KH_EVENTS_URL")
            _buffer = HttpBuffer(url, (os.getenv("KH_EVENTS_TOKEN") or "").strip())
        elif name == "memory":
            q = MemoryQueue()
            q.start()
            _buffer = q
        elif name == "direct":
            _buffer = DirectBuffer()
        else:
            raise ValueError(f"KH_EVENT_BUFFER: unknown buffer '{name}' (direct, memory, http)")
    return _buffer


def set_buffer(buffer: EventBuffer | None) -> None:
    global _buffer
    _buffer = buffer


def buffered(ns: str) -> bool:
    """Whether namespace ``ns`` sends its unfenced /v1 events through the buffer (KH_EVENTS_BUFFERED_NS)."""
    names = {n.strip() for n in (os.getenv("KH_EVENTS_BUFFERED_NS") or "").split(",") if n.strip()}
    return ns in names or "*" in names


def publish(ns: str, rows: list[dict]) -> None:
    get_buffer().publish(ns, rows)


def token_ok(header: str, expected: str) -> bool:
    supplied = header[7:].strip() if header.lower().startswith("bearer ") else ""
    return bool(expected) and bool(supplied) and hmac.compare_digest(supplied, expected)
