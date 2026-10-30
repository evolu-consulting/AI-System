"""DLC project <-> project of the engine's knowledge store (the RAG System), mapped by code, never by a model.

Each DLC project has one store project (row field rag_project; default "dlc-<project id>", or an existing
store project the person linked). ensure() gets-or-creates it (POST /projects, with a descriptor saying
where the code is) and adds it to the engine's namespace (PUT /v1/admin/ns/{ns}, read-modify-write under
If-Match), so the run's agents can read and write it. A run of the project then reads and writes that
project; retrieval also reads the shared lessons project (rag_extra "project", e.g. "dlc").

The admin routes are not /v1 namespace routes: they work because the engine's store binds 127.0.0.1 with
sign-in off (deploy kit). Everything here is best effort: with no store (LINE_RAG off) or an error, the run
keeps the shared project as before.
"""

from __future__ import annotations

import dataclasses
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

SYSTEM = {"orchestrator", "lesson-learned", "kh-tools", "personal"}
#: the store project's `source` (RAG System, 2026-10-22): every store project DLC makes says so, and DLC lists only those;
#: projects synced from another RAG System or made by people there carry another source and never show in DLC
SOURCE = "AI-SDLC"
# An agent persona (line.personas) is a store project too, but no one links code to it: it carries the keyword
# 'persona' (seeded ones, and the install guides), and its id is agent-<role>.
PERSONA_KEYWORD = "persona"
PERSONA_PREFIX = "agent-"


def is_persona(pid: str, entry: Optional[Dict[str, Any]] = None) -> bool:
    keywords = {str(k).strip().lower() for k in ((entry or {}).get("keywords") or [])}
    return PERSONA_KEYWORD in keywords or str(pid).startswith(PERSONA_PREFIX)


_ID =re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def enabled(cfg: Any) -> bool:
    return str(getattr(cfg, "rag", "")).lower() == "http" and bool(getattr(cfg, "rag_url", ""))


def shared(cfg: Any) -> str:
    return str((getattr(cfg, "rag_extra", None) or {}).get("project") or getattr(cfg, "rag_ns", ""))


def default_id(pid: str) -> str:
    return "dlc-" + pid


def _http(cfg: Any, method: str, path: str, body: Any = None,
          headers: Optional[Dict[str, str]] = None) -> Tuple[int, Dict[str, Any], Dict[str, str]]:
    url = cfg.rag_url.rstrip("/") + path
    data = None if body is None else json.dumps(body).encode("utf-8")
    h = {"Accept": "application/json", **({"Content-Type": "application/json"} if data is not None else {}),
         **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=float(getattr(cfg, "rag_timeout_s", 15) or 15)) as r:
            text = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(text) if text else {}), dict(r.headers.items())
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode("utf-8", "replace") or "{}")
        except ValueError:
            j = {}
        return e.code, j if isinstance(j, dict) else {}, {}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return 599, {"error": str(e)[:200]}, {}


def descriptor(project: Dict[str, Any], workspace_path: str = "") -> str:
    where = project.get("repo_url") or workspace_path or "a folder the DLC engine keeps"
    text = "DLC project '%s'. Code: %s." % (project.get("name") or project.get("id"), where)
    if project.get("description"):
        text += " " + str(project["description"])
    return text[:1000]


def ensure(cfg: Any, rag_project: str, name: str = "", desc: str = "") -> str:
    """'' when the store project exists and is in the namespace, else why not."""
    if not enabled(cfg):
        return "no knowledge store (LINE_RAG is not http)"
    if not _ID.match(rag_project or ""):
        return "bad store project id %r" % rag_project
    body: Dict[str, Any] = {"id": rag_project, "descriptor": desc, "source": SOURCE}
    if name:
        body["aliases"] = [name]
    st, j, _ = _http(cfg, "POST", "/projects", body)
    if st not in (200, 201):
        return "create store project: HTTP %d %s" % (st, j.get("detail") or j.get("error") or "")
    ns = urllib.parse.quote(cfg.rag_ns)
    for _ in range(3):                                    # read-modify-write; a concurrent change retries
        st, row, hdr = _http(cfg, "GET", "/v1/admin/ns/%s" % ns)
        if st != 200:
            return "read namespace %s: HTTP %d" % (cfg.rag_ns, st)
        have = list(row.get("projects") or [])
        if rag_project in have:
            return ""
        etag = hdr.get("ETag") or hdr.get("Etag") or '"%s"' % row.get("rev", "")
        st, j, _ = _http(cfg, "PUT", "/v1/admin/ns/%s" % ns, {"projects": have + [rag_project]}, {"If-Match": etag})
        if st in (200, 201):
            return ""
        if st not in (409, 412):
            return "add %s to namespace %s: HTTP %d %s" % (rag_project, cfg.rag_ns, st, j.get("message") or "")
    return "namespace %s kept changing; try again" % cfg.rag_ns


def unlinked(cfg: Any, linked: List[str]) -> List[Dict[str, Any]]:
    """Store projects DLC made (source AI-SDLC) that no DLC project uses yet (people's, system and agent persona
    projects left out): history the frontend offers to link to code. Projects of any other source (synced from
    another RAG System, made by people) are never listed; a store older than `source` lists none."""
    if not enabled(cfg):
        return []
    st, j, _ = _http(cfg, "GET", "/projects?source=" + urllib.parse.quote(SOURCE))
    if st != 200:
        return []
    skip = set(linked) | SYSTEM | {shared(cfg)}
    out = []
    for pid, entry in sorted((j.get("projects") or {}).items()):
        e = entry if isinstance(entry, dict) else {}
        if pid in skip or "@" in pid or pid.startswith("personal") or e.get("role") not in (None, "", "project") \
                or is_persona(pid, e) or e.get("source") != SOURCE:
            continue
        out.append({"id": pid, "descriptor": str(e.get("descriptor") or "")[:300],
                    "aliases": list(e.get("aliases") or [])[:5]})
    return out


def run_cfg(cfg: Any, rag_project: str) -> Any:
    """The config a run of this project uses: its store project, plus the shared lessons project."""
    if not rag_project or not enabled(cfg):
        return cfg
    base = shared(cfg)
    extra = dict(cfg.rag_extra or {}, project=rag_project)
    if base and base != rag_project:
        extra["shared_project"] = base
    return dataclasses.replace(cfg, rag_extra=extra)


__all__ = ["SOURCE", "enabled", "shared", "default_id", "descriptor", "ensure", "unlinked", "run_cfg", "is_persona"]
