"""Cooperative cancel of a run: one token, checked by the builder / verifier / merge loops, and a
store guard so that no worker write lands after the run's terminal event.

    tok = CancelToken()
    ws = GuardedStore(store, tok)        # what builder threads, verifier and watchdog write through
    tok.check()                          # raises Cancelled once tok.cancel() was called
    tok.cancel("operator")               # cooperative stop; kill hooks run once (e.g. LLM subprocesses)
    tok.close()                          # from now on every guarded put / transition / emit is refused

Writes through a GuardedStore hold the token's lock, and close() takes the same lock, so once
close() returned no guarded write is in flight or can start: the pipeline closes the token, then
emits the terminal event (escalated / run.green) through the unguarded store.
"""

from __future__ import annotations

import threading
from typing import Any, Callable, List, Mapping, Optional

from . import codes
from .codes import LineError


class Cancelled(Exception):
    pass


class CancelToken:
    def __init__(self) -> None:
        self._ev = threading.Event()
        self.lock = threading.RLock()
        self.reason = ""
        self.closed = False
        self._hooks: List[Callable[[], None]] = []

    def is_set(self) -> bool:
        return self._ev.is_set()

    def wait(self, timeout: Optional[float] = None) -> bool:
        return self._ev.wait(timeout)

    def on_cancel(self, fn: Callable[[], None]) -> None:
        """fn() runs once when the token is cancelled (at once when it already is)."""
        with self.lock:
            if not self._ev.is_set():
                self._hooks.append(fn)
                return
        _safe(fn)

    def cancel(self, reason: str = "operator") -> None:
        with self.lock:
            if self._ev.is_set():
                return
            self.reason = reason or "operator"
            self._ev.set()
            hooks, self._hooks = self._hooks, []
        for fn in hooks:
            _safe(fn)

    def check(self) -> None:
        if self._ev.is_set():
            raise Cancelled(self.reason)

    def close(self) -> None:
        """Refuse every later guarded write; waits for a guarded write in flight to finish."""
        with self.lock:
            self.closed = True


def _safe(fn: Callable[[], None]) -> None:
    try:
        fn()
    except Exception:   # noqa: BLE001 - a kill hook must never break cancel
        pass


class GuardedStore:
    """A Store view whose writes (put / transition / emit / outbox_push) are refused with
    LineError(CANCELLED) once the token is cancelled or closed. Reads and leases pass through."""

    def __init__(self, store: Any, token: CancelToken):
        self._store = store
        self._token = token

    @property
    def raw(self) -> Any:
        return self._store

    def _write(self, name: str, *args: Any, **kw: Any) -> Any:
        tok = self._token
        with tok.lock:
            if tok.closed or tok.is_set():
                raise LineError(codes.CANCELLED, "run is cancelled or ended: %s refused" % name,
                                {"op": name, "reason": tok.reason})
            return getattr(self._store, name)(*args, **kw)

    def put(self, *args: Any, **kw: Any) -> Any:
        return self._write("put", *args, **kw)

    def transition(self, *args: Any, **kw: Any) -> Any:
        return self._write("transition", *args, **kw)

    def emit(self, kind: str, env: Any, body: Optional[Mapping[str, Any]] = None) -> int:
        return self._write("emit", kind, env, body)

    def outbox_push(self, *args: Any, **kw: Any) -> Any:
        return self._write("outbox_push", *args, **kw)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)


__all__ = ["Cancelled", "CancelToken", "GuardedStore"]
