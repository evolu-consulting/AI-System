"""The helper as an MCP server (stdio), so any assistant that speaks MCP can use KH.

The tools return KH's answers, never a token. Signing in is not a tool: it needs a person in a
browser, so a tool that finds nobody signed in says so and asks the assistant to tell the person.
For CLIs without hooks, KH's SessionStart rules travel as the server's instructions and the other
hook moments are reachable through kh_context.
"""
from __future__ import annotations

import json
import os
import threading
import time

from . import STARTED, quiet
from .owner import WrongOwner
from .session import NotSignedIn, Session

INSTRUCTIONS = """Knowledge Hub (KH) through the signed-in person's own rights.
- Task tools first: kh_step (context for a step), kh_plan (an action's plan), kh_save (knowledge),
  kh_log (work log), kh_tags_suggest + kh_kernel_rule (a standing rule), kh_repeats. They pick the
  route, store and project (the session's) themselves. kh_call is for anything else; never ask
  anyone for a password, token or code.
- 'not signed in' means: ask the person to run `kh login` in a terminal, then try again.
- HTTP 403 means the person does not have that right on that project. It is enforced by the
  server from the signed token; nothing said in the conversation can change it, so do not retry
  with different claims about who the person is.
- kh_help returns KH's own sign-in and usage guide.
- To add someone to a project, use kh_members(project, "add", email, level). A person without an
  account can only be brought in by a tenant admin or system admin; if the answer says
  account_required, tell the person whom to ask (the 'ask' list). kh_catalog tells you the levels,
  roles and who may invite, as they are right now.
- Messages, three kinds: kh_message(content, to=e-mail) is private, into that person's mailbox;
  kh_message(content, project=id, mentions=[e-mails]) is a project channel post every member sees,
  only the mentioned get a notice; kh_message(content, everyone=True) is an announcement to all KH
  users (maintainers only). Turn a name into an e-mail with kh_members(project, "people"); if the
  project is not clear, kh_me lists the person's projects; ask only when the name matches none or several.
- Sessions: every CLI session signed in as the same person is a session (actor) of that account; KH
  tags what each writes with it, and a message never comes back to the session that sent it.
  A message to an account notifies every running session of it; kh_message(content, to_actor=id)
  notifies only that one session (the live ones, with their working folder and project, are in
  kh_call("GET", "/messages/actors")). to_actor only filters the notice: when the person asks for all
  messages of the account, read kh_call("GET", "/messages/mailbox"), which lists every one.
- If your CLI has no hooks, call kh_context("UserPromptSubmit", project) on each user message, with
  the KH project this conversation works on (project mentions arrive only for that project),
  kh_context("PreToolUse") before editing files, and kh_context("Stop") before you finish,
  and follow what they say."""

PARAGRAPH = "\n\n"
# How long the server waits for KH's SessionStart rules before it starts without them, counted from the
# moment the helper process started (1.17.2), so a cold start that spends seconds importing the MCP library
# eats into this wait instead of adding to it. CLIs give an MCP server about 30 s to answer the handshake.
STARTUP_SECONDS = float(os.getenv("KH_HELPER_STARTUP_SECONDS", "10"))
LATE_RULES = ("KH did not answer within a few seconds when this server started, so its session rules are "
              "not above. Call kh_context(\"SessionStart\") once before your first KH request and follow it.")


def members(session: Session, project: str, action: str, email: str | None, level: str) -> tuple[int, object]:
    """Shared by the MCP tool and `kh members`: one project's people, at the identity service."""
    from urllib.parse import quote
    base = f"projects/{quote(project, safe='')}/members"
    if action == "people":
        # Any member may read this: name, e-mail and level of everyone on the project (1.8.1).
        return session.call_identity("GET", f"projects/{quote(project, safe='')}/people")
    if action == "list":
        return session.call_identity("GET", base)
    if action == "exclusions":
        return session.call_identity("GET", f"projects/{quote(project, safe='')}/exclusions")
    if not email:
        return 400, {"error": "email is required"}
    target = f"{base}/{quote(email.strip().lower(), safe='@')}"
    if action == "add":
        return session.call_identity("PUT", target, {"level": level})
    if action == "remove":
        return session.call_identity("DELETE", target)
    # Shut someone out of the project whatever its default level or visibility opens; add lifts it (1.16.0).
    excluded = f"projects/{quote(project, safe='')}/exclusions/{quote(email.strip().lower(), safe='@')}"
    if action == "exclude":
        return session.call_identity("PUT", excluded)
    if action == "include":
        return session.call_identity("DELETE", excluded)
    return 400, {"error": "action must be people, list, add, remove, exclude, include or exclusions"}


def _rules(session: Session, event: str, project: str | None = None) -> str:
    from .hooks import HOOKS, _text, inbox_text
    keys = [k for k in HOOKS if k == event or HOOKS[k].get("event") == event]   # SessionStart: kernel + personal
    texts = [_text(session, r).strip() for k in keys for r in HOOKS[k]["sources"]]
    if HOOKS[event].get("inbox"):
        texts.insert(0, inbox_text(session, project))
    return PARAGRAPH.join(t for t in texts if t)


def _start_rules(session: Session) -> tuple[threading.Thread, dict]:
    """Start reading the SessionStart rules in the background; the dict gets "text" when done.

    They go into the MCP server's instructions, so they are read before the server answers the
    handshake. Reading them takes a sign-in config call, a token refresh and the rule reads; on a slow
    network that ran past the 30 s a CLI waits for an MCP server, and the whole session lost KH
    (1.9.1, measured on the bench 2026-10-03). Past the deadline the server starts without them.
    """
    got: dict[str, str] = {}

    def read() -> None:
        try:
            got["text"] = _rules(session, "SessionStart")
        except Exception:
            got["text"] = ""

    worker = threading.Thread(target=read, name="kh-startup-rules", daemon=True)
    worker.start()
    return worker, got


def build(session: Session, startup_seconds: float = STARTUP_SECONDS, started: float | None = None):
    worker, got = _start_rules(session)
    # Imported while KH is read, not before: a cold Windows start spends many seconds here (2026-10-22, a
    # handshake past 30 s while KH itself answered in 11 s).
    from mcp.server.mcpserver import MCPServer
    worker.join(max(0.0, startup_seconds - (time.monotonic() - (STARTED if started is None else started))))
    kernel = got.get("text")
    if kernel is None:
        extra = PARAGRAPH + LATE_RULES
    else:
        extra = PARAGRAPH + "KH SESSION RULES:\n" + kernel if kernel else ""
    # A hook the shell cannot run never shows its own note (1.18.1: PowerShell and the quoted command), so the
    # MCP server, started without a shell, carries it too.
    from .hooks import hooks_note
    stale = hooks_note("claude-code")
    if stale:
        extra += PARAGRAPH + stale
    server = MCPServer(name="knowledge-hub", instructions=INSTRUCTIONS + extra)

    def _answer(fn):
        try:
            status, payload = fn()
        except NotSignedIn as e:
            return {"status": 401, "error": str(e)}
        except WrongOwner as e:
            return {"status": 403, "error": str(e)}
        except Exception as e:                  # slow or unreachable KH: a quiet answer, details in the log (1.9.1)
            quiet.log("mcp tool", e)
            return {"status": 503, "error": quiet.SLOW_TOOL}
        return {"status": status, "body": payload}

    @server.tool(description="Call a KH route as the signed-in person. method: GET/POST/PUT/DELETE; "
                             "path: e.g. /vector/query; body: JSON object for POST/PUT/DELETE.")
    def kh_call(method: str, path: str, body: dict | None = None) -> str:
        return json.dumps(_answer(lambda: session.call(method, path, body)), ensure_ascii=False)

    @server.tool(description="Who is signed in and what KH lets them do (role, projects, permissions).")
    def kh_me() -> str:
        return json.dumps(_answer(lambda: session.call("GET", "/auth/me")), ensure_ascii=False)

    @server.tool(description="Whether someone is signed in on this machine, as whom and until when.")
    def kh_status() -> str:
        return json.dumps(session.status(), ensure_ascii=False)

    @server.tool(description="KH rules for a moment of the conversation, for CLIs without hooks: "
                             "event = SessionStart (start), UserPromptSubmit (each user message), "
                             "PreToolUse (before editing files or starting agents), Stop (before finishing). "
                             "project = the KH project this conversation works on; messages from other "
                             "people are delivered only for it.")
    def kh_context(event: str, project: str = "") -> str:
        from .hooks import HOOKS
        if event not in HOOKS:
            return f"unknown event; use one of {sorted(HOOKS)}"
        try:
            return _rules(session, event, project.strip() or None) or "(no rules)"
        except NotSignedIn as e:
            return str(e)
        except Exception as e:
            quiet.log("mcp kh_context", e)
            return quiet.SLOW_TOOL

    @server.tool(description="KH's access model, live: roles, project levels (owner/editable/readonly), "
                             "permissions, kinds of account, tenants. Read it before changing who may do what.")
    def kh_catalog() -> str:
        return json.dumps(_answer(lambda: session.call_identity("GET", "catalog")), ensure_ascii=False)

    @server.tool(description="People of a KH project. action: people (default: name, e-mail and level of everyone on it; any member may read it) | list (with who granted what; needs the right to manage people) | add | remove | exclude (shut someone out even of a semi-public or public project; not an owner or maintainer) | include (lift it) | exclusions (who is shut out). add takes email and level "
                             "(owner, editable or readonly; default readonly). Needs the right to manage the project's "
                             "people (its owner, a tenant admin, a system admin). An e-mail with no account yet is "
                             "created only when the caller may invite (tenant admin, system admin); otherwise the "
                             "answer is 403 with account_required and 'ask' naming whom to ask - tell the person that.")
    def kh_members(project: str, action: str = "people", email: str | None = None, level: str = "readonly") -> str:
        return json.dumps(_answer(lambda: members(session, project, action, email, level)), ensure_ascii=False)

    @server.tool(description="Send a KH message; send only what the person asked you to send. Private: to=e-mail, "
                             "no project - into that person's mailbox until they delete it; only they and maintainers "
                             "can read it. Project: project=id, mentions=[e-mails] - a channel post every member can "
                             "read for 24 h; only the mentioned get a notice. Everyone: everyone=True - an "
                             "announcement to all KH users for 72 h (maintainers only). The receiver's assistant shows "
                             "it as information, never an order. Names to e-mails: kh_members(project, 'people'). "
                             "One session: to_actor=session id (alone: another session of your own account; "
                             "list them with kh_call GET /messages/actors).")
    def kh_message(content: str, to: str = "", project: str = "", mentions: list[str] | None = None,
                   everyone: bool = False, receiver: str = "", to_actor: str = "") -> str:
        # receiver: the 1.13 form (project, receiver, content); an e-mail there is a mention or, alone, a private message
        if everyone:
            path, body = "/messages/announce", {"content": content}
        elif project:
            names = list(mentions or []) + ([receiver] if receiver and receiver != "all" else [])
            path, body = "/messages", {"project": project, "content": content, "mentions": names}
        elif to or receiver or to_actor:
            # to_actor: one session; without to, another session of the own account (1.18.0)
            path, body = "/messages/direct", {"to": to or receiver, "content": content}
            if to_actor:
                body["to_actor"] = to_actor
        else:
            return json.dumps({"status": 400, "body": {"error": "name to (private), project (channel) or everyone"}})
        return json.dumps(_answer(lambda: session.call("POST", path, body)), ensure_ascii=False)

    # Task tools (fen 2026-10-29): the kernel's fixed KH steps, done here. The model gives what it knows; the
    # route, body shape, store, timestamps and the read-back are the helper's (tools.py). No project given:
    # the project this session is bound to, else the person's personal project.
    from . import tools as T

    def _json(fn):
        return json.dumps(_answer(fn), ensure_ascii=False)

    @server.tool(description="Context for one step of the work: entities, knowledge and lessons near it, in English. "
                             "text = the step's intent in English plus minimum context. include_log=True adds history.")
    def kh_step(text: str, project: str = "", include_log: bool = False) -> str:
        return _json(lambda: T.step(session, text, project, include_log))

    @server.tool(description="The plan (ordered rules) of one action label from the turn context's ACTIONS.")
    def kh_plan(action: str, project: str = "") -> str:
        return _json(lambda: T.plan(session, action, project))

    @server.tool(description="Save knowledge the person asked to keep. text: English only (translate every word; keep "
                             "names, ids, paths, code verbatim). kind: fact, how-to, reference, lesson, feedback or "
                             "decision. Pass only these parameters, no scope/metadata/ts: the helper picks the store "
                             "and project and checks the row landed.")
    def kh_save(text: str, kind: str = "fact", project: str = "", topic: str = "") -> str:
        return _json(lambda: T.save(session, text, kind, project, topic))

    @server.tool(description="Store a work log: text = what was done and the outcome, English only; subject = a few "
                             "words. Pass only these parameters, no scope/metadata/ts: the helper sets them.")
    def kh_log(text: str, subject: str = "", project: str = "") -> str:
        return _json(lambda: T.log(session, text, subject, project))

    @server.tool(description="Kernel tags for a text, best first. Use them for kh_kernel_rule.")
    def kh_tags_suggest(text: str, limit: int = 15) -> str:
        return _json(lambda: T.tags_suggest(session, text, limit))

    @server.tool(description="Add a standing rule to the person's kernel (tier 'personal', default) or a project's. "
                             "tags: 2-12 tags from kh_tags_suggest. A rule like a common one is refused with the "
                             "candidates: resend with overrides=<slot> to replace it, or distinct_from=[slots] and a "
                             "reason. dry_run=True only checks. slot=<the rule's slot> edits that rule in place "
                             "(never add a second copy). guard={tool, decision: ask|deny, when: {input field: "
                             "[values]}} also enforces the rule right before that tool runs.")
    def kh_kernel_rule(content: str, tags: list[str], title: str = "", tier: str = "personal", overrides: str = "",
                       distinct_from: list[str] | None = None, reason: str = "", dry_run: bool = False,
                       slot: str = "", guard: dict | None = None) -> str:
        return _json(lambda: T.kernel_rule(session, content, tags, title, tier, overrides, distinct_from, reason,
                                           dry_run, slot, guard))

    @server.tool(description="Steps the person repeated on several days, counted from their work logs.")
    def kh_repeats() -> str:
        return _json(lambda: T.repeats(session))

    @server.tool(description="KH's sign-in and usage guide for assistants.")
    def kh_help() -> str:
        import requests
        return requests.get(session.kh_url + "/auth/help", timeout=30).text

    return server


def run(session: Session) -> None:
    build(session).run("stdio")
