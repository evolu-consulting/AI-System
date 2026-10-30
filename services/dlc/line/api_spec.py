"""The one table of the HTTP API: the server serves only what is listed here, and GET /api/openapi.json is
generated from it, so the published contract and the served routes cannot drift apart.

A route: (method, template, summary, request body schema or None, query params, response schema, tag).
Templates use {name} for path segments; {subject} may contain '/'. Schemas are JSON Schema fragments kept
deliberately loose (objects with the documented fields); every object may carry more fields.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, NamedTuple, Optional, Tuple

from . import __version__

OBJ = {"type": "object"}
STR, INT, NUM, BOOL = {"type": "string"}, {"type": "integer"}, {"type": "number"}, {"type": "boolean"}


def obj(props: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"type": "object", "properties": props, "additionalProperties": True}
    if required:
        out["required"] = list(required)
    return out


def arr(item: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "array", "items": item}


ERROR = obj({"code": STR, "message": STR, "detail": OBJ}, ["code", "message"])
RUN_SUMMARY = obj({"id": STR, "state": {"type": "string", "description": "admitted, understanding, planning, building, "
                                                                         "integrating, testing, deploying, green, "
                                                                         "escalated, parked ..."},
                   "pack_path": STR, "name": STR, "flow": STR, "actor": STR, "human_mode": STR, "paused": BOOL,
                   "created_ms": INT, "updated_ms": INT, "budget_usd": NUM, "units": INT,
                   "unit_states": OBJ, "detail": OBJ,
                   "nothing_to_merge": {"type": "integer", "description": "merged units that changed nothing (their "
                                                                          "work was already on main)"}})
SLOT = obj({"id": STR, "seq": INT, "run": STR, "flow": STR,
            "state": {"type": "string", "enum": ["reserved", "planned", "implementing", "done", "dropped", "ignored"]},
            "summary": STR, "docs": arr(STR), "created_ms": INT, "planned_ms": INT, "started_ms": INT,
            "ended_ms": INT, "end": STR, "ignored_by": STR, "waited_min": INT, "actor": STR})
QUEUE = obj({"project": STR, "wait_minutes": INT, "active": arr(SLOT), "recent": arr(SLOT)})
PROJECT = obj({"id": STR, "name": STR, "description": STR, "created_ms": INT, "created_by": STR, "runs": INT,
               "has_code": {"type": "boolean", "description": "a run has completed, or the project started from "
                                                               "existing code: Enhancement / Bug Fix may start"},
               "source": {"type": "string", "enum": ["new", "folder", "git"]},
               "workspace_path": {"type": "string", "description": "folder relative to the workspace root"},
               "repo_url": STR,
               "rag_project": {"type": "string", "description": "the RAG System project its runs read and write"},
               "active_run": OBJ, "last_run": OBJ, "last_green_run": STR, "updated_ms": INT,
               "live_runs": arr(obj({"id": STR, "state": STR, "flow": STR})),
               "usage": obj({"usd": {"type": "number"}, "tokens_in": INT, "tokens_out": INT}),
               "progress": obj({"done": INT, "total": INT, "pct": INT}),
               "closed": obj({"by": STR, "ms": INT}),
               "attention": obj({"needed": BOOL, "why": STR})})
AUTOLOGIN = obj({"id": INT, "name": STR, "url": STR, "host": STR, "env": STR,
                 "kind": {"type": "string", "enum": ["password", "sso", "passcode", "steps", "cli"]}, "username": STR,
                 "provider": {"type": "string", "description": "sso: the provider button to click"},
                 "steps": {"type": "string", "description": "the entry's own sign-in steps, one per line; empty "
                           "= its kind's preset"},
                 "roles": arr({"type": "string", "enum": ["spec", "dev", "deploy", "test"]}), "enabled": BOOL,
                 "has_secret": BOOL})
HOOK_IN = obj({"name": STR, "enabled": BOOL, "prompt": STR,
                "scope": {"type": "string", "description": "run (an event of every matching run) | agent (every "
                                                           "matching agent call: agent_start, before_tool)"},
                "roles": {"type": "array", "items": STR, "description": "agent hooks: roles (prefix match); empty = all"},
                "pattern": {"type": "string", "description": "before_tool: regular expression on the shell command"},
                "event": {"type": "string", "description": "run_start, after_plan, before_qas, before_green, "
                                                           "run_done, run_failed"},
                "mode": {"type": "string", "description": "background | wait (the run waits for SUBMIT or "
                                                          "BLOCKED:<reason>)"},
                "on_block": {"type": "string", "description": "wait (park the run) | stop (escalate HOOK_STOP)"},
                "on_error": {"type": "string", "description": "continue | wait"},
                "projects": arr(STR), "flows": arr(STR),
                "apps": {"type": "array", "items": STR, "description": "Autologin entry names the agent may use"},
                "max_turns": INT, "max_usd": NUM})
HOOK = obj({"id": INT, "name": STR, "enabled": BOOL, "prompt": STR, "scope": STR, "roles": arr(STR), "pattern": STR,
            "event": STR, "mode": STR, "on_block": STR,
            "on_error": STR, "projects": arr(STR), "flows": arr(STR), "apps": arr(STR), "max_turns": INT,
            "max_usd": NUM, "by": STR})
HOOK_RESULT = obj({"key": STR, "name": STR, "event": STR, "status": STR, "reason": STR, "usd": NUM, "run": STR})
AUTOLOGIN_IN = obj({"name": STR, "url": STR, "env": STR, "kind": STR, "username": STR, "provider": STR,
                    "steps": STR, "roles": arr(STR), "enabled": BOOL,
                    "secret": {"type": "string", "description": "write-only; empty keeps the stored one"}})
WS_FOLDER = obj({"name": STR, "path": STR,
                 "kind": {"type": "string", "enum": ["empty", "git", "files", "unreadable"],
                          "description": "empty = built in place; git = the engine clones its current commit; "
                                         "files = the engine copies it (no git needed)"},
                 "branch": STR, "uncommitted": INT, "has_code": BOOL, "nested": arr(STR), "project": STR,
                 "why": {"type": "string", "description": "why it cannot be used ('' = it can)"}})
CLAUDE_TOKEN = obj({"source": {"type": "string", "enum": ["file", "service", "none"],
                               "description": "file = set here; service = the deploy kit's; none = not set"},
                    "hint": {"type": "string", "description": "start and last 4 characters only"},
                    "set_ms": INT, "set_by": STR})
EVENT = obj({"seq": INT, "kind": STR, "env": obj({"run": STR, "unit": STR, "attempt": INT, "epoch": INT}),
             "body": OBJ, "ts_ms": INT, "title": STR, "text": STR})
QUESTION = obj({"qid": STR, "state": STR, "kind": STR, "decision": STR,
                "options": arr(obj({"id": STR, "text": STR, "impact": STR})), "recommended": STR,
                "evidence": arr(OBJ), "f_items": arr(STR), "due_ms": INT})
MIG_SUMMARY = obj({"id": STR, "state": {"type": "string", "description": "admitted, inventoried, matched, parked, "
                                                                         "decided, building, verifying, green, "
                                                                         "analysed, escalated"},
                   "code": STR, "message": STR, "mode": STR, "run": STR, "report": STR, "counts": OBJ, "budget": OBJ})
MIG_QUESTION = obj({"conflict": STR, "feature": STR, "text": STR, "options": arr(obj({"id": STR, "label": STR}))})


NODE = obj({"id": {"type": "string", "enum": ["understand", "tests", "plan", "build", "review", "merge", "qas",
                                              "result"]},
             "title": STR, "stage": STR,
             "state": {"type": "string", "enum": ["pending", "running", "paused", "done", "failed", "skipped"]},
             "roles": arr(STR), "started_ms": INT, "ended_ms": INT,
             "counts": obj({"events": INT, "llm_calls": INT, "usd": NUM, "tokens_in": INT, "tokens_out": INT,
                            "units": INT, "merged": INT})})
WORKLOG = obj({"ts": INT, "role": STR, "agent": STR,
               "kind": {"type": "string", "enum": ["llm_call", "decision", "event", "output", "error"]},
               "title": STR, "text": STR, "cost_usd": NUM, "artifact": STR,
               "event": {"type": "string", "description": "the engine event kind behind the entry (technical)"},
               "raw": {"type": "string", "description": "the engine's own record of the entry (technical view)"}})
REPORT = obj({"id": STR, "kind": {"type": "string", "enum": ["spec", "implement", "test", "qas", "review", "questions",
                                                              "findings", "decisions", "deploy", "seal", "migration"]},
              "title": STR, "node": STR, "created_ms": INT, "mime": STR, "size": INT, "url": STR})
APP = obj({"run": STR, "state": {"type": "string", "enum": ["none", "stopped", "starting", "running", "failed"]},
           "url": STR, "port": INT, "pid": INT, "dir": STR, "how": STR, "log_tail": STR, "error": STR,
           "kind": {"type": "string", "enum": ["web", "desktop"],
                    "description": "web: Start app / Open app; desktop: Build & download"},
           "build": obj({"state": {"type": "string", "enum": ["building", "built", "failed"]}, "size": INT,
                         "error": STR, "name": STR})})


class Route(NamedTuple):
    method: str
    template: str
    summary: str
    body: Optional[Dict[str, Any]]
    query: Tuple[Tuple[str, str], ...]
    response: Dict[str, Any]
    status: int
    tag: str


ROUTES: List[Route] = [
    Route("GET", "/api/health", "Liveness and version", None, (),
          obj({"ok": BOOL, "service": STR, "version": STR, "last_seq": INT, "time_ms": INT, "driver": BOOL}),
          200, "system"),
    Route("GET", "/api/openapi.json", "This API description (OpenAPI 3)", None, (), OBJ, 200, "system"),
    Route("GET", "/api/auth/config", "Sign-in settings for a frontend (open; enabled false when the API is open)",
          None, (), obj({"enabled": BOOL, "issuer": STR, "client_id": STR, "audience": STR, "role_user": STR,
                         "role_admin": STR}), 200, "system"),
    Route("GET", "/api/me", "Who the bearer token belongs to and its roles", None, (),
          obj({"enabled": BOOL, "actor": STR, "roles": arr(STR), "admin": BOOL}), 200, "system"),
    Route("GET", "/api/runs", "All runs, newest first", None, (), obj({"runs": arr(RUN_SUMMARY)}), 200, "runs"),
    Route("GET", "/api/catalog", "What the line is made of: steps (with agent roles and hook events), agents "
          "(kind, step, model in use), standard processes, hook events (read only; line.catalog)", None, (),
          obj({"steps": arr(OBJ), "agents": arr(OBJ), "processes": arr(OBJ), "definitions": arr(OBJ),
               "hook_events": arr(STR),
               "wait_events": arr(STR), "models": OBJ}), 200, "system"),
    Route("POST", "/api/runs", "Start a run from a spec pack (New System, Enhancement, Bug Fix)",
          obj({"pack": {"type": "string", "description": "path of a spec pack folder (spec.md + pack.json) on the "
                                                          "engine host"},
               "project": {"type": "string", "description": "project id (GET /api/projects): the run works on the "
                                                             "project's repository; one run at a time per project"},
               "target": {"type": "string", "description": "existing git repository (branch main); empty = a new "
                                                            "repository under the work root (prefer project)"},
               "name": {"type": "string", "description": "display name kept on the run"},
               "flow": {"type": "string", "description": "new | enhance | bug (kept on the run for display)"},
               "human_mode": {"type": "string", "enum": ["ask", "decide"],
                              "description": "per-run override: decide = nobody answers, the model decides and logs"},
               "process": {"description": "line.process definition for this run: an id (GET /api/catalog "
                                          "definitions) or a whole definition, which may extend another; omitted = "
                                          "the definition that applies to the run's flow"},
               "lane": {"type": "string", "enum": ["trivial", "small", "full"],
                        "description": "how much reading the change needs; omitted = the change sizer decides "
                                       "(docs: pipeline, Lanes)"}},
              ["pack"]),
          (), obj({"run": STR, "state": STR}), 202, "runs"),
    Route("GET", "/api/projects", "The open projects, most recently active first (?closed=1: the closed ones)", None,
          (), obj({"projects": arr(PROJECT)}), 200, "projects"),
    Route("POST", "/api/projects/{project}:close", "Close a project: hidden from Home, no new run until it is "
          "re-opened; its code, runs and knowledge stay. Refused while a process of it is running", None, (),
          obj({"project": STR, "closed": BOOL}), 200, "projects"),
    Route("POST", "/api/projects/{project}:reopen", "Re-open a closed project (back on Home)", None, (),
          obj({"project": STR, "closed": BOOL}), 200, "projects"),
    Route("POST", "/api/projects", "Create a project: a new folder the engine chooses, or existing code from the "
          "workspace root (a picked folder with or without git, or a clone of a GitHub / GitLab / Bitbucket / any git "
          "URL into it). The engine works on its own copy; an empty folder is built in place",
          obj({"name": STR, "description": STR,
               "source": obj({"kind": {"type": "string", "enum": ["new", "folder", "git"]},
                              "path": {"type": "string", "description": "folder: relative to the workspace root"},
                              "url": {"type": "string", "description": "git: https, ssh or user@host:path"},
                              "token": {"type": "string", "description": "git: access token for this clone only; "
                                                                        "never stored"},
                              "username": {"type": "string", "description": "git: user name for the token when the "
                                                                           "host needs one (Bitbucket app password)"},
                              "branch": {"type": "string", "description": "git: branch to clone (default: the "
                                                                         "repository's default branch)"},
                              "folder": {"type": "string", "description": "git: folder name under the root"}}),
               "rag_project": {"type": "string", "description": "link an existing RAG System project "
                                                               "(GET /api/rag-projects); default dlc-<id>"}},
              ["name"]), (), PROJECT, 201, "projects"),
    Route("GET", "/api/rag-projects", "Knowledge store projects no DLC project is linked to yet (imported history "
          "that can be linked to code)", None, (),
          obj({"projects": arr(obj({"id": STR, "descriptor": STR, "aliases": arr(STR)}))}), 200, "projects"),
    Route("GET", "/api/admin/sidecars", "Satellite tools of the engine (project knowledge, Autologin) (admin role)",
          None, (), obj({"sidecars": arr(obj({"id": STR, "name": STR, "description": STR, "enabled": BOOL,
                                              "builtin": BOOL, "count": INT}))}), 200, "admin"),
    Route("GET", "/api/admin/sidecars/autologin", "DLC Autologin entries, without secrets (admin role)", None, (),
          obj({"entries": arr(AUTOLOGIN), "groups": arr(STR), "kinds": arr(STR)}), 200, "admin"),
    Route("POST", "/api/admin/sidecars/autologin", "Add an Autologin entry (admin role)", AUTOLOGIN_IN, (),
          AUTOLOGIN, 201, "admin"),
    Route("POST", "/api/admin/sidecars/autologin/{entry}", "Change an Autologin entry; an empty secret keeps the "
          "stored one (admin role)", AUTOLOGIN_IN, (), AUTOLOGIN, 200, "admin"),
    Route("POST", "/api/admin/sidecars/autologin/{entry}:delete", "Delete an Autologin entry (admin role)", None, (),
          obj({"deleted": INT}), 200, "admin"),
    Route("POST", "/api/admin/sidecars/autologin/{entry}:test", "Sign in once with an entry (admin role)", None, (),
          obj({"signed_in": BOOL, "text": STR}), 200, "admin"),
    Route("POST", "/api/admin/sidecars/knowledge:ask", "Ask the knowledge of a project the way its agents do "
          "(admin role)", obj({"rag_project": STR, "question": STR}, ["question"]), (),
          obj({"text": STR, "error": BOOL}), 200, "admin"),
    Route("POST", "/api/agent/{tool}", "An agent's tool call forwarded by `dlc mcp` (loopback only; header "
          "X-DLC-Agent carries the token of that agent call): search_knowledge, list_apps, get_session, "
          "open_page, fetch, run_js, cf_login, cli_login", OBJ, (), obj({"text": STR, "error": BOOL}), 200, "agent"),
    Route("GET", "/api/admin/hooks", "Run hooks: agents that run at an event of every matching run (admin role)",
          None, (), obj({"hooks": arr(HOOK), "events": arr(STR), "wait_events": arr(STR), "agent_events": arr(STR),
                         "roles": arr(STR), "apps": arr(STR),
                         "tests": OBJ}), 200, "admin"),
    Route("POST", "/api/admin/hooks", "Add a run hook (admin role)", HOOK_IN, (), HOOK, 201, "admin"),
    Route("GET", "/api/admin/processes", "The process registry (line.process.registry): id, status, latest version, "
          "owner, flows (admin role)", None, (), obj({"processes": arr(OBJ)}), 200, "admin"),
    Route("POST", "/api/admin/processes", "Save a process draft: the body is a process definition (it may extend "
          "another; docs: process.md); a new id creates the process (admin role)", OBJ, (), OBJ, 201, "admin"),
    Route("GET", "/api/admin/processes/{process}", "One process: versions (immutable), status, history, draft, and the "
          "impact (runs in progress per version, projects bound to it) (admin role)", None, (),
          obj({"process": OBJ, "impact": OBJ}), 200, "admin"),
    Route("POST", "/api/admin/processes/{process}:publish", "Publish the draft as the next version; the process becomes "
          "active (admin role)", obj({"reason": STR}), (), OBJ, 200, "admin"),
    Route("POST", "/api/admin/processes/{process}:status", "Deprecate (no new runs), retire (read only) or re-activate a "
          "process; replaced_by names its successor (admin role)",
          obj({"status": STR, "reason": STR, "replaced_by": STR}, ["status"]), (), OBJ, 200, "admin"),
    Route("GET", "/api/admin/processes/{process}/readiness", "The needs of a process checked against a project now: "
          "which documents and information people still have to supply (admin role)", None,
          (("project", "string"),), obj({"process": STR, "project": STR, "ready": BOOL, "needs": arr(OBJ),
                                         "table": STR}), 200, "admin"),
    Route("POST", "/api/admin/projects/{project}/processes", "Bind a project to a process for a flow: \"<id>\" (latest "
          "active version at each run's start), \"<id>@<n>\" (pinned) or \"\" (unbind) (admin role)",
          obj({"flow": STR, "process": STR}, ["flow"]), (), obj({"project": STR, "processes": OBJ}), 200, "admin"),
    Route("POST", "/api/admin/runs/{run}:adopt-process", "A run parked at a gate goes on with another version of its "
          "process, when the steps it already passed are unchanged there (admin role)",
          obj({"process": STR}, ["process"]), (), obj({"run": STR, "from": STR, "to": STR}), 200, "admin"),
    Route("POST", "/api/admin/hooks/{hook}", "Change a run hook (admin role)", HOOK_IN, (), HOOK, 200, "admin"),
    Route("POST", "/api/admin/hooks/{hook}:delete", "Delete a run hook (admin role)", None, (),
          obj({"deleted": INT}), 200, "admin"),
    Route("POST", "/api/admin/hooks/{hook}:test", "Run a hook once on an existing run, in the background; the run "
          "is not touched. Result in GET /api/admin/hooks tests (admin role)", obj({"run": STR}, ["run"]), (),
          HOOK_RESULT, 200, "admin"),
    Route("GET", "/api/runs/{run}/hooks", "The run's hook results (key '<event>:<hook id>') and the hook holding "
          "it, if any", None, (), obj({"run": STR, "results": OBJ, "hold": OBJ}), 200, "runs"),
    Route("POST", "/api/runs/{run}/hooks/{event}/{hook}:pass", "A person lets a run held by a hook go on (the hook "
          "counts as passed); then resume the run", None, (), obj({"result": HOOK_RESULT}), 200, "runs"),
    Route("GET", "/api/admin/claude-token", "Which Claude setup-token the agents use (admin role)", None, (),
          CLAUDE_TOKEN, 200, "admin"),
    Route("GET", "/api/admin/change-queue", "The change queue of every project and how long a run ready to build "
          "waits for an earlier run that is still being analysed (admin role)", None, (),
          obj({"wait_minutes": INT, "projects": arr(QUEUE)}), 200, "admin"),
    Route("POST", "/api/admin/change-queue", "Set the wait limit: after wait_minutes a run ready to build ignores an "
          "earlier slot that is not planned yet (it leaves the queue; its run stops; a finding is written) (admin "
          "role)", obj({"wait_minutes": INT}, ["wait_minutes"]), (), obj({"wait_minutes": INT}), 200, "admin"),
    Route("GET", "/api/projects/{project}/queue", "The project's change queue: Enhancement and Bug Fix runs analyse "
          "and plan in parallel, then implement, test, merge and deliver one at a time in this order (FIFO)", None,
          (), QUEUE, 200, "projects"),
    Route("POST", "/api/admin/claude-token", "Test a Claude setup-token with a real call, then use it for every "
          "agent call from now on (admin role; no restart)", obj({"token": STR}, ["token"]), (), CLAUDE_TOKEN, 200,
          "admin"),
    Route("GET", "/api/projects/{project}", "One project and its runs (newest first)", None, (),
          obj({"project": PROJECT, "runs": arr(RUN_SUMMARY)}), 200, "projects"),
    Route("POST", "/api/projects/{project}:deliver", "Push the engine's work to the source repository as branch "
          "dlc/<project> (git sources only)", None, (), obj({"project": STR, "branch": STR, "commit": STR}), 200,
          "projects"),
    Route("GET", "/api/workspace", "Folders one level under the workspace root (DLC_WORKSPACE_ROOT; root '' = "
          "none configured), the opened folder itself as current, and what a project started from each would do",
          None, (("path", "string"),),
          obj({"root": STR, "path": STR, "current": WS_FOLDER, "folders": arr(WS_FOLDER)}), 200, "projects"),
    Route("POST", "/api/packs", "Create a spec pack on the engine host from markdown text, or from a bug report",
          obj({"kind": {"type": "string", "enum": ["new", "enhance", "bug"]},
               "name": {"type": "string", "description": "short name (also part of the pack folder name)"},
               "spec": {"type": "string", "description": "the spec as markdown (kind new / enhance)"},
               "report": {"type": "string", "description": "bug: what happened, in free text (a ticket link, pasted "
                                                          "or attached notes); the agents work out the rest"},
               "title": STR, "repro": STR, "expected": STR, "actual": STR, "context": STR}, ["kind"]),
          (), obj({"pack": {"type": "string", "description": "path to pass to POST /api/runs"}, "kind": STR,
                   "name": STR, "chars": INT}), 201, "runs"),
    Route("GET", "/api/runs/{run}", "One run: units, gates, budget, merge, deploy, QAS, escalations", None, (),
          obj({"run": RUN_SUMMARY, "units": arr(OBJ), "gates": arr(OBJ), "budget": OBJ, "merge": arr(OBJ),
               "deploy": arr(OBJ), "qas": arr(OBJ), "escalations": arr(OBJ)}), 200, "runs"),
    Route("GET", "/api/runs/{run}/events", "Events of a run after a sequence number (poll with after_seq)", None,
          (("after_seq", "integer"), ("limit", "integer")),
          obj({"run": STR, "events": arr(EVENT), "last_seq": INT}), 200, "runs"),
    Route("GET", "/api/runs/{run}/questions", "Open questions of a parked run", None, (),
          obj({"run": STR, "parked": BOOL, "park": OBJ, "questions": arr(QUESTION)}), 200, "runs"),
    Route("POST", "/api/runs/{run}/answers", "Answer one or more questions; the run resumes after the last one",
          obj({"qid": STR, "option": STR, "text": STR, "who": STR,
               "answers": arr(obj({"qid": STR, "option": STR, "text": STR}))}),
          (), obj({"results": arr(OBJ), "remaining": INT, "addendum": STR, "version": STR, "resume": BOOL,
                   "resumed": OBJ}), 200, "runs"),
    Route("GET", "/api/runs/{run}/process", "The run's process when it runs from Dify (LINE_PROCESS_SOURCE=dify): "
          "flow, Dify workflow run, executed nodes, forms waiting for a person, outcome", None, (),
          obj({"run": STR, "process": OBJ}), 200, "runs"),
    Route("POST", "/api/runs/{run}/process/forms/{form}", "A person's decision on a form the Dify process waits on",
          obj({"action": STR, "inputs": OBJ, "who": STR}, ["action"]), (),
          obj({"run": STR, "form": STR, "action": STR, "submitted": BOOL}), 200, "runs"),
    Route("POST", "/api/runs/{run}:cancel", "Cancel a run", obj({"reason": STR}), (),
          obj({"run": STR, "state": STR, "cancelling": BOOL}), 200, "runs"),
    Route("POST", "/api/runs/{run}:pause", "Pause a run at any time (resumable, survives a restart)",
          obj({"reason": STR}), (), obj({"run": STR, "state": STR, "paused": BOOL, "stopping": BOOL}), 200, "runs"),
    Route("POST", "/api/runs/{run}:resume", "Resume a paused (or stopped, non-final) run from where it is",
          obj({}), (), obj({"run": STR, "state": STR, "resuming": BOOL}), 200, "runs"),
    Route("POST", "/api/runs:pause_all", "Urgent stop: pause every run that is not finished, at once (running "
          "agents are killed); each can be resumed on its own. Refused (400, nothing stopped) unless confirm is "
          "exactly 'agree force stop'",
          obj({"confirm": STR, "reason": STR}, ["confirm"]), (),
          obj({"paused": arr(STR), "stopping": arr(STR)}), 200, "runs"),
    Route("POST", "/api/runs/{run}:retro", "Learn from a failed run: the retrospective agent records why as a "
          "finding and, for a general rule, a shared lesson (runs in the background; also automatic at a failed "
          "run's end)", obj({}), (), obj({"run": STR, "started": BOOL, "reason": STR}), 200, "runs"),
    Route("GET", "/api/runs/{run}/board", "The run board (the latest status of every step, as the agents see it) "
          "and the run's project messages between agents", None, (),
          obj({"run": STR, "board": OBJ, "messages": arr(OBJ)}), 200, "runs"),
    Route("GET", "/api/runs/{run}/attention", "What a person must do for the run, in plain words: kind hook | "
          "paused | questions | failed | none, what / why / do, the failed unit and its reason, the options",
          None, (), OBJ, 200, "runs"),
    Route("GET", "/api/runs/{run}/decisions", "Every decision taken at the run's gates (line.decisions): entries with "
          "the signal for the agents they judged (positive | mixed | negative | auto), the readable history and the "
          "counts per persona; ?doc=history/<gate>-r<round>-<artifact>.md = a document as the person saw it when "
          "deciding", None, (), obj({"run": STR, "entries": arr(OBJ), "markdown": STR, "signal": OBJ}), 200, "runs"),
    Route("POST", "/api/runs/{run}/gates/{gate}", "A person's decision at the open gate of the gated Enhancement / "
          "Bug Fix flow (line.gates): spec approve | revise, plan approve | revise (target impl | tests | both), final "
          "deploy | hold; note = what to change or the corrected solutions; files = [{name, data (base64)}] PDF, "
          "Word or text, converted and given to the agents. The run resumes by itself",
          obj({"decision": STR, "note": STR, "target": STR, "who": STR,
               "files": arr(obj({"name": STR, "data": STR}, ["name", "data"])),
               "answers": arr(obj({"artifact": STR, "id": STR, "ok": BOOL, "text": STR}, ["artifact", "id"]))},
              ["decision"]), (),
          obj({"gate": STR, "decision": STR, "round": INT, "files": arr(OBJ), "resumed": OBJ}), 200, "runs"),
    Route("POST", "/api/runs/{run}/gates/{gate}/chat", "Talk with the agents of the draft step whose gate is open, "
          "when the process definition says chat: true (line.gatechat): the agent answers on a thread from its "
          "documents, the request and the code, and changes its documents when asked; the conversation is the "
          "gate's messages in GET /api/runs/{run}/attention",
          obj({"message": STR, "who": STR}, ["message"]), (), obj({"gate": STR, "messages": arr(OBJ)}), 202, "runs"),
    Route("POST", "/api/docs:convert", "A PDF or Word (.docx) document as markdown text (line.docread: text and "
          "tables, no OCR): {name, data (base64)} -> {name, kind, pages, chars, warnings, text}",
          obj({"name": STR, "data": STR}, ["name", "data"]), (),
          obj({"name": STR, "kind": STR, "pages": INT, "chars": INT, "warnings": arr(STR), "text": STR}), 200, "runs"),
    Route("POST", "/api/runs/{run}:resolve", "A person settled a failed run (fixed by hand or not needed): the "
          "project's warning goes, the note becomes a finding", obj({"note": STR}, ["note"]), (),
          obj({"run": STR, "resolved": OBJ}), 200, "runs"),
    Route("POST", "/api/runs/{run}:retry", "Run the failed run again in place (same run id, next attempt): it goes "
          "back to the step it failed in, the person's hint added to its spec; 409 for a run that did not fail or "
          "was marked resolved", obj({"hint": STR}), (),
          obj({"run": STR, "state": STR, "attempt": INT, "retry_of": STR}), 202, "runs"),
    Route("POST", "/api/runs/{run}:explain", "A short plain explanation of a failed run from its evidence (one "
          "cheap model call, kept on the run)", obj({}), (), obj({"run": STR, "explain": OBJ}), 200, "runs"),
    Route("GET", "/api/runs/{run}/nodes", "The run's stage nodes in order, with state and counts", None, (),
          obj({"run": STR, "state": STR, "paused": BOOL, "nodes": arr(NODE)}), 200, "runs"),
    Route("GET", "/api/runs/{run}/nodes/{node}/worklog", "What the agents of one node did, oldest first", None,
          (("limit", "integer"),), obj({"run": STR, "node": STR, "entries": arr(WORKLOG)}), 200, "runs"),
    Route("GET", "/api/runs/{run}/reports", "Reports of a run (spec files and generated reports)", None, (),
          obj({"run": STR, "reports": arr(REPORT)}), 200, "runs"),
    Route("GET", "/api/runs/{run}/reports/{report}", "One report's content (text)", None, (),
          obj({"report": REPORT, "content": STR}), 200, "runs"),
    Route("GET", "/api/runs/{run}/app", "State of the app the run deployed (start it from a frontend)", None, (),
          APP, 200, "runs"),
    Route("POST", "/api/runs/{run}/app:start", "Start the deployed app (or return it when it already runs)",
          obj({}), (), APP, 200, "runs"),
    Route("POST", "/api/runs/{run}/app:stop", "Stop the deployed app (admin role when sign-in is on)",
          obj({"reason": STR}), (), APP, 200, "runs"),
    Route("POST", "/api/runs/{run}/app:build", "Desktop app: build it into a zip in the background (flet pack for a "
          "Flet app, else PyInstaller, or dlc.app.json build); poll GET /api/runs/{run}/app for build.state",
          obj({}), (), APP, 200, "runs"),
    Route("GET", "/api/runs/{run}/app/download", "Desktop app: the built zip (application/zip attachment)", None, (),
          {"type": "string", "format": "binary"}, 200, "runs"),
    Route("GET", "/api/runs/{run}/seals", "Seal ledger rows of a run (when sealing is on)", None, (),
          obj({"run": STR, "seals": arr(OBJ)}), 200, "runs"),
    Route("POST", "/api/runs/{run}/seals/{subject}:sign", "Sign or refuse a seal that waits for a person",
          obj({"who": STR, "option": {"type": "string", "enum": ["sign", "refuse"]}}, ["who"]), (),
          obj({"seal": OBJ, "resumed": OBJ}), 200, "runs"),
    Route("GET", "/api/board", "Board projection of one run (newest when run is omitted)", None,
          (("run", "string"),),
          obj({"generated_ms": INT, "runs": arr(RUN_SUMMARY), "run": OBJ, "lanes": OBJ, "units": arr(OBJ),
               "gates": arr(OBJ), "deploy": arr(OBJ), "qas": arr(OBJ), "events": arr(EVENT), "human": OBJ}),
          200, "runs"),
    Route("GET", "/api/metrics", "Outcome metrics", None, (("run", "string"), ("limit", "integer")), OBJ, 200,
          "runs"),
    Route("GET", "/api/migrations", "All feature migrations", None, (), obj({"migrations": arr(MIG_SUMMARY)}), 200,
          "migrations"),
    Route("POST", "/api/migrations", "Start a feature migration (v1 -> v2)",
          obj({"v1": {"type": "string", "description": "old version: a git repository or a folder of repositories"},
               "v2": {"type": "string", "description": "rewrite: a git repository (target, branch main, clean)"},
               "v1_ref": STR, "v1_base": STR, "v2_ref": STR, "v1_repos": STR, "v2_repos": STR, "notes": STR,
               "mode": {"type": "string", "enum": ["ask", "decide"]}, "scope": arr(STR), "build": BOOL,
               "max_usd": NUM, "max_usd_repo": NUM}, ["v1", "v2"]),
          (), obj({"migration": STR, "state": STR}), 202, "migrations"),
    Route("GET", "/api/migrations/{migration}", "One migration: features, conflicts, open questions", None, (),
          obj({"migration": MIG_SUMMARY, "features": arr(OBJ), "conflicts": arr(OBJ),
               "questions": arr(MIG_QUESTION), "run": OBJ}), 200, "migrations"),
    Route("GET", "/api/migrations/{migration}/details", "Repositories, blast radius, effort, decisions, timeline",
          None, (), obj({"repos": OBJ, "blast": OBJ, "effort": OBJ, "decisions": arr(OBJ), "baseline": OBJ,
                         "verify": OBJ, "runs": arr(OBJ), "timeline": arr(OBJ)}), 200, "migrations"),
    Route("GET", "/api/migrations/{migration}/report", "The parity report (markdown)", None, (),
          obj({"migration": STR, "report": STR, "ready": BOOL}), 200, "migrations"),
    Route("POST", "/api/migrations/{migration}/answers", "Decide open conflicts / decisions of a parked migration",
          obj({"answers": arr(obj({"conflict": STR, "choice": STR}, ["conflict", "choice"])), "who": STR},
              ["answers"]),
          (), obj({"results": arr(OBJ), "remaining": INT, "resume": BOOL}), 200, "migrations"),
    Route("POST", "/api/migrations/{migration}:resume", "Continue a migration (e.g. after raising its budget)",
          obj({"max_usd": NUM, "max_usd_repo": NUM, "rescan": BOOL}), (), obj({"migration": STR, "resuming": BOOL}),
          200, "migrations"),
]


#: routes that never need a token
PUBLIC_TEMPLATES = frozenset({"/api/health", "/api/openapi.json", "/api/auth/config", "/api/catalog"})


def _regex(template: str) -> "re.Pattern[str]":
    out, pos = "", 0
    for m in re.finditer(r"\{(\w+)\}", template):
        out += re.escape(template[pos:m.start()])
        out += "(?P<%s>.+)" % m.group(1) if m.group(1) == "subject" else "(?P<%s>[^/:]+)" % m.group(1)
        pos = m.end()
    out += re.escape(template[pos:])
    return re.compile("^" + out + "$")


_COMPILED = [(r, _regex(r.template)) for r in ROUTES]


def match(method: str, path: str) -> Optional[Route]:
    for r, rx in _COMPILED:
        if r.method == method and rx.match(path):
            return r
    return None


def openapi(server_url: str = "") -> Dict[str, Any]:
    paths: Dict[str, Any] = {}
    for r in ROUTES:
        params = [{"name": n, "in": "path", "required": True, "schema": STR} for n in re.findall(r"\{(\w+)\}", r.template)]
        params += [{"name": n, "in": "query", "required": False, "schema": {"type": t}} for n, t in r.query]
        op: Dict[str, Any] = {"summary": r.summary, "tags": [r.tag],
                              "operationId": (r.method.lower() + "_" + re.sub(r"[^a-z0-9]+", "_", r.template.lower())).strip("_"),
                              "responses": {str(r.status): {"description": "OK", "content": {
                                  "application/json": {"schema": r.response}}},
                                  "400": {"description": "invalid request",
                                          "content": {"application/json": {"schema": ERROR}}},
                                  "404": {"description": "unknown run / migration / route",
                                          "content": {"application/json": {"schema": ERROR}}},
                                  "409": {"description": "state conflict",
                                          "content": {"application/json": {"schema": ERROR}}}}}
        if r.template not in PUBLIC_TEMPLATES:
            op["security"] = [{"bearer": []}]
            op["responses"]["401"] = {"description": "missing or invalid bearer token (sign-in on)",
                                      "content": {"application/json": {"schema": ERROR}}}
            op["responses"]["403"] = {"description": "the token lacks the needed role",
                                      "content": {"application/json": {"schema": ERROR}}}
        if params:
            op["parameters"] = params
        if r.body is not None:
            op["requestBody"] = {"required": True, "content": {"application/json": {"schema": r.body}}}
        paths.setdefault(r.template, {})[r.method.lower()] = op
    doc: Dict[str, Any] = {"openapi": "3.0.3",
                           "info": {"title": "DLC engine API", "version": __version__,
                                    "description": "Delivery line engine: runs (New System, Enhancement, Bug Fix) "
                                                   "and feature migrations. When sign-in is on (GET /api/auth/config "
                                                   "says enabled), every route except health, this document and "
                                                   "the auth config needs 'Authorization: Bearer <access token>' "
                                                   "from the configured OIDC realm."},
                           "paths": paths,
                           "components": {"schemas": {"Error": ERROR},
                                          "securitySchemes": {"bearer": {"type": "http", "scheme": "bearer",
                                                                         "bearerFormat": "JWT"}}}}
    if server_url:
        doc["servers"] = [{"url": server_url}]
    return doc


__all__ = ["ROUTES", "Route", "match", "openapi", "PUBLIC_TEMPLATES"]
