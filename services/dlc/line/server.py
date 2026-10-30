"""Line server: JSON API + board page (stdlib ThreadingHTTPServer, 127.0.0.1:<cfg.port>, default 8796).

GET  /                              board.html
GET  /api/health                    {"ok", "service", "version", "last_seq", "time_ms", "driver"}
GET  /api/openapi.json              OpenAPI 3 description generated from line.api_spec.ROUTES
POST /api/packs  {"kind": new|enhance|bug, "name", "spec" | bug fields}  -> 201 {"pack"} (pack under DLC_HOME/packs)

Only routes listed in line.api_spec.ROUTES are served (anything else under /api answers 404), so the
published description and the served API cannot drift. Sign-in: with LINE_AUTH_ISSUER set (an OIDC realm,
e.g. Keycloak) every route except /api/health, /api/openapi.json and /api/auth/config needs
'Authorization: Bearer <access token>' (line.auth: RS256 against the realm keys, iss / exp / aud, role
LINE_AUTH_ROLE_USER; cancel and app stop need LINE_AUTH_ROLE_ADMIN); 401 / 403 answer JSON errors. Without
it the API is open. CORS: an Origin listed in LINE_CORS_ORIGINS (comma separated, default none) gets
Access-Control-Allow-* headers.

Frontend projections (line.runview, line.appctl):
POST /api/runs/{id}:pause | :resume   operator pause at any time / resume from where it stopped
GET  /api/runs/{id}/nodes             stage nodes; .../nodes/{node}/worklog the agents' entries of one node
GET  /api/runs/{id}/reports           spec files + generated reports; .../reports/{rid} one report's text
GET  /api/runs/{id}/app               the deployed app; POST .../app:start | app:stop
GET  /api/projects | /api/projects/{id}   projects (line.projects): the engine keeps one repository per project;
POST /api/projects {"name"}               POST /api/runs {"pack", "project"} runs on it (no server paths)
GET  /api/workspace?path=P               folders under the workspace root a project can start from
GET  /api/rag-projects                    RAG System projects no DLC project is linked to yet (line.ragmap)
POST /api/agent/<tool>                  an agent's tool call from `dlc mcp` (line.agent_tools; loopback + call token)
GET  /api/admin/sidecars                 satellite tools; .../autologin entries (line.sidecar; admin)
GET  /api/admin/claude-token             POST {"token"}: the agents' Claude setup-token (line.claude_token; admin)
GET  /api/admin/change-queue             POST {"wait_minutes"}: the change queues and their wait limit (line.changequeue)
GET  /api/projects/{id}/queue            the project's change queue: runs waiting to change the repository, in order
GET  /api/admin/hooks                    run hooks: POST add, .../{id} change, :delete, :test (line.hooks; admin)
GET  /api/runs/{id}/hooks                the run's hook results; POST .../hooks/{event}/{hook}:pass lets a held run go
GET  /api/runs                      {"runs": [run summary]}
GET  /api/runs/{id}                 {"run", "units", "gates", "budget", "merge", "deploy", "qas", "escalations"}
GET  /api/runs/{id}/events?after_seq=N&limit=M
                                    {"run", "events": [event], "last_seq"}
GET  /api/board[?run=id]            {"generated_ms", "runs", "run", "lanes", "units", "gates",
                                     "deploy", "qas", "events"}   (selected run: ?run or newest)
GET  /api/runs/{id}/questions       {"run", "parked", "park", "questions"}   (understand_plus human round)
GET  /api/metrics[?run=&limit=]     outcome metrics (line.observe.METRICS_SPEC)
POST /api/runs        {"pack": path}     -> driver("start", {"pack": ...})
POST /api/runs/{id}:cancel  {reason?}    -> driver("cancel", {"run": id, "reason": ...})
GET  /api/migrations                 {"migrations": [summary]}          (feature migration, flow 4)
GET  /api/migrations/{id}            {"migration", "features", "conflicts", "questions", "run"?}
POST /api/migrations   {"v1","v2","v1_ref"?,"v1_base"?,"v2_ref"?,"notes"?,"mode"?,"scope"?,"build"?,
                         "v1_repos"?,"v2_repos"?}   v1/v2: a repository or a folder of repositories (estate)
                                    -> driver("migrate_start", body) -> 202 {"migration", "state"}
POST /api/migrations/{id}/answers {"answers": [{"conflict","choice": "v2"|"v1"}], "who"}
GET  /api/migrations/{id}/details    {"repos": {v1, v2}, "blast", "effort", "decisions", "baseline", "verify",
                                      "runs", "timeline"}   (the board's migration view; fixed artefact names only)
GET  /api/migrations/{id}/report     {"migration", "report": report.md text, "ready"}
POST /api/migrations/{id}:resume {"max_usd"?, "max_usd_repo"?, "rescan"?}
                                    -> driver("migrate_resume", ...): a migration stopped on MIGRATION_BUDGET goes
                                       back to the stage it stopped in (after raising the cap); otherwise it is
                                       driven on from where it is
                                    -> driver("migrate_answer", ...) (continues when none is open)
POST /api/runs/{id}/answers {"qid","option","text"?,"who"} | {"answers": [...], "who"}
POST /api/runs/{id}/gates/{gate} {"decision","note"?,"target"?,"files"?,"answers"?}   the gated flow's person steps
                                (line.gates); answers: [{artifact, id, ok, text}] for the points to confirm
POST /api/runs/{id}/gates/{gate}/chat {"message","who"?}   talk with the step's agents at an open gate whose
                                definition says chat: true (line.gatechat); 202, the answer comes on a thread
POST /api/docs:convert {"name","data"}   a PDF / Word document as markdown (line.docread)
                                    -> {"results", "remaining", "addendum", "version", "resume"}; when the
                                       last open question is answered ("resume": true) the run is resumed
                                       through driver("resume", {"run": id}) ("resumed" in the answer)
GET  /api/runs/{id}/seals           {"run", "seals": [seal row]}   (LINE_SEAL=1: one row per unit attempt)
POST /api/runs/{id}/seals/{subject}:sign  {"who", "option": "sign"|"refuse"} -> {"seal", "resumed"?}
                                    an L2 seal waiting for a person (subject "<run>:<unit>#<n>", URL-encoded);
                                    the run is resumed through driver("resume") afterwards

The driver is an injectable callable ``driver(action, payload) -> dict`` (the
pipeline wires it later). Without one the POST routes answer 501. A LineError
from the driver maps to 404 (NOT_FOUND), 409 (STATE_CONFLICT / ILLEGAL_TRANSITION)
or 400 (anything else), body = LineError.to_dict().

The board is a projection: everything comes from Store rows and events.

    python -m line.server            (from Slaves/SDLC; uses line.store and, if present, line.pipeline)
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from . import __version__, codes
from .codes import LineError
from .config import LINE_DIR, Config, load_config
from .contracts import (
    E_ACC_TEST, E_DEPLOY, E_ESCALATION, E_FITEM, E_GATE, E_LLM_CALL, E_MERGE, E_QAS, E_RUN, E_UNIT,
    UnitState, now_ms, to_dict,
)

Driver = Callable[[str, Dict[str, Any]], Dict[str, Any]]

BOARD_HTML = os.path.join(LINE_DIR, "board.html")
RECENT_EVENTS = 40

#: board lanes for F-items, left to right
F_LANES = ["pending", "building", "verifying", "merged", "green", "flaky", "red", "failed"]


# ------------------------------------------------------------------ projections


def _runs(store: Any) -> List[Dict[str, Any]]:
    rows = store.query(E_RUN)
    rows.sort(key=lambda r: (int(r.get("created_ms", 0) or 0), r.get("id", "")), reverse=True)
    return rows


def run_summary(store: Any, row: Dict[str, Any]) -> Dict[str, Any]:
    units = store.query(E_UNIT, run=row["id"])
    counts: Dict[str, int] = {}
    for u in units:
        counts[u.get("state", "?")] = counts.get(u.get("state", "?"), 0) + 1
    detail = row.get("detail") or {}
    # merged units whose work was already on main (no changes): counted in merged, named apart
    satisfied = sum(1 for u in units if u.get("state") == "merged" and (u.get("detail") or {}).get("nothing_to_merge"))
    return {"id": row["id"], "state": row.get("state", ""), "pack_path": row.get("pack_path", ""),
            "name": detail.get("name") or "", "flow": detail.get("flow") or "", "actor": detail.get("actor") or "",
            "human_mode": detail.get("human_mode") or "", "paused": bool(detail.get("paused")),
            "spec_hash": row.get("spec_hash", ""), "created_ms": row.get("created_ms", 0),
            "updated_ms": row.get("updated_ms", 0), "budget_usd": row.get("budget_usd", 0.0),
            "units": len(units), "unit_states": counts, "nothing_to_merge": satisfied, "detail": row.get("detail", {})}


def budget_view(store: Any, run: Dict[str, Any], budget: Any = None) -> Dict[str, Any]:
    spent = sum(float(c.get("usd", 0) or 0) for c in store.query(E_LLM_CALL, run=run["id"]))
    out = {"limit": float(run.get("budget_usd", 0) or 0), "spent": round(spent, 6), "reserved": 0.0,
           "source": "ledger"}
    if budget is not None:
        try:
            st = budget.state(run["id"], run["id"])
            out = {"limit": st.limit, "spent": st.spent, "reserved": st.reserved, "warn": st.warn,
                   "remaining": st.remaining, "source": "budget"}
        except Exception:   # noqa: BLE001 - budget tree not opened for this run yet
            pass
    lim = out["limit"]
    out["ratio"] = round((out["spent"] + out.get("reserved", 0.0)) / lim, 4) if lim else 0.0
    return out


def _gates(store: Any, run: str) -> List[Dict[str, Any]]:
    out = []
    for g in store.query(E_GATE, run=run):
        gate = g.get("gate") or {}
        out.append({"id": g.get("id", ""), "name": g.get("name", ""), "unit": g.get("unit", ""),
                    "attempt": g.get("attempt", 0), "ok": bool(gate.get("ok")), "code": gate.get("code", ""),
                    "fingerprint": gate.get("fingerprint", "")})
    return out


def _unit_view(u: Dict[str, Any]) -> Dict[str, Any]:
    keys = ("id", "title", "state", "wave", "f_items", "tests", "claims", "deps", "size", "attempt", "epoch",
            "model", "rung", "fixer_gen", "contract")
    return {k: u.get(k) for k in keys}


def _f_state(units: List[Dict[str, Any]], qas: Optional[Dict[str, Any]]) -> str:
    if qas:
        return qas.get("verdict", "red")
    states = [u.get("state") for u in units]
    if not states:
        return "pending"
    if all(s == UnitState.MERGED.value for s in states):
        return "merged"
    if any(s == UnitState.FAILED.value for s in states):
        return "failed"
    if any(s in (UnitState.LEASED.value, UnitState.WAITING.value) for s in states):
        return "building"
    if any(s in (UnitState.SUBMITTED.value, UnitState.VERIFIED.value) for s in states):
        return "verifying"
    if any(s == UnitState.MERGED.value for s in states):
        return "building"
    return "pending"


def lanes(store: Any, run: str) -> Dict[str, Any]:
    units = store.query(E_UNIT, run=run)
    qas = {q.get("f_item"): q for q in store.query(E_QAS, run=run)}
    titles: Dict[str, str] = {}
    order: List[str] = []
    for f in store.query(E_FITEM, run=run):
        fid = f.get("id")
        if fid and fid not in titles:
            titles[fid] = f.get("title", "")
            order.append(fid)
    for u in units:
        for fid in u.get("f_items") or []:
            if fid not in titles:
                titles[fid] = ""
                order.append(fid)
    for fid in qas:
        if fid and fid not in titles:
            titles[fid] = ""
            order.append(fid)
    rows = []
    for fid in order:
        mine = [u for u in units if fid in (u.get("f_items") or [])]
        q = qas.get(fid)
        rows.append({"f_item": fid, "title": titles.get(fid, ""), "state": _f_state(mine, q),
                     "units": [{"id": u.get("id"), "state": u.get("state")} for u in mine],
                     "qas": {"runs": q.get("runs"), "verdict": q.get("verdict"), "quarantined": q.get("quarantined")}
                     if q else None})
    return {"columns": F_LANES, "rows": rows}


def _events(store: Any, run: Optional[str], after_seq: int = -1, limit: int = RECENT_EVENTS) -> List[Dict[str, Any]]:
    if after_seq >= 0:
        evs = store.events_after(after_seq, run=run, limit=limit)
    else:   # most recent ``limit`` events, scanning back a bounded window
        last = store.last_seq()
        evs = store.events_after(max(0, last - max(limit * 25, 1000)), run=run, limit=100000)[-limit:]
    return [to_dict(e) for e in evs]


def run_detail(store: Any, run_id: str, budget: Any = None) -> Optional[Dict[str, Any]]:
    row = store.get(E_RUN, run_id)
    if row is None:
        return None
    return {
        "run": run_summary(store, row),
        "units": [_unit_view(u) for u in store.query(E_UNIT, run=run_id)],
        "gates": _gates(store, run_id),
        "budget": budget_view(store, row, budget),
        "merge": store.query(E_MERGE, run=run_id),
        "deploy": store.query(E_DEPLOY, run=run_id),
        "qas": store.query(E_QAS, run=run_id),
        "tests": len(store.query(E_ACC_TEST, run=run_id)),
        "escalations": store.query(E_ESCALATION, run=run_id),
    }


def questions_view(store: Any, run_id: str) -> Dict[str, Any]:
    """Open / held / answered human questions of a run and its park state (understand_plus)."""
    try:
        from .understand_plus.human import api_questions
        q = api_questions(store, run_id)
    except Exception:   # noqa: BLE001 - the board never fails on this panel
        return {"parked": False, "park": None, "questions": []}
    keep = ("id", "qid", "state", "kind", "decision", "options", "recommended", "f_items", "due_ms", "answer",
            "addendum")
    return {"parked": q.get("parked", False), "park": q.get("park"),
            "questions": [{k: r.get(k) for k in keep if k in r} for r in q.get("questions") or []]}


def board(store: Any, run_id: Optional[str] = None, budget: Any = None) -> Dict[str, Any]:
    runs = _runs(store)
    sel = run_id or (runs[0]["id"] if runs else None)
    out: Dict[str, Any] = {"generated_ms": now_ms(), "last_seq": store.last_seq(),
                           "runs": [run_summary(store, r) for r in runs], "run": None,
                           "lanes": {"columns": F_LANES, "rows": []}, "units": [], "gates": [], "deploy": [],
                           "qas": [], "escalations": [], "budget": None, "events": [],
                           "human": {"parked": False, "park": None, "questions": []}}
    row = store.get(E_RUN, sel) if sel else None
    if row is None:
        out["events"] = _events(store, None)
        return out
    out.update({
        "run": run_summary(store, row),
        "lanes": lanes(store, sel),
        "units": [_unit_view(u) for u in store.query(E_UNIT, run=sel)],
        "gates": _gates(store, sel),
        "deploy": store.query(E_DEPLOY, run=sel),
        "qas": store.query(E_QAS, run=sel),
        "escalations": store.query(E_ESCALATION, run=sel),
        "budget": budget_view(store, row, budget),
        "events": _events(store, sel),
        "human": questions_view(store, sel),
    })
    from .contracts import E_SEAL
    seals = store.query(E_SEAL, run=sel)
    if seals:                                   # LINE_SEAL=1 runs: seal state per unit attempt
        keep = ("id", "unit", "attempt", "ledger_state", "rt_state", "total", "level", "docked", "reasons",
                "spec_on", "tainted_by", "signed_by", "refused_by", "final")
        out["seals"] = [{k: r.get(k) for k in keep if k in r}
                        for r in sorted(seals, key=lambda r: (str(r.get("unit", "")), int(r.get("attempt") or 0)))]
    return out


# ------------------------------------------------------------------ HTTP


_HTTP_FOR_CODE = {codes.NOT_FOUND: 404, codes.STATE_CONFLICT: 409, codes.ILLEGAL_TRANSITION: 409,
                  codes.CANCELLED: 409}

_RE_RUN = re.compile(r"^/api/runs/([^/:]+)$")
_RE_EVENTS = re.compile(r"^/api/runs/([^/:]+)/events$")
_RE_CANCEL = re.compile(r"^/api/runs/([^/:]+):cancel$")
_RE_QUESTIONS = re.compile(r"^/api/runs/([^/:]+)/questions$")
_RE_ANSWERS = re.compile(r"^/api/runs/([^/:]+)/answers$")
_RE_PROCESS = re.compile(r"^/api/runs/([^/:]+)/process$")
_RE_PROCESS_FORM = re.compile(r"^/api/runs/([^/:]+)/process/forms/([^/:]+)$")
_RE_SEALS = re.compile(r"^/api/runs/([^/:]+)/seals$")
_RE_SEAL_SIGN = re.compile(r"^/api/runs/([^/:]+)/seals/(.+):sign$")
_RE_MIG = re.compile(r"^/api/migrations/([^/:]+)$")
_RE_MIG_ANSWERS = re.compile(r"^/api/migrations/([^/:]+)/answers$")
_RE_MIG_DETAILS = re.compile(r"^/api/migrations/([^/:]+)/details$")
_RE_MIG_REPORT = re.compile(r"^/api/migrations/([^/:]+)/report$")
_RE_MIG_RESUME = re.compile(r"^/api/migrations/([^/:]+):resume$")
_RE_PAUSE = re.compile(r"^/api/runs/([^/:]+):pause$")
_RE_RETRO = re.compile(r"^/api/runs/([^/:]+):retro$")
_RE_ATTENTION = re.compile(r"^/api/runs/([^/:]+)/attention$")
_RE_BOARD = re.compile(r"^/api/runs/([^/:]+)/board$")
_RE_ATTN_ACT = re.compile(r"^/api/runs/([^/:]+):(resolve|retry|explain)$")
URGENT_STOP_CONFIRM = "agree force stop"     # typed by the person: an urgent stop is never one click
_RE_RESUME = re.compile(r"^/api/runs/([^/:]+):resume$")
_RE_NODES = re.compile(r"^/api/runs/([^/:]+)/nodes$")
_RE_WORKLOG = re.compile(r"^/api/runs/([^/:]+)/nodes/([^/:]+)/worklog$")
_RE_REPORTS = re.compile(r"^/api/runs/([^/:]+)/reports$")
_RE_REPORT = re.compile(r"^/api/runs/([^/:]+)/reports/([^/:]+)$")
_RE_APP = re.compile(r"^/api/runs/([^/:]+)/app$")
_RE_APP_START = re.compile(r"^/api/runs/([^/:]+)/app:start$")
_RE_APP_STOP = re.compile(r"^/api/runs/([^/:]+)/app:stop$")
_RE_APP_BUILD = re.compile(r"^/api/runs/([^/:]+)/app:build$")
_RE_APP_DOWNLOAD = re.compile(r"^/api/runs/([^/:]+)/app/download$")
_RE_PROJECT = re.compile(r"^/api/projects/([^/:]+)$")
_RE_PROJECT_QUEUE = re.compile(r"^/api/projects/([^/:]+)/queue$")
_RE_DELIVER = re.compile(r"^/api/projects/([^/:]+):deliver$")
_RE_PROJECT_CLOSE = re.compile(r"^/api/projects/([^/:]+):(close|reopen)$")
_RE_AGENT = re.compile(r"^/api/agent/([a-z_]+)$")
_RE_AUTOLOGIN = re.compile(r"^/api/admin/sidecars/autologin/(\d+)(:delete|:test)?$")
_RE_HOOK = re.compile(r"^/api/admin/hooks/(\d+)(:delete|:test)?$")
_RE_RUN_HOOKS = re.compile(r"^/api/runs/([^/:]+)/hooks$")
_RE_HOOK_PASS = re.compile(r"^/api/runs/([^/:]+)/hooks/([a-z_]+)/(\d+):pass$")
_RE_DECISIONS = re.compile(r"^/api/runs/([^/:]+)/decisions$")
_RE_GATE = re.compile(r"^/api/runs/([^/:]+)/gates/([a-z0-9_-]+)$")
_RE_GATE_CHAT = re.compile(r"^/api/runs/([^/:]+)/gates/([a-z0-9_-]+)/chat$")


class _Handler(BaseHTTPRequestHandler):
    server_version = "sdlc-line/" + __version__
    app: "LineServer"   # set on the subclass

    def log_message(self, fmt: str, *args: Any) -> None:   # quiet; the board polls every 3 s
        if self.app.verbose:
            sys.stderr.write("line.server: " + (fmt % args) + "\n")

    def _send(self, status: int, payload: Any, ctype: str = "application/json; charset=utf-8") -> None:
        body = payload if isinstance(payload, bytes) else json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: str, ctype: str) -> None:
        """A file as an attachment, streamed in chunks (a built app can be large)."""
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", 'attachment; filename="%s"' % os.path.basename(path).replace('"', ""))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def _cors(self) -> None:
        origin = self.headers.get("Origin") if self.headers else None
        if origin and origin in self.app.cors_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Max-Age", "600")

    def do_OPTIONS(self) -> None:   # noqa: N802 - CORS preflight
        origin = self.headers.get("Origin")
        allowed = bool(origin and origin in self.app.cors_origins)
        self.send_response(204 if allowed else 403)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def _unrouted(self, method: str, path: str) -> bool:
        """True (and answered 404) when an /api path is not in the published route table."""
        from . import api_spec
        if path.startswith("/api") and api_spec.match(method, path) is None:
            try:            # read the unread request body first: closing on it makes Windows reset the connection
                n = int(self.headers.get("Content-Length") or 0)
                if 0 < n <= (1 << 20):
                    self.rfile.read(n)
            except (OSError, ValueError):
                pass
            self._error(404, codes.NOT_FOUND, "no route %s %s" % (method, path))
            return True
        return False

    def _error(self, status: int, code: str, message: str, detail: Optional[Dict[str, Any]] = None) -> None:
        self._send(status, {"code": code, "message": message, "detail": detail or {}})

    claims: Optional[Dict[str, Any]] = None

    @property
    def actor(self) -> str:
        from .auth import actor
        return actor(self.claims)

    def _auth(self, method: str, path: str) -> bool:
        """True when the request may go on (sign-in off, an open route, or a valid token with the role);
        otherwise the 401 / 403 / 503 answer is sent and False returned."""
        self.claims = None
        v = self.app.verifier
        if v is None or path in ("/", "/board", "/board.html"):
            return True
        from . import api_spec
        from .auth import AuthError, admin_route, bearer
        r = api_spec.match(method, path)
        if r is not None and r.template in api_spec.PUBLIC_TEMPLATES:
            return True
        token = bearer(self.headers.get("Authorization"))
        try:
            if not token:
                raise AuthError(401, "UNAUTHENTICATED", "missing bearer token")
            claims = v.verify(token)
            v.require(claims, admin=admin_route(method, path))
            self.claims = claims
            return True
        except AuthError as e:
            body = json.dumps(e.to_dict()).encode("utf-8")
            self.send_response(e.status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if e.status == 401:
                self.send_header("WWW-Authenticate", 'Bearer realm="dlc", error="invalid_token"')
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return False

    def _body(self) -> Dict[str, Any]:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        data = json.loads(self.rfile.read(n).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("body is not a JSON object")
        return data

    def do_GET(self) -> None:   # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = u.path.rstrip("/") or "/"
        store = self.app.store
        try:
            if path in ("/", "/board", "/board.html"):
                try:
                    with open(BOARD_HTML, "rb") as fh:
                        self._send(200, fh.read(), "text/html; charset=utf-8")
                except OSError:
                    self._error(404, codes.NOT_FOUND, "board.html missing")
                return
            if self._unrouted("GET", path) or not self._auth("GET", path):
                return
            if path.startswith("/api/admin/processes"):
                from .process import api as process_api
                out = process_api.handle("GET", path, q, {}, self.app, self.actor)
                if out is not None:
                    self._send(*out)
                    return
            if path == "/api/auth/config":
                cfg = self.app.cfg
                if self.app.verifier is None:
                    self._send(200, {"enabled": False})
                else:
                    self._send(200, {"enabled": True, "issuer": self.app.verifier.issuer,
                                     "client_id": cfg.auth_board_client, "audience": cfg.auth_audience,
                                     "role_user": cfg.auth_role_user, "role_admin": cfg.auth_role_admin})
                return
            if path == "/api/me":
                v = self.app.verifier
                if v is None:
                    self._send(200, {"enabled": False, "actor": "", "roles": [], "admin": True})
                else:
                    roles = sorted(v.roles(self.claims or {}))
                    self._send(200, {"enabled": True, "actor": self.actor, "roles": roles,
                                     "admin": v.role_admin in roles})
                return
            m = _RE_NODES.match(path)
            if m:
                from .runview import nodes
                row = store.get(E_RUN, m.group(1))
                if row is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                self._send(200, {"run": m.group(1), "state": row.get("state", ""),
                                 "paused": bool((row.get("detail") or {}).get("paused")),
                                 "nodes": nodes(store, m.group(1))})
                return
            m = _RE_BOARD.match(path)
            if m:
                if store.get(E_RUN, m.group(1)) is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                from . import agent_messages, runboard
                self._send(200, {"run": m.group(1), "board": runboard.board(store, m.group(1)),
                                 "messages": agent_messages.thread(store, m.group(1))})
                return
            m = _RE_DECISIONS.match(path)
            if m:
                from . import decisions
                try:
                    out = decisions.view(store, m.group(1), (q.get("doc") or [""])[0])
                except KeyError:
                    self._error(404, codes.NOT_FOUND, "no such document in the run's decision history")
                    return
                if out is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                self._send(200, out)
                return
            m = _RE_ATTENTION.match(path)
            if m:
                if store.get(E_RUN, m.group(1)) is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                from . import attention
                self._send(200, attention.view(store, m.group(1)))
                return
            m = _RE_WORKLOG.match(path)
            if m:
                from .runview import worklog
                limit = max(1, min(int((q.get("limit") or ["1000"])[0]), 5000))
                self._send(200, {"run": m.group(1), "node": m.group(2),
                                 "entries": worklog(store, m.group(1), m.group(2), limit)})
                return
            m = _RE_REPORTS.match(path)
            if m:
                from .runview import reports
                self._send(200, {"run": m.group(1), "reports": reports(store, m.group(1))})
                return
            m = _RE_REPORT.match(path)
            if m:
                from .runview import report
                self._send(200, report(store, m.group(1), m.group(2)))
                return
            m = _RE_APP.match(path)
            if m:
                from . import appctl
                self._send(200, appctl.status_full(store, self.app.cfg, m.group(1)))
                return
            m = _RE_APP_DOWNLOAD.match(path)
            if m:
                from . import appctl
                self._send_file(appctl.download_path(store, self.app.cfg, m.group(1)), "application/zip")
                return
            if path == "/api/openapi.json":
                from .api_spec import openapi
                self._send(200, openapi(self.app.url))
                return
            if path == "/api/health":
                self._send(200, {"ok": True, "service": "sdlc-line", "version": __version__,
                                 "host": self.app.host, "port": self.app.port, "last_seq": store.last_seq(),
                                 "time_ms": now_ms(), "driver": self.app.driver is not None})
                return
            if path == "/api/runs":
                self._send(200, {"runs": [run_summary(store, r) for r in _runs(store)]})
                return
            if path == "/api/projects":
                from . import projects
                closed = (q.get("closed") or [""])[0] in ("1", "true", "yes")
                self._send(200, {"projects": projects.list_all(store, run_summary, closed=closed)})
                return
            m = _RE_PROJECT.match(path)
            if m:
                from . import projects
                self._send(200, projects.detail(store, m.group(1), run_summary))
                return
            m = _RE_PROJECT_QUEUE.match(path)
            if m:
                from . import changequeue, projects
                projects.get(m.group(1))
                self._send(200, changequeue.view(store, m.group(1)))
                return
            if path == "/api/admin/change-queue":
                from . import changequeue, projects
                self._send(200, dict(changequeue.settings(), projects=[changequeue.view(store, r["id"])
                                                                        for r in projects.all_rows()]))
                return
            if path == "/api/catalog":
                from . import catalog
                self._send(200, catalog.catalog(self.app.cfg, store))
                return
            if path == "/api/workspace":
                from . import projects
                self._send(200, projects.workspace((q.get("path") or [""])[0]))
                return
            if path == "/api/rag-projects":
                from . import ragmap, projects
                linked = [projects.rag_of(r) for r in projects.all_rows()]
                self._send(200, {"projects": ragmap.unlinked(self.app.cfg, linked)})
                return
            if path == "/api/admin/claude-token":
                from . import claude_token
                self._send(200, claude_token.status())
                return
            if path == "/api/admin/sidecars":
                from . import sidecar
                self._send(200, {"sidecars": sidecar.listing()})
                return
            if path == "/api/admin/hooks":
                from . import hooks
                self._send(200, hooks.admin_view())
                return
            m = _RE_RUN_HOOKS.match(path)
            if m:
                from . import hooks
                if store.get(E_RUN, m.group(1)) is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                self._send(200, {"run": m.group(1), "results": hooks.results(m.group(1)),
                                 "hold": ((store.get(E_RUN, m.group(1)) or {}).get("detail") or {}).get("hook_hold")})
                return
            if path == "/api/admin/sidecars/autologin":
                from .sidecar import autologin
                self._send(200, {"entries": autologin.public_entries(), "groups": list(autologin.GROUPS),
                                 "kinds": list(autologin.KINDS)})
                return
            if path == "/api/board":
                self._send(200, board(store, (q.get("run") or [None])[0], self.app.budget))
                return
            if path == "/api/metrics":
                from .observe import handle_metrics
                st, payload = handle_metrics(store, q)
                self._send(st, payload)
                return
            if path == "/api/migrations":
                from .migrate import list_all
                self._send(200, {"migrations": list_all(store)})
                return
            m = _RE_MIG_DETAILS.match(path)
            if m:
                from .migrate import details
                self._send(200, details(store, m.group(1)))
                return
            m = _RE_MIG_REPORT.match(path)
            if m:
                from .migrate import report_text
                self._send(200, report_text(store, m.group(1)))
                return
            m = _RE_MIG.match(path)
            if m:
                from .migrate import view
                self._send(200, view(store, m.group(1)))
                return
            m = _RE_SEALS.match(path)
            if m:
                from .seal.wire import view as seal_view
                self._send(200, {"run": m.group(1), "seals": seal_view(store, m.group(1))})
                return
            m = _RE_PROCESS.match(path)
            if m:
                if store.get(E_RUN, m.group(1)) is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                from . import difyproc
                self._send(200, difyproc.view(store, m.group(1)))
                return
            m = _RE_QUESTIONS.match(path)
            if m:
                if store.get(E_RUN, m.group(1)) is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                from .understand_plus.human import api_questions
                self._send(200, api_questions(store, m.group(1)))
                return
            m = _RE_EVENTS.match(path)
            if m:
                run = m.group(1)
                if store.get(E_RUN, run) is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % run)
                    return
                after = int((q.get("after_seq") or ["0"])[0])
                limit = max(1, min(int((q.get("limit") or ["500"])[0]), 5000))
                from .worklog_text import event_text
                evs = _events(store, run, max(after, 0), limit)
                for ev in evs:                  # a sentence for people next to the record (Live activity)
                    ev["title"], ev["text"] = event_text(str(ev.get("kind") or ""), ev.get("body") or {},
                                                         str((ev.get("env") or {}).get("unit") or ""))
                self._send(200, {"run": run, "events": evs, "last_seq": store.last_seq()})
                return
            m = _RE_RUN.match(path)
            if m:
                d = run_detail(store, m.group(1), self.app.budget)
                if d is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                else:
                    self._send(200, d)
                return
            self._error(404, codes.NOT_FOUND, "no route %s" % path)
        except ValueError as e:
            self._error(400, codes.SCHEMA_INVALID, str(e))
        except LineError as e:
            self._send(_HTTP_FOR_CODE.get(e.code, 400), e.to_dict())
        except Exception as e:   # noqa: BLE001
            self._error(500, "INTERNAL", "%s: %s" % (type(e).__name__, e))

    def _link_rag(self, project: Dict[str, Any], payload: Optional[Dict[str, Any]] = None) -> str:
        """Get-or-create the project's RAG System project and add it to the namespace; on success a run
        payload gets rag_project (its agents read and write it). '' = linked, else why not (the run then keeps
        the shared project)."""
        from . import ragmap, projects
        rp = projects.rag_of(project)
        why = ragmap.ensure(self.app.cfg, rp, project.get("name", ""),
                           ragmap.descriptor(project, projects._public(project).get("workspace_path", "")))
        if not why and payload is not None:
            payload["rag_project"] = rp
        elif why and ragmap.enabled(self.app.cfg):
            sys.stderr.write("RAG System project %s: %s\n" % (rp, why))
        return why

    def _agent(self, tool: str) -> None:
        """POST /api/agent/<tool>: an agent's tool call forwarded by `dlc mcp` (line.agent_tools). Loopback only,
        with the token issued for that agent call instead of a person's sign-in."""
        from . import agent_tools
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            self._error(403, "FORBIDDEN", "agent tools answer on the engine host only")
            return
        try:
            self._send(200, agent_tools.handle(self.app.cfg, tool, self.headers.get("X-DLC-Agent", ""), self._body()))
        except PermissionError as e:
            self._error(403, "FORBIDDEN", str(e))

    def do_POST(self) -> None:   # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        try:
            m = _RE_AGENT.match(path)
            if m:
                self._agent(m.group(1))
                return
            if self._unrouted("POST", path) or not self._auth("POST", path):
                return
            body = self._body()
            if path.startswith(("/api/admin/processes", "/api/admin/projects/", "/api/admin/runs/")):
                from .process import api as process_api
                out = process_api.handle("POST", path, {}, body, self.app, self.actor)
                if out is not None:
                    self._send(*out)
                    return
            if path == "/api/admin/sidecars/autologin":
                from .sidecar import autologin
                self._send(201, autologin.add(body))
                return
            if path == "/api/admin/hooks":
                from . import hooks
                try:
                    self._send(201, hooks.add(body, by=self.actor))
                except ValueError as e:
                    self._error(400, codes.CONFIG_INVALID, str(e))
                return
            m = _RE_HOOK.match(path)
            if m:
                from . import hooks
                hid = int(m.group(1))
                try:
                    if m.group(2) == ":delete":
                        hooks.remove(hid)
                        self._send(200, {"deleted": hid})
                    elif m.group(2) == ":test":
                        self._drive("hook_test", {"hook": hid, "run": str(body.get("run") or "")})
                    else:
                        self._send(200, hooks.change(hid, body, by=self.actor))
                except KeyError:
                    self._error(404, codes.NOT_FOUND, "hook %d" % hid)
                except ValueError as e:
                    self._error(400, codes.CONFIG_INVALID, str(e))
                return
            m = _RE_HOOK_PASS.match(path)
            if m:
                from . import hooks
                try:
                    res = hooks.pass_by_hand(m.group(1), "%s:%s" % (m.group(2), m.group(3)), self.actor)
                except KeyError:
                    self._error(404, codes.NOT_FOUND, "hook %s:%s of run %s" % (m.group(2), m.group(3), m.group(1)))
                    return
                self._send(200, {"result": res})
                return
            if path == "/api/admin/sidecars/knowledge:ask":
                from . import agent_tools
                self._send(200, agent_tools.ask(self.app.cfg, str(body.get("rag_project") or ""),
                                                str(body.get("question") or "")))
                return
            m = _RE_AUTOLOGIN.match(path)
            if m:
                from .sidecar import autologin
                eid = int(m.group(1))
                try:
                    if m.group(2) == ":delete":
                        autologin.remove(eid)
                        self._send(200, {"deleted": eid})
                    elif m.group(2) == ":test":
                        self._send(200, autologin.test(eid))
                    else:
                        self._send(200, autologin.change(eid, body))
                except KeyError:
                    self._error(404, codes.NOT_FOUND, "autologin entry %d" % eid)
                return
            m = _RE_PAUSE.match(path)
            if m:
                self._drive("pause", {"run": m.group(1), "actor": self.actor,
                                      "reason": str(body.get("reason") or "operator")})
                return
            m = _RE_RESUME.match(path)
            if m:
                self._drive("resume", {"run": m.group(1), "actor": self.actor, "explicit": True})
                return
            m = _RE_RETRO.match(path)
            if m:
                self._drive("retro", {"run": m.group(1), "actor": self.actor})
                return
            m = _RE_ATTN_ACT.match(path)
            if m:
                self._attention_action(m.group(1), m.group(2), body)
                return
            if path == "/api/runs:pause_all":
                if " ".join(str(body.get("confirm") or "").split()) != URGENT_STOP_CONFIRM:
                    self._error(400, codes.SCHEMA_INVALID, "urgent stop needs {\"confirm\": \"%s\"}: nothing was "
                                "stopped" % URGENT_STOP_CONFIRM)
                    return
                self._drive("pause_all", {"actor": self.actor, "reason": str(body.get("reason") or "urgent stop")})
                return
            m = _RE_APP_START.match(path)
            if m:
                from . import appctl
                self._send(200, appctl.start(self.app.store, self.app.cfg, m.group(1), by=self.actor))
                return
            m = _RE_APP_BUILD.match(path)
            if m:
                from . import appctl
                self._send(200, appctl.build(self.app.store, self.app.cfg, m.group(1), by=self.actor))
                return
            m = _RE_APP_STOP.match(path)
            if m:
                from . import appctl
                self._send(200, appctl.stop(self.app.store, self.app.cfg, m.group(1), by=self.actor,
                                            reason=str(body.get("reason") or "operator")))
                return
            if path == "/api/runs":
                if not body.get("pack"):
                    self._error(400, codes.SCHEMA_INVALID, "body needs {\"pack\": <spec pack path>}")
                    return
                hm = body.get("human_mode")
                if hm not in (None, "", "ask", "decide"):
                    self._error(400, codes.SCHEMA_INVALID, "human_mode must be ask or decide")
                    return
                if body.get("lane") not in (None, "", "solo", "trivial", "small", "full"):
                    self._error(400, codes.SCHEMA_INVALID, "lane must be solo, trivial, small or full")
                    return
                if str(body.get("level") or "") not in ("", "1", "2", "3", "4"):
                    self._error(400, codes.SCHEMA_INVALID, "level must be 1, 2, 3 or 4")
                    return
                payload = {"pack": str(body["pack"]), **{k: v for k, v in body.items() if k not in ("pack", "actor")}}
                from . import projects
                projects.resolve_run_target(self.app.store, payload)
                if payload.get("project"):
                    self._link_rag(projects.get(payload["project"]), payload)
                if self.actor:
                    payload["actor"] = self.actor
                self._drive("start", payload)
                return
            if path == "/api/projects":
                from . import projects
                out = projects.create(body, self.actor)
                why = self._link_rag(projects.get(out["id"]))
                self._send(201, dict(out, rag_linked=not why, rag_note=why))
                return
            if path == "/api/admin/claude-token":
                from . import claude_token
                self._send(200, claude_token.save(body, self.actor))
                return
            if path == "/api/admin/change-queue":
                from . import changequeue
                try:
                    self._send(200, changequeue.save_settings(body, self.actor))
                except ValueError as e:
                    self._error(400, codes.SCHEMA_INVALID, str(e))
                return
            m = _RE_DELIVER.match(path)
            if m:
                from . import projects
                self._send(200, projects.deliver(m.group(1)))
                return
            m = _RE_PROJECT_CLOSE.match(path)
            if m:
                from . import projects
                self._send(200, projects.set_closed(self.app.store, m.group(1), m.group(2) == "close", self.actor))
                return
            if path == "/api/packs":
                from .flowhelper import create_pack
                self._send(201, create_pack(body))
                return
            if path == "/api/migrations":
                if not body.get("v1") or not body.get("v2"):
                    self._error(400, codes.SCHEMA_INVALID, "body needs {\"v1\": <repo>, \"v2\": <repo>}")
                    return
                self._drive("migrate_start", body)
                return
            m = _RE_MIG_RESUME.match(path)
            if m:
                self._drive("migrate_resume", {"migration": m.group(1), "max_usd": body.get("max_usd"),
                                               "max_usd_repo": body.get("max_usd_repo"),
                                               "rescan": body.get("rescan") in (True, "true", "1", 1)})
                return
            m = _RE_MIG_ANSWERS.match(path)
            if m:
                answers = body.get("answers")
                if answers is None and body.get("conflict"):
                    answers = [{"conflict": body.get("conflict"), "choice": body.get("choice")}]
                if not isinstance(answers, list) or not answers:
                    self._error(400, codes.SCHEMA_INVALID, "body needs {\"answers\": [{\"conflict\", \"choice\"}]}")
                    return
                self._drive("migrate_answer", {"migration": m.group(1), "answers": answers,
                                               "who": str(body.get("who") or "")})
                return
            m = _RE_CANCEL.match(path)
            if m:
                reason = str(body.get("reason", "operator"))
                self._drive("cancel", {"run": m.group(1),
                                       "reason": reason + (" (by %s)" % self.actor if self.actor else "")})
                return
            m = _RE_ANSWERS.match(path)
            if m:
                self._answers(m.group(1), body)
                return
            m = _RE_GATE.match(path)
            if m:
                self._gate(m.group(1), m.group(2), body)
                return
            m = _RE_GATE_CHAT.match(path)
            if m:
                self._gate_chat(m.group(1), m.group(2), body)
                return
            if path == "/api/docs:convert":
                import base64
                from .docread import DocError, convert_bytes
                try:
                    doc = convert_bytes(str(body.get("name") or ""), base64.b64decode(str(body.get("data") or "")))
                except (DocError, ValueError) as e:
                    self._error(400, codes.SCHEMA_INVALID, str(e))
                    return
                self._send(200, doc.to_dict())
                return
            m = _RE_PROCESS_FORM.match(path)
            if m:
                if self.app.store.get(E_RUN, m.group(1)) is None:
                    self._error(404, codes.NOT_FOUND, "run %s" % m.group(1))
                    return
                from . import difyproc
                if self.actor and not body.get("who"):
                    body = dict(body, who=self.actor)
                self._send(200, difyproc.answer(self.app.cfg, self.app.store, m.group(1), m.group(2), body))
                return
            m = _RE_SEAL_SIGN.match(path)
            if m:
                from urllib.parse import unquote
                from .seal.wire import sign_subject
                run, subj = m.group(1), unquote(m.group(2))
                row = sign_subject(self.app.store, run, subj, str(body.get("who") or ""),
                                   str(body.get("option") or "sign"))
                out: Dict[str, Any] = {"seal": row}
                if self.app.driver is not None:
                    try:
                        out["resumed"] = self.app.driver("resume", {"run": run})
                    except LineError as e:
                        out["resumed"] = {"error": e.to_dict()}
                self._send(200, out)
                return
            self._error(404, codes.NOT_FOUND, "no route %s" % path)
        except ValueError as e:
            self._error(400, codes.SCHEMA_INVALID, str(e))
        except LineError as e:
            self._send(_HTTP_FOR_CODE.get(e.code, 400), e.to_dict())
        except Exception as e:   # noqa: BLE001
            self._error(500, "INTERNAL", "%s: %s" % (type(e).__name__, e))

    def _attention_action(self, run: str, action: str, body: Dict[str, Any]) -> None:
        """The run page's attention panel: mark a failed run resolved, start it again (with a hint), explain it."""
        from . import attention
        store = self.app.store
        if store.get(E_RUN, run) is None:
            self._error(404, codes.NOT_FOUND, "run %s" % run)
            return
        try:
            if action == "resolve":
                self._send(200, attention.resolve(store, self.app.cfg, run, str(body.get("note") or ""), self.actor))
                return
            if action == "explain":
                from .llm import make_llm
                self._send(200, {"run": run, "explain": attention.explain(store, self.app.cfg, run,
                                                                          make_llm(self.app.cfg, store))})
                return
            if self.app.driver is None:
                self._error(501, "NOT_IMPLEMENTED", "no pipeline driver wired to this server", {"action": "resume"})
                return
            from .reopen import reopen               # a retry runs the same run again (no new run)
            out = reopen(store, self.app.cfg, run, str(body.get("hint") or ""), self.actor, by="person")
        except ValueError as e:
            self._error(409, codes.STATE_CONFLICT, str(e))
            return
        res = self.app.driver("resume", {"run": run, "actor": self.actor})
        self._send(202, dict(res if isinstance(res, dict) else {"result": res}, attempt=out["attempt"], retry_of=run))

    def _gate(self, run: str, gate: str, body: Dict[str, Any]) -> None:
        """A person's decision at the gated flow's open gate (line.gates), then the run goes on."""
        from . import gates
        store = self.app.store
        if store.get(E_RUN, run) is None:
            self._error(404, codes.NOT_FOUND, "run %s" % run)
            return
        roles = None
        if self.app.verifier is not None and self.claims is not None:
            roles = sorted(self.app.verifier.roles(self.claims))
        try:
            out = gates.decide(store, self.app.cfg, run, gate, body, self.actor, roles=roles)
        except PermissionError as e:
            self._error(403, "FORBIDDEN", str(e))
            return
        except ValueError as e:
            self._error(409 if "not open" in str(e) else 400, codes.STATE_CONFLICT if "not open" in str(e)
                        else codes.SCHEMA_INVALID, str(e))
            return
        if self.app.driver is None:
            out["resumed"] = {"error": "no pipeline driver wired to this server"}
        else:
            try:
                out["resumed"] = self.app.driver("resume", {"run": run})
            except LineError as e:
                out["resumed"] = {"error": e.to_dict()}
        self._send(200, out)

    def _gate_chat(self, run: str, gate: str, body: Dict[str, Any]) -> None:
        """A person writes to the agents of the draft step whose gate is open (line.gatechat); the agent answers on a
        thread and may change its documents; the answer shows in the gate's messages."""
        from . import gatechat
        store = self.app.store
        if store.get(E_RUN, run) is None:
            self._error(404, codes.NOT_FOUND, "run %s" % run)
            return
        roles = None
        if self.app.verifier is not None and self.claims is not None:
            roles = sorted(self.app.verifier.roles(self.claims))

        def start(fn: Any) -> None:
            threading.Thread(target=fn, name="gate-chat-" + run, daemon=True).start()
        try:
            out = gatechat.post(store, self.app.cfg, run, gate, body, self.actor, roles=roles, start=start)
        except PermissionError as e:
            self._error(403, "FORBIDDEN", str(e))
            return
        except ValueError as e:
            self._error(409, codes.STATE_CONFLICT, str(e))
            return
        self._send(202, out)

    def _answers(self, run: str, body: Dict[str, Any]) -> None:
        store = self.app.store
        if store.get(E_RUN, run) is None:
            self._error(404, codes.NOT_FOUND, "run %s" % run)
            return
        from .understand_plus.human import api_answers
        st, out = api_answers(store, run, body, cfg=self.app.cfg)
        if st == 200 and out.get("resume"):
            if self.app.driver is None:
                out["resumed"] = {"error": "no pipeline driver wired to this server"}
            else:
                try:
                    out["resumed"] = self.app.driver("resume", {"run": run})
                except LineError as e:
                    out["resumed"] = {"error": e.to_dict()}
        self._send(st, out)

    def _drive(self, action: str, payload: Dict[str, Any]) -> None:
        if self.app.driver is None:
            self._error(501, "NOT_IMPLEMENTED", "no pipeline driver wired to this server", {"action": action})
            return
        res = self.app.driver(action, payload)
        self._send(202 if action in ("start", "migrate_start") else 200, res if isinstance(res, dict) else {"result": res})


class LineServer:
    """Owns the HTTP server. start() serves on a daemon thread; port 0 picks a free port."""

    def __init__(self, store: Any, cfg: Optional[Config] = None, driver: Optional[Driver] = None,
                 budget: Any = None, host: Optional[str] = None, port: Optional[int] = None, verbose: bool = False):
        self.store = store
        self.cfg = cfg or load_config()
        self.driver = driver
        self.budget = budget
        self.host = host or self.cfg.host
        self.port = self.cfg.port if port is None else port
        self.verbose = verbose
        from .auth import Verifier
        self.verifier = Verifier.from_config(self.cfg)
        self.cors_origins = frozenset(o.strip().rstrip("/") for o in
                                      os.environ.get("LINE_CORS_ORIGINS", "").split(",") if o.strip())
        handler = type("LineHandler", (_Handler,), {"app": self})
        self.httpd = ThreadingHTTPServer((self.host, self.port), handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self._thread: Optional[threading.Thread] = None
        from . import agent_tools
        agent_tools.ENGINE_URL = "http://127.0.0.1:%d" % self.port    # agents' `dlc mcp` reaches the engine here

    @property
    def url(self) -> str:
        return "http://%s:%d" % (self.host, self.port)

    def start(self) -> "LineServer":
        self._thread = threading.Thread(target=self.httpd.serve_forever, name="line-server", daemon=True)
        self._thread.start()
        return self

    def serve_forever(self) -> None:
        self.httpd.serve_forever()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        from . import agent_tools
        if agent_tools.ENGINE_URL == "http://127.0.0.1:%d" % self.port:
            agent_tools.ENGINE_URL = ""        # nothing answers there any more
        if self._thread:
            self._thread.join(timeout=5)


# ------------------------------------------------------------------ main


def _open_store(cfg: Config) -> Any:
    """The SQLite store (line.store.open_store on cfg.db)."""
    from .store import open_store   # late import: the server module stays importable on its own
    return open_store(cfg)


def _pipeline_driver(store: Any, cfg: Config) -> Optional[Driver]:
    """line.pipeline.make_driver(store, cfg) if the pipeline exists yet, else None (POST -> 501)."""
    try:
        from . import pipeline   # noqa: WPS433
    except ImportError:
        return None
    make = getattr(pipeline, "make_driver", None)
    return make(store, cfg) if callable(make) else None


def auto_resume(driver: Optional[Driver], cfg: Config, argv: List[str]) -> List[Dict[str, Any]]:
    """Opt-in (LINE_AUTO_RESUME=1 or --resume): resume every non-final run of the store on start."""
    if driver is None or not (getattr(cfg, "auto_resume", False) or "--resume" in argv):
        return []
    try:
        return list(driver("resume_all", {}).get("resumed") or [])
    except Exception as e:   # noqa: BLE001 - the server starts anyway
        print("auto-resume failed: %s" % e, flush=True)
        return []


def main(argv: Optional[List[str]] = None) -> int:
    cfg = load_config()
    store = _open_store(cfg)
    args = list(sys.argv[1:] if argv is None else argv)
    driver = _pipeline_driver(store, cfg)
    srv = LineServer(store, cfg, driver=driver, verbose="-v" in args)
    print("sdlc line server on %s (db %s)" % (srv.url, cfg.db), flush=True)
    rc = None
    try:
        from . import reconciler
        rag = None
        if cfg.rag != "off":
            from .rag import make_rag
            rag = make_rag(cfg, store)
        rc = reconciler.on_server_start(store, cfg, rag=rag, log=lambda m: print("reconcile: " + m, flush=True))
        if rc is not None:
            print("reconciler every %ss%s" % (cfg.reconcile_s, " (dry run)" if cfg.reconcile_dry_run else ""),
                  flush=True)
    except Exception as e:   # noqa: BLE001 - the server starts anyway
        print("reconciler not started: %s" % e, flush=True)
    for r in auto_resume(driver, cfg, args):
        print("resumed run %s (%s)" % (r.get("run"), r.get("state")), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if rc is not None:
            rc.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
