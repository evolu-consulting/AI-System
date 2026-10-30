"""Best-effort KnowledgeHub client. KH is the agents' memory, never a gate:
every call has a short timeout and a failure is logged, not raised, so a slow
or absent KH never stops a run.

The address comes from config only: SDLC_MEMORY_URL (or the older name
SDLC_KH_URL). There is no default: unset means memory is off and every call is
a silent no-op. Use 127.0.0.1 rather than 'localhost' for a local server that
binds IPv4 only (localhost tries ::1 first).
"""

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

KH_URL = (os.environ.get("SDLC_MEMORY_URL") or os.environ.get("SDLC_KH_URL") or "").rstrip("/")
TIMEOUT = 8
log = logging.getLogger("sdlc.kh")


def enabled():
    return bool(KH_URL)


def _call(method, path, body=None, timeout=TIMEOUT):
    if not KH_URL:
        return None
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=True).encode("ascii")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(KH_URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        log.warning("KH %s %s failed: %s", method, path, exc)
        return None


def ts():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def health():
    return bool(_call("GET", "/health", timeout=3))


def ensure_project(pid, name, folder):
    return _call("POST", "/projects", {
        "id": pid,
        "descriptor": "SDLC project '%s' (code folder %s). Managed by the KH SDLC tool (kh-sdlc): agent groups per SDLC step "
                      "store step summaries here as worklogs and decisions as knowledge, keyed project + feature + task." % (name, folder),
        "aliases": [name, "sdlc " + name],
        "keywords": ["sdlc", name.lower()],
    })


def add_log(project, subject, text):
    return _call("POST", "/vector/add", {
        "text": text, "scope": "log",
        "metadata": {"scope": "log", "project": project, "subject": subject, "topic": subject, "ts": ts()},
    })


def add_knowledge(project, subject, topic, text):
    return _call("POST", "/vector/add", {
        "text": text, "scope": "knowledge",
        "metadata": {"scope": "knowledge", "project": project, "subject": subject, "topic": topic, "ts": ts()},
    })


def message(project, content, receiver="all"):
    """Mirror a group-chat line into kh-message, or tell one person (receiver = e-mail).
    On local KH every caller is the same identity, so the agent name travels inside the content."""
    return _call("POST", "/messages", {"project": project, "receiver": receiver or "all", "content": content[:3990]})


def recent(project, limit=10):
    res = _call("GET", "/log/recent?" + urllib.parse.urlencode({"project": project, "limit": limit, "max_chars": 600}))
    out = []
    for h in (res or {}).get("hits") or []:
        md = h.get("metadata") or {}
        out.append({"ts": md.get("ts") or "", "text": (h.get("source_text") or "").strip()})
    return out
