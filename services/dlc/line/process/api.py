"""HTTP side of processes (Admin; every route under /api/admin/ needs the admin role):

    GET  /api/admin/processes                         the registry: id, status, version, owner, flows
    POST /api/admin/processes                         save a draft (the body is the definition, it may extend)
    GET  /api/admin/processes/{id}                    record (versions, history, draft) + impact
    POST /api/admin/processes/{id}:publish            {"reason"} the draft becomes the next version, status active
    POST /api/admin/processes/{id}:status             {"status", "reason"?, "replaced_by"?} deprecate / retire /
                                                      re-activate
    GET  /api/admin/processes/{id}/readiness?project= the needs of the process checked against a project now
    POST /api/admin/projects/{project}/processes      {"flow", "process": "<id>" | "<id>@<n>" | ""} bind a project
    POST /api/admin/runs/{run}:adopt-process          {"process": "<id>@<n>"} a parked run goes on with that version

    handle(method, path, query, body, app, actor) -> (status, payload) | None when the path is not ours
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Tuple

from . import registry

_ONE = re.compile(r"^/api/admin/processes/([A-Za-z0-9_-]+)$")
_PUBLISH = re.compile(r"^/api/admin/processes/([A-Za-z0-9_-]+):publish$")
_STATUS = re.compile(r"^/api/admin/processes/([A-Za-z0-9_-]+):status$")
_READY = re.compile(r"^/api/admin/processes/([A-Za-z0-9_-]+)/readiness$")
_BIND = re.compile(r"^/api/admin/projects/([^/:]+)/processes$")
_ADOPT = re.compile(r"^/api/admin/runs/([^/:]+):adopt-process$")


class _Probe:
    """What line.process.needs.check reads from a run, for a project without a run."""

    def __init__(self, repo: str, rag: Any = None):
        self.repo, self.pack, self.rag = repo, "", rag


def readiness(store: Any, cfg: Any, pid: str, project: str = "") -> Dict[str, Any]:
    from . import definition as D
    from . import needs as N
    from .. import projects
    repo = projects.get(project)["path"] if project else ""
    r = D.select(cfg, repo, "", {"process": pid}, store=store)
    rows = N.check(r, _Probe(repo)) if repo else [dict(n, ok=False, how="no project given", required=n.get(
        "required", "block"), scope=n.get("scope", "project"), kind=n.get("kind", "business")) for n in N.collect(r)]
    later = []
    for row in rows:
        if row["scope"] == "run":
            row.update(ok=True, how="checked when a run starts (it comes with each request)")
        elif not row["ok"] and (row.get("where") or {}).get("store"):
            row.update(ok=True, how="checked when a run starts (the project's knowledge store)")
            later.append(row["id"])
    return {"process": r.ref(), "project": project, "ready": not N.blocking(rows), "needs": rows,
            "checked_at_run_start": later, "table": N.table(rows)}


def bind(pid: str, flow: str, ref: str, store: Any, actor: str = "") -> Dict[str, Any]:
    from .. import projects
    flow = flow.strip().lower()
    if not flow:
        raise ValueError("body needs {\"flow\", \"process\"}")
    if ref:
        registry.usable(store, ref.split("@")[0])
        row = registry.get(store, ref.split("@")[0])
        if "@" in ref and registry.version(row, int(ref.split("@")[1].lstrip("v"))) is None:
            raise ValueError("process %s has no version %s" % tuple(ref.split("@")))
    return projects.bind_process(pid, flow, ref, actor)


def handle(method: str, path: str, query: Dict[str, Any], body: Dict[str, Any], app: Any,
           actor: str = "") -> Optional[Tuple[int, Any]]:
    store, cfg = app.store, app.cfg
    try:
        if path == "/api/admin/processes":
            if method == "GET":
                return 200, {"processes": registry.summaries(store)}
            if method == "POST":
                return 201, registry.save_draft(store, body, actor)
        m = _ONE.match(path)
        if m and method == "GET":
            row = registry.get(store, m.group(1))
            if row is None:
                return 404, {"code": "NOT_FOUND", "message": "process %s" % m.group(1)}
            return 200, {"process": row, "impact": registry.impact(store, m.group(1))}
        m = _PUBLISH.match(path)
        if m and method == "POST":
            return 200, registry.publish(store, m.group(1), actor, str(body.get("reason") or ""), cfg)
        m = _STATUS.match(path)
        if m and method == "POST":
            return 200, registry.set_status(store, m.group(1), str(body.get("status") or ""), actor,
                                            str(body.get("reason") or ""), str(body.get("replaced_by") or ""))
        m = _READY.match(path)
        if m and method == "GET":
            return 200, readiness(store, cfg, m.group(1), str((query.get("project") or [""])[0]))
        m = _BIND.match(path)
        if m and method == "POST":
            return 200, bind(m.group(1), str(body.get("flow") or ""), str(body.get("process") or ""), store, actor)
        m = _ADOPT.match(path)
        if m and method == "POST":
            from .. import gates
            return 200, gates.adopt(store, cfg, m.group(1), str(body.get("process") or ""), actor)
    except KeyError as e:
        return 404, {"code": "NOT_FOUND", "message": "not found: %s" % e}
    except ValueError as e:
        return 400, {"code": "SCHEMA_INVALID", "message": str(e)}
    return None


__all__ = ["handle", "readiness", "bind"]
