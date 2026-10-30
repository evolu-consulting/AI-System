"""The process registry: an organisation's processes, kept in the engine store and edited from Admin (API
/api/processes). It is the source of truth for processes; a project's .dlc/process only extends one when the
process allows it ("project_extension": true).

One record per process (contracts.E_PROCESS, id = process id):
    {"id", "status", "draft"?, "versions": [{"v", "def", "by", "ms", "reason", "changes"}], "replaced_by"?,
     "history": [{"what", "by", "ms", "reason"?}]}

    draft       the definition being edited (any shape; checked when it is published)
    publish     the draft becomes version N+1: extends laid out, every prompt it names copied in, validated; a
                published version never changes again
    status      draft (never published) -> active -> deprecated (no new runs, running ones finish) -> retired
                (read only); nothing is ever deleted, so every run keeps the version it ran on
    replaced_by the process that takes over a deprecated / retired one (suggested to projects bound to it)

Learned knowledge is NOT here: precedents, lessons and findings belong to the project (line.process.precedent,
the project's knowledge store), so changing or retiring a process loses none of them.

    save_draft(store, body, actor) / publish(store, pid, actor, reason, cfg, repo) / set_status(store, pid, status,
    actor, reason, replaced_by) / get(store, pid) / summaries(store) / impact(store, pid) / Source(store)
"""

from __future__ import annotations

import copy
import threading
from typing import Any, Dict, List, Optional

from ..contracts import E_PROCESS, E_RUN, TERMINAL_RUN_STATES, now_ms

STATUSES = ("draft", "active", "deprecated", "retired")
MOVES = {"active": ("deprecated", "retired"), "deprecated": ("active", "retired"), "draft": ("retired",),
         "retired": ()}
_lock = threading.Lock()


def get(store: Any, pid: str) -> Optional[Dict[str, Any]]:
    return store.get(E_PROCESS, pid) if store is not None and pid else None


def _put(store: Any, row: Dict[str, Any]) -> Dict[str, Any]:
    store.put(E_PROCESS, row["id"], row)
    return row


def _log(row: Dict[str, Any], what: str, actor: str, reason: str = "") -> None:
    row.setdefault("history", []).append({"what": what, "by": actor or "admin", "ms": now_ms(), "reason": reason})


def latest(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return (row.get("versions") or [None])[-1]


def version(row: Dict[str, Any], v: Optional[int] = None) -> Optional[Dict[str, Any]]:
    if v is None:
        return latest(row)
    return next((x for x in row.get("versions") or [] if int(x.get("v") or 0) == int(v)), None)


def save_draft(store: Any, body: Dict[str, Any], actor: str = "") -> Dict[str, Any]:
    """Create a process (status draft) or replace the draft of an existing one. -> the record"""
    pid = str(body.get("id") or "").strip()
    if not pid or not pid.replace("-", "").replace("_", "").isalnum() or len(pid) > 64:
        raise ValueError("a process needs an id: letters, digits, - and _, at most 64")
    with _lock:
        row = get(store, pid) or {"id": pid, "status": "draft", "versions": []}
        if row.get("status") == "retired":
            raise ValueError("process %s is retired (read only); start a new process instead" % pid)
        row["draft"] = copy.deepcopy(body)
        _log(row, "draft saved", actor)
        return _put(store, row)


def _changes(old: Optional[Dict[str, Any]], new: Dict[str, Any]) -> List[str]:
    """What a person reviewing the version wants to know: steps added / removed / changed, top-level keys changed."""
    if not old:
        return ["first version"]
    out: List[str] = []
    a = {s["id"]: s for s in old.get("steps") or []}
    b = {s["id"]: s for s in new.get("steps") or []}
    out += ["step %s added" % k for k in b if k not in a]
    out += ["step %s removed" % k for k in a if k not in b]
    out += ["step %s changed" % k for k in b if k in a and a[k] != b[k]]
    keys = (set(old) | set(new)) - {"steps", "prompts"}
    out += ["%s changed" % k for k in sorted(keys) if old.get(k) != new.get(k)]
    if (old.get("prompts") or {}) != (new.get("prompts") or {}):
        out.append("prompts changed")
    return out or ["no change"]


def publish(store: Any, pid: str, actor: str = "", reason: str = "", cfg: Any = None, repo: str = "") -> Dict[str, Any]:
    """The draft becomes the next version (laid out, prompts copied in, validated) and the process is active."""
    from . import definition as D
    with _lock:
        row = get(store, pid)
        if not row:
            raise KeyError(pid)
        if row.get("status") == "retired":
            raise ValueError("process %s is retired (read only)" % pid)
        draft = row.get("draft")
        if not draft:
            raise ValueError("process %s has no draft to publish" % pid)
        r = D.resolve_inline(cfg, repo, dict(draft, id=pid), store=store)
        data = dict(r.data, prompts=dict(r.prompts))
        prev = latest(row)
        v = int(prev["v"]) + 1 if prev else 1
        row.setdefault("versions", []).append({"v": v, "def": data, "by": actor or "admin", "ms": now_ms(),
                                               "reason": reason, "changes": _changes(prev and prev["def"], data)})
        row.pop("draft", None)
        row["status"] = "active"
        _log(row, "published v%d" % v, actor, reason)
        return _put(store, row)


def set_status(store: Any, pid: str, status: str, actor: str = "", reason: str = "",
               replaced_by: str = "") -> Dict[str, Any]:
    with _lock:
        row = get(store, pid)
        if not row:
            raise KeyError(pid)
        cur = str(row.get("status") or "draft")
        if status not in STATUSES or status not in MOVES.get(cur, ()):
            raise ValueError("process %s is %s: it can go to %s" % (pid, cur, ", ".join(MOVES.get(cur, ())) or "nothing"))
        if status == "active" and not row.get("versions"):
            raise ValueError("process %s has no published version" % pid)
        if replaced_by:
            nxt = get(store, replaced_by)
            if not nxt or nxt.get("status") != "active":
                raise ValueError("replaced_by %s is not an active process" % replaced_by)
            row["replaced_by"] = replaced_by
        row["status"] = status
        _log(row, status, actor, reason)
        return _put(store, row)


def usable(store: Any, pid: str) -> Dict[str, Any]:
    """The record of a process a NEW run may use; ValueError naming the successor when it may not."""
    row = get(store, pid)
    if not row:
        raise ValueError("process %s does not exist" % pid)
    st = row.get("status")
    if st != "active":
        nxt = row.get("replaced_by")
        raise ValueError("process %s is %s%s" % (pid, st, ("; use %s instead" % nxt) if nxt else
                                                 ("; it has no published version" if st == "draft" else "")))
    return row


def summaries(store: Any) -> List[Dict[str, Any]]:
    out = []
    for row in store.query(E_PROCESS) if store is not None else []:
        last = latest(row) or {}
        d = last.get("def") or row.get("draft") or {}
        out.append({"id": row["id"], "status": row.get("status"), "version": last.get("v") or 0,
                    "title": d.get("title") or row["id"], "owner": d.get("owner") or "",
                    "flows": (d.get("applies") or {}).get("flows") or [], "has_draft": bool(row.get("draft")),
                    "replaced_by": row.get("replaced_by") or "", "updated": (row.get("history") or [{}])[-1].get("ms")})
    return out


def runs_on(store: Any, pid: str) -> List[Dict[str, Any]]:
    """Every run that froze this process: run, state, version, live."""
    out = []
    for r in store.query(E_RUN):
        snap = ((r.get("detail") or {}).get("gated") or {}).get("process") or {}
        if snap.get("id") == pid:
            out.append({"run": r.get("id"), "state": r.get("state"), "version": snap.get("version"),
                        "live": r.get("state") not in TERMINAL_RUN_STATES,
                        "at": ((r.get("detail") or {}).get("gate") or {}).get("name") or ""})
    return out


def impact(store: Any, pid: str) -> Dict[str, Any]:
    """What a new version or a status change touches: runs in progress per version, projects bound to it."""
    from .. import projects
    runs = runs_on(store, pid)
    bound = []
    for p in projects.all_rows():
        for flow, ref in (p.get("processes") or {}).items():
            if str(ref).split("@")[0] == pid:
                bound.append({"project": p.get("id"), "flow": flow, "binding": ref})
    by_version: Dict[str, int] = {}
    for r in runs:
        if r["live"]:
            by_version[str(r["version"])] = by_version.get(str(r["version"]), 0) + 1
    return {"process": pid, "live_runs": [r for r in runs if r["live"]], "live_by_version": by_version,
            "runs": len(runs), "projects": bound}


class Source:
    """definition source "registry": the latest version of every active process (prompts inline)."""
    name = "registry"

    def __init__(self, store: Any):
        self.store = store

    def definitions(self) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        for row in self.store.query(E_PROCESS) if self.store is not None else []:
            last = latest(row)
            if row.get("status") == "active" and last:
                out[row["id"]] = dict(last["def"], _version=last["v"])
        return out

    def prompt(self, name: str) -> Optional[str]:
        return None


__all__ = ["save_draft", "publish", "set_status", "get", "summaries", "impact", "runs_on", "usable", "Source",
           "version", "latest", "STATUSES"]
