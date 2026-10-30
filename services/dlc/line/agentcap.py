"""Process-wide cap on model calls in flight (LINE_MAX_ACTIVE_AGENTS): every run of one server shares it.

    with agent_slot(cfg):          # blocks while `max_active_agents` calls are running; 0 = no cap
        backend.call(...)

One semaphore per cap value, created on first use, so tests with different caps do not share one.
`active()` reports the calls in flight (the board shows it).
"""

from __future__ import annotations

import contextlib
import threading
from typing import Any, Dict, Iterator

_lock = threading.Lock()
_sems: Dict[int, threading.BoundedSemaphore] = {}
_active = 0


def _sem(n: int) -> threading.BoundedSemaphore:
    with _lock:
        s = _sems.get(n)
        if s is None:
            s = _sems[n] = threading.BoundedSemaphore(n)
        return s


def active() -> int:
    return _active


@contextlib.contextmanager
def agent_slot(cfg: Any) -> Iterator[None]:
    global _active
    n = int(getattr(cfg, "max_active_agents", 0) or 0)
    sem = _sem(n) if n > 0 else None
    if sem is not None:
        sem.acquire()
    with _lock:
        _active += 1
    try:
        yield
    finally:
        with _lock:
            _active -= 1
        if sem is not None:
            sem.release()


__all__ = ["agent_slot", "active"]
