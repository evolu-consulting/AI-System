"""`dlc mcp`: the stdio MCP server an agent (Claude CLI) gets during a run. Holds no secret.

Every tool call is forwarded to the engine (line.agent_tools) at DLC_AGENT_URL with the per-call token
DLC_AGENT_TOKEN; DLC_AGENT_TOOLS lists the tools this agent may see. The engine does the work (the knowledge
store, DLC Autologin) and answers in text.

Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0, stdlib only (same shape as the App Session
Manager's mcp_server.py).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "dlc", "version": "1.0.0"}
TIMEOUT_S = 300

INSTRUCTIONS = (
    "Tools of the DLC delivery line for this run. step_context gives one bounded pack of what the project "
    "knows for one step of your work (follow its open threads with read_items); follow_plan reads the plan of "
    "an action of the menu in your turn context; record_finding and save_lesson leave what you learnt for the "
    "next agents. search_knowledge reads what the project already knows: "
    "earlier fixes, decisions, how to build, test and deploy it, its lessons and its worklog. Use it before "
    "guessing, and whenever a report, ticket or error names something you do not know. When the report links "
    "a ticket or a page of an app listed by list_apps, read it with fetch or open_page after get_session. "
    "code_graph (when listed) maps the repository's code without reading it: ask it first, then Read only the "
    "lines it points to. read_document turns a PDF or Word (.docx) file into markdown text you can read. "
    "Never print secrets; the tools never return them.")

_APP = {"type": "string", "description": "Entry name as list_apps shows it"}
#: tools answered here, in the agent's own process (no engine call): the file is on the agent's machine
LOCAL_TOOLS = ("read_document",)
TOOLS: Dict[str, Dict[str, Any]] = {
    "read_document": {
        "description": ("Read a PDF or Word (.docx) document as markdown text: headings, lists and tables kept, page "
                        "by page for a PDF; scanned pages without a text layer are named, not read (no OCR). Use it "
                        "for business and technical documents (contract types, legal rules, processes, sample test "
                        "cases) the request or the repository holds; the Read tool cannot read these files."),
        "inputSchema": {"type": "object", "properties": {
            "path": {"type": "string", "description": "Path of the .pdf or .docx file (absolute, or relative to "
                                                       "your working folder)"},
            "offset": {"type": "integer", "description": "First character to return (default 0), for long documents"},
            "max_chars": {"type": "integer", "description": "How much text, 2000-60000 (default 30000)"}},
            "required": ["path"], "additionalProperties": False}},
    "search_knowledge": {
        "description": ("Search the project's knowledge (the RAG System project of this run, then the shared "
                        "lessons): decisions, earlier fixes, procedures, lessons, worklog. Ask in plain words, "
                        "e.g. 'how is the ticket list filtered' or 'how do we deploy to QA'."),
        "inputSchema": {"type": "object", "properties": {
            "question": {"type": "string", "description": "What you need to know, in plain words"},
            "max_chars": {"type": "integer", "description": "Answer size, 500-8000 (default 4000)"}},
            "required": ["question"], "additionalProperties": False}},
    "code_graph": {
        "description": ("The repository's code graph (Graphify: files, classes, functions, calls, imports), answered "
                        "locally and for free. Use it BEFORE reading files to find where something lives and what a "
                        "change touches, then Read only those lines. op: query (a question in words), explain (one "
                        "symbol and its neighbours), affected (what depends on a symbol: the impact of changing it), "
                        "path (how a reaches b), hubs (the most connected symbols)."),
        "inputSchema": {"type": "object", "properties": {
            "op": {"type": "string", "enum": ["query", "explain", "affected", "path", "hubs"]},
            "question": {"type": "string", "description": "op query: what you look for, e.g. 'where are notes saved'"},
            "name": {"type": "string", "description": "op explain / affected: a symbol, e.g. 'saveNote' or 'db.js'"},
            "a": {"type": "string"}, "b": {"type": "string"},
            "budget": {"type": "integer", "description": "op query: answer size in tokens, 300-4000 (default 1500)"},
            "top": {"type": "integer", "description": "op hubs: how many (default 15)"}},
            "required": ["op"], "additionalProperties": False}},
    "read_board": {
        "description": ("The run board: the latest status of every step of this run (what each step settled: "
                        "F-items, locked tests and the files they use, the plan's units and claims, what failed and "
                        "why), then the boards of the attempts this run retries. Your prompt already ends with it; "
                        "read it again after a long step. Continue from it; never redo a settled step."),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    "post_message": {
        "description": ("Tell other agents of this run something they need, through the run's project (never a "
                        "private message): tag the roles it is for. Use it for facts and decisions, e.g. a builder "
                        "telling @merger which file it had to add, or @supervisor why a test cannot pass. Each "
                        "tagged agent sees it once, in its next step."),
        "inputSchema": {"type": "object", "properties": {
            "to": {"type": "array", "items": {"type": "string", "enum": [
                "spec_analyst", "change_sizer", "test_author", "planner", "builder", "fixer", "merger", "reviewer",
                "supervisor", "person", "all"]}, "description": "The roles it is for"},
            "kind": {"type": "string", "description": "fact | decision | question | warning | handoff"},
            "text": {"type": "string", "description": "One to five sentences, concrete (files, names, errors)"},
            "reply_to": {"type": "string", "description": "The id of the message this answers"}},
            "required": ["to", "text"], "additionalProperties": False}},
    "step_context": {
        "description": ("ONE bounded context pack for one step of your work: entities, then knowledge, then the "
                        "log of the project, with open threads (truncated rows, newer log). Write the step's "
                        "intent in plain English, e.g. 'how are unit tests run in this repo'."),
        "inputSchema": {"type": "object", "properties": {
            "text": {"type": "string", "description": "The step's intent in plain English + minimum context"},
            "include_log": {"type": "boolean", "description": "Also the project's history (worklog)"},
            "max_chars": {"type": "integer", "description": "Pack size, 1000-12000 (default 6000)"}},
            "required": ["text"], "additionalProperties": False}},
    "read_items": {
        "description": "Read rows in full by id (from a pack), only for a truncated item you actually use.",
        "inputSchema": {"type": "object", "properties": {
            "ids": {"type": "array", "items": {"type": "string"}, "description": "Row ids, e.g. vec_1a2b3c"},
            "scope": {"type": "string", "description": "knowledge | log | findings (default: try each)"}},
            "required": ["ids"], "additionalProperties": False}},
    "follow_plan": {
        "description": "The rules of one action of your turn context's action menu, in the order to perform them.",
        "inputSchema": {"type": "object", "properties": {
            "action": {"type": "string", "description": "The action label exactly as the menu shows it"}},
            "required": ["action"], "additionalProperties": False}},
    "record_finding": {
        "description": ("Record a problem you hit and fixed in this project (symptom, cause, fix), so the next "
                        "agent finds it before repeating it. English, specific: names, paths, errors verbatim."),
        "inputSchema": {"type": "object", "properties": {
            "title": {"type": "string", "description": "One line naming the problem, the way the next agent would "
                                                        "describe its own task (later agents find it by similarity "
                                                        "and see this line first)"},
            "text": {"type": "string", "description": "Symptom: ... Cause: ... Fix: ..."},
            "subject": {"type": "string", "description": "Short subject, e.g. the module or the error"}},
            "required": ["text"], "additionalProperties": False}},
    "save_lesson": {
        "description": "Save a rule that holds beyond this task (short and imperative), for every later run.",
        "inputSchema": {"type": "object", "properties": {
            "title": {"type": "string", "description": "The rule in one line, addressed to the role that must "
                                                        "follow it (later agents find it by similarity and see "
                                                        "this line first)"},
            "text": {"type": "string", "description": "<rule>. Why: <reason>. Applies when: <situation>"},
            "subject": {"type": "string"},
            "share": {"type": "boolean", "description": "true: the rule holds for any project; it goes to the "
                                                        "shared pool every project's agents read"}},
            "required": ["text"], "additionalProperties": False}},
    "write_worklog": {
        "description": ("Store this call's worklog yourself (what you did, how, result). Optional: the engine "
                        "stores your closing summary when you do not."),
        "inputSchema": {"type": "object", "properties": {
            "text": {"type": "string"}, "subject": {"type": "string"}},
            "required": ["text"], "additionalProperties": False}},
    "list_apps": {
        "description": ("The apps this agent may sign in to (DLC Autologin and the machine's App Session Manager): "
                        "name, environment, kind, and who is using one now. No secrets. Each app is ONE shared "
                        "session (one browser tab or window for every agent): a tool on a busy app waits in line, "
                        "then answers BUSY; wait and call again. Call release_app as soon as you are done."),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    "release_app": {
        "description": "Give an app's shared session back so the next agent in line can use it (you are done).",
        "inputSchema": {"type": "object", "properties": {"app": _APP}, "required": ["app"],
                        "additionalProperties": False}},
    "get_session": {
        "description": ("Sign in to an app (or reuse its signed-in session) in the engine's own browser. "
                        "Returns whether it is signed in and the page it shows. Call once per app per task."),
        "inputSchema": {"type": "object", "properties": {"app": _APP}, "required": ["app"],
                        "additionalProperties": False}},
    "open_page": {
        "description": "Open a URL in the app's signed-in session and return the page title and visible text.",
        "inputSchema": {"type": "object", "properties": {
            "app": _APP, "url": {"type": "string"},
            "max_chars": {"type": "integer", "description": "Text size (default 8000, max 30000)"}},
            "required": ["app", "url"], "additionalProperties": False}},
    "fetch": {
        "description": ("HTTP request with the app's signed-in session (its cookies), e.g. a REST API such as "
                        "Jira's /rest/api/2/issue/KEY. Returns the status and the body (JSON or text)."),
        "inputSchema": {"type": "object", "properties": {
            "app": _APP, "url": {"type": "string"},
            "method": {"type": "string", "description": "GET (default), POST, PUT, PATCH, DELETE"},
            "body": {"type": "string", "description": "Request body (JSON text) for POST / PUT / PATCH"},
            "max_chars": {"type": "integer"}},
            "required": ["app", "url"], "additionalProperties": False}},
    "run_js": {
        "description": ("Run JavaScript in the app's signed-in page (click, fill, read the DOM). The value of "
                        "the last expression comes back as JSON text; await is allowed."),
        "inputSchema": {"type": "object", "properties": {
            "app": _APP, "script": {"type": "string"},
            "url": {"type": "string", "description": "Open this URL first (optional)"}},
            "required": ["app", "script"], "additionalProperties": False}},
    "cf_login": {
        "description": ("Log the cf CLI on the engine host in to SAP BTP Cloud Foundry with a passcode entry "
                        "(list_apps shows 'passcode'). Returns cf's output, never the passcode."),
        "inputSchema": {"type": "object", "properties": {
            "app": _APP, "org": {"type": "string"}, "space": {"type": "string"},
            "api": {"type": "string", "description": "Only when it differs from the derived endpoint"}},
            "required": ["app"], "additionalProperties": False}},
    "cli_login": {
        "description": ("Sign a command-line tool on the engine host in (e.g. gcloud) with a cli entry (list_apps "
                        "shows 'cli entry'): runs the entry's sign-in command, finishes its browser part and hands "
                        "the verification code back to it. Returns the command's output, never the code."),
        "inputSchema": {"type": "object", "properties": {"app": _APP}, "required": ["app"],
                        "additionalProperties": False}},
}


def allowed() -> List[str]:
    names = [n.strip() for n in os.environ.get("DLC_AGENT_TOOLS", "search_knowledge").split(",") if n.strip()]
    return [n for n in names if n in TOOLS] + [n for n in LOCAL_TOOLS if n not in names]


def read_document(args: Dict[str, Any]) -> Dict[str, Any]:
    """read_document, answered locally: the document as markdown, one window of it (offset / max_chars)."""
    from .docread import DocError, convert
    path = str(args.get("path") or "").strip()
    if not path:
        return {"text": "path is required", "error": True}
    try:
        doc = convert(os.path.abspath(path))
    except DocError as e:
        return {"text": "Cannot read %s: %s" % (path, e), "error": True}
    try:
        offset = max(int(args.get("offset") or 0), 0)
        size = min(max(int(args.get("max_chars") or 30000), 2000), 60000)
    except (TypeError, ValueError):
        offset, size = 0, 30000
    part = doc.text[offset:offset + size]
    head = "%s (%s%s, %d characters; showing %d-%d)" % (
        doc.name, doc.kind, ", %d pages" % doc.pages if doc.pages else "", len(doc.text), offset, offset + len(part))
    notes = "".join("\nwarning: %s" % w for w in doc.warnings)
    more = "\n\n(more: call again with offset %d)" % (offset + len(part)) if offset + len(part) < len(doc.text) else ""
    return {"text": head + notes + "\n\n" + part + more}


def _post(tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    url = os.environ.get("DLC_AGENT_URL", "").rstrip("/") + "/api/agent/" + tool
    req = urllib.request.Request(url, data=json.dumps(args).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json",
                                          "X-DLC-Agent": os.environ.get("DLC_AGENT_TOKEN", "")})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read() or b"{}")
        except ValueError:
            d = {}
        return {"text": d.get("message") or d.get("error") or "HTTP %d" % e.code, "error": True}


def handle(msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None
    if method == "initialize":
        version = (msg.get("params") or {}).get("protocolVersion") or PROTOCOL_VERSION
        result: Dict[str, Any] = {"protocolVersion": version, "capabilities": {"tools": {}},
                                  "serverInfo": SERVER_INFO, "instructions": INSTRUCTIONS}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [dict(name=n, **TOOLS[n]) for n in allowed()]}
    elif method == "tools/call":
        p = msg.get("params") or {}
        name = p.get("name")
        if name not in allowed():
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "unknown tool %s" % name}}
        try:
            out = read_document(p.get("arguments") or {}) if name in LOCAL_TOOLS else _post(name, p.get("arguments") or {})
            text, err = str(out.get("text") or ""), bool(out.get("error"))
        except OSError as e:
            text, err = "The DLC engine did not answer (%s)." % e, True
        result = {"content": [{"type": "text", "text": text}], "isError": err}
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found: %s" % method}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main() -> int:
    stdin = open(sys.stdin.fileno(), "r", encoding="utf-8", closefd=False)
    stdout = open(sys.stdout.fileno(), "w", encoding="utf-8", newline="\n", closefd=False)
    for line in stdin:
        if not line.strip():
            continue
        try:
            reply = handle(json.loads(line))
        except ValueError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        if reply is not None:
            stdout.write(json.dumps(reply) + "\n")
            stdout.flush()
    return 0


__all__ = ["main", "handle", "TOOLS", "allowed"]

if __name__ == "__main__":
    sys.exit(main())
