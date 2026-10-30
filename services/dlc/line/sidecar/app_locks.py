"""One agent at a time per app: the engine's locks on resources that exist once.

A signed-in app is one browser tab (DLC Autologin keeps one Chrome per entry; the App Session Manager one
window per app), the cf CLI has one target for the whole machine, and some apps have a single desktop
window for everybody (SAP Logon 64). Two agents driving the same one at once would click into each other's
work. So every page tool of an agent takes the app's lock first:

  acquire(name, holder, label, wait_s)  the holder (an agent call's token) gets it, or waits in line (FIFO)
                                        up to wait_s; still busy -> (False, who holds it, since when, queue)
  release(name, holder) / release_all(holder)
                                        the agent says it is done (release_app), or its call ended (the
                                        engine revokes its token)
  status()                              who holds what (list_apps shows it)

A holder that has not used its lock for IDLE_S loses it, so a crashed agent never blocks the others for
good. In memory: one engine process drives all agents of this machine.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional, Tuple

IDLE_S = 15 * 60
WAIT_S = 120

_cond = threading.Condition()
_held: Dict[str, Dict[str, Any]] = {}      # name -> {"holder", "label", "since", "used"}
_queue: Dict[str, List[str]] = {}          # name -> waiting holders, first in line first


def _expire(now: float) -> None:
    for name in [n for n, h in _held.items() if now - h["used"] > IDLE_S]:
        _held.pop(name, None)
    _cond.notify_all()


def acquire(name: str, holder: str, label: str = "", wait_s: float = WAIT_S,
            clock: Any = time.monotonic) -> Tuple[bool, Dict[str, Any]]:
    """-> (True, the lock) or (False, {"holder_label", "since_s", "waiting"}) after wait_s in line."""
    name = name.lower()
    deadline = clock() + max(wait_s, 0)
    with _cond:
        line = _queue.setdefault(name, [])
        while True:                                      # a holder keeps its place in line between calls
            now = clock()
            _expire(now)
            h = _held.get(name)
            if h and h["holder"] == holder:              # already mine: keep it fresh
                h["used"] = now
                return True, dict(h)
            if h is None and (not line or line[0] == holder):
                if line and line[0] == holder:
                    line.pop(0)
                _held[name] = {"holder": holder, "label": label, "since": now, "used": now}
                _cond.notify_all()
                return True, dict(_held[name])
            if holder not in line:
                line.append(holder)
            left = deadline - now
            if left <= 0:
                h = _held.get(name) or {}
                return False, {"holder_label": h.get("label", "another agent"),
                               "since_s": int(now - h.get("since", now)),
                               "waiting": max(len(line) - 1, 0)}
            _cond.wait(min(left, 5.0))


def leave_line(holder: str) -> None:
    with _cond:
        for line in _queue.values():
            if holder in line:
                line.remove(holder)
        _cond.notify_all()


def release(name: str, holder: str) -> bool:
    name = name.lower()
    with _cond:
        if (_held.get(name) or {}).get("holder") != holder:
            return False
        _held.pop(name, None)
        _cond.notify_all()
        return True


def release_all(holder: str) -> List[str]:
    """Everything this holder has, and its places in line (its agent call ended)."""
    with _cond:
        names = [n for n, h in _held.items() if h["holder"] == holder]
        for n in names:
            _held.pop(n, None)
        for line in _queue.values():
            if holder in line:
                line.remove(holder)
        _cond.notify_all()
        return names


def status(clock: Any = time.monotonic) -> Dict[str, Dict[str, Any]]:
    with _cond:
        now = clock()
        _expire(now)
        return {n: {"label": h["label"], "since_s": int(now - h["since"]), "waiting": len(_queue.get(n) or [])}
                for n, h in _held.items()}


def busy_note(name: str, holder: str = "") -> str:
    """' (in use by X for N s, K waiting)' when someone else holds it, else ''."""
    s = status().get(name.lower())
    if not s:
        return ""
    with _cond:
        if (_held.get(name.lower()) or {}).get("holder") == holder:
            return " (held by you)"
    return " (in use by %s for %ds%s)" % (s["label"] or "another agent", s["since_s"],
                                          ", %d waiting" % s["waiting"] if s["waiting"] else "")


def reset() -> None:
    """Tests only."""
    with _cond:
        _held.clear()
        _queue.clear()


__all__ = ["acquire", "release", "release_all", "leave_line", "status", "busy_note", "reset", "IDLE_S", "WAIT_S"]
