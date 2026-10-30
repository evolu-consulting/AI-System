"""Task tools: the fixed KH steps of the kernel done by the helper, not by the model (fen 2026-10-29).

The kernel used to teach every model how to call KH: which route, which body, scope at the top AND in
metadata, a real ISO ts, topic == subject, read the row back. A CLI that misread one line wrote a row to
the wrong store. These functions hold that knowledge in code; the MCP tools (mcp_server.py) only take
what the model knows - the text, the project if not the session's, the kind of item - and the model
never needs a route, a store name or KH's layout.

Every function returns (status, body) like Session.call.
"""
from __future__ import annotations

import time
from urllib.parse import urlencode

from .session import Session

SAVE_KINDS = ("fact", "how-to", "reference", "lesson", "feedback", "decision")


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def session_project(session: Session) -> str | None:
    """The project this CLI session is bound to in KH, if any."""
    status, body = session.call("GET", "/session/project")
    if status < 300 and isinstance(body, dict):
        return ((body.get("binding") or {}).get("project")) or None
    return None


def _project(session: Session, project: str) -> str | None:
    return (project or "").strip() or session_project(session)


def step(session: Session, text: str, project: str = "", include_log: bool = False) -> tuple[int, object]:
    body = {"text": text, "include_log": bool(include_log)}
    pid = _project(session, project)
    if pid:
        body["project"] = pid
    return session.call("POST", "/context/step", body)


def plan(session: Session, action: str, project: str = "") -> tuple[int, object]:
    query = {"action": action}
    pid = _project(session, project)
    if pid:
        query["project"] = pid
    return session.call("GET", "/policy/plan?" + urlencode(query))


def _add(session: Session, text: str, scope: str, project: str | None, meta: dict) -> tuple[int, object]:
    metadata = {**meta, "scope": scope, "ts": meta.get("ts") or now_iso()}
    if project:
        metadata["project"] = project
    body = {"text": text, "scope": scope, "metadata": metadata}
    if project:
        body["project"] = project
    status, got = session.call("POST", "/vector/add", body)
    if status >= 300 or not isinstance(got, dict) or not got.get("vector_id"):
        return status, got
    # 'ok' only proves the embedding was computed: read the row back from where it should be.
    back_status, back = session.call("POST", "/vector/scroll", {
        "ids": [got["vector_id"]], "scope": scope, **({"project": project} if project else {})})
    found = back_status < 300 and isinstance(back, dict) and bool(back.get("hits"))
    return (status if found else 500), {**got, "project": project, "scope": scope, "read_back": found}


def save(session: Session, text: str, kind: str = "fact", project: str = "", topic: str = "") -> tuple[int, object]:
    """Knowledge of the person's own; no project and no session project: their personal project."""
    if kind not in SAVE_KINDS:
        return 400, {"error": f"kind must be one of {SAVE_KINDS}"}
    meta = {"kind": kind, "topic": topic or kind}
    return _add(session, text, "knowledge", _project(session, project), meta)


def log(session: Session, text: str, subject: str = "", project: str = "") -> tuple[int, object]:
    """A work log in the session's project (or the person's personal project)."""
    subject = (subject or text.split(".")[0])[:80]
    return _add(session, text, "log", _project(session, project), {"topic": subject, "subject": subject})


def tags_suggest(session: Session, text: str, limit: int = 15) -> tuple[int, object]:
    return session.call("POST", "/kernel/tags/suggest", {"text": text, "limit": limit})


def kernel_rule(session: Session, content: str, tags: list[str], title: str = "", tier: str = "personal",
                overrides: str = "", distinct_from: list[str] | None = None, reason: str = "",
                dry_run: bool = False, slot: str = "", guard: dict | None = None) -> tuple[int, object]:
    body = {"tier": tier or "personal", "title": title, "content": content, "tags": list(tags or [])}
    if slot:
        body["slot"] = slot                      # 1.19.2: edit that rule in place (needs KH 2026-10-30)
    if guard:
        body["guard"] = guard                    # 1.19.2: {tool, decision?, when?}, enforced before the tool runs
    if overrides:
        body["overrides"] = overrides
    if distinct_from:
        body["distinct_from"], body["reason"] = list(distinct_from), reason
    return session.call("POST", "/kernel/rules/check" if dry_run else "/kernel/rules/add", body)


def repeats(session: Session) -> tuple[int, object]:
    return session.call("GET", "/usage/repeats")
