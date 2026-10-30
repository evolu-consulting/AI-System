"""Tools the agents call during a run, served by the engine (broker pattern).

An agent (Claude CLI) gets one stdio MCP server, `dlc mcp` (line.agent_mcp), which holds no secret: it only
forwards each tool call to this engine on 127.0.0.1 with a token issued for that one agent call. The engine
already holds the RAG System credentials and the sidecar vaults, so it does the work and answers in text:

  search_knowledge(question)      the run's RAG System project (decisions, fixes, lessons, worklog), then the
                                  shared lessons project: what a person gets from the knowledge store
  code_graph(op, ...)             the target repository's Graphify index (line.codegraph): query / explain /
                                  affected / path / hubs, answered locally without a model; only when indexed
  list_apps / get_session / open_page / fetch / run_js / cf_login / cli_login
                                  DLC Autologin (line.sidecar.autologin): only the entries whose roles allow
                                  this agent's group (dev / deploy / test)

POST /api/agent/<tool> {args}   header X-DLC-Agent: <token>   from 127.0.0.1 only   -> {"text", "error"?}

A token names the run, the agent role and the run's RAG project; it is dropped when its call ends (and
expires after AGENT_TOKEN_TTL_S whatever happens).
"""

from __future__ import annotations

import contextvars
import secrets
import threading
import time
from typing import Any, Dict, List, Optional

AGENT_TOKEN_TTL_S = 4 * 3600
ENGINE_URL = ""          # set by line.server when it starts: agents reach the engine here (loopback)

#: agent role -> the group an Autologin entry allows (dev / deploy / test)
ROLE_GROUP = {"hook": "hook", "spec_analyst": "spec", "builder": "dev", "fixer": "dev", "merger": "merge",
              "test_author": "test", "tester": "test", "qas": "test",
              "deployer": "deploy", "deploy": "deploy"}
KNOWLEDGE_TOOLS = ["search_knowledge"]
#: the run board and the run's project messages (line.runboard / line.agent_messages): while the run is driven
BOARD_TOOLS = ["read_board", "post_message"]
#: the working-memory tools (line.agent_memory): every agent of a run gets them when the store is on
from .agent_memory import TOOLS as MEMORY_TOOLS  # noqa: E402
SESSION_TOOLS = ["list_apps", "get_session", "open_page", "fetch", "run_js", "cf_login", "cli_login",
                 "release_app"]

_lock = threading.Lock()
_tokens: Dict[str, Dict[str, Any]] = {}
#: the agent call in progress on this thread: {"run", "role"} (set by line.llm.caps around an agentic call)
CURRENT: contextvars.ContextVar = contextvars.ContextVar("dlc_agent_call", default=None)
#: a run hook's call (line.hooks): {"apps": [Autologin entry names]}; its sessions are exactly those entries
HOOK_SCOPE: contextvars.ContextVar = contextvars.ContextVar("dlc_hook_call", default=None)


def group_of(role: str) -> str:
    r = (role or "").lower()
    return ROLE_GROUP.get(r) or ("test" if "test" in r or "qa" in r else "deploy" if "deploy" in r else "dev")


def issue(run: str, role: str, rag_project: str = "", shared_project: str = "") -> str:
    tok = secrets.token_urlsafe(24)
    hook = HOOK_SCOPE.get()
    with _lock:
        now = time.time()
        for k in [k for k, v in _tokens.items() if v["exp"] < now]:
            _tokens.pop(k, None)
        _tokens[tok] = {"run": run, "role": role, "group": group_of(role), "rag_project": rag_project,
                        "shared_project": shared_project, "exp": now + AGENT_TOKEN_TTL_S,
                        "apps": list(hook.get("apps") or []) if hook is not None else None}
    return tok


def revoke(tok: str) -> None:
    """The agent call ended: its token goes, and so do the apps it held and its places in line."""
    with _lock:
        _tokens.pop(tok, None)
    from .sidecar import app_locks
    app_locks.release_all(tok)


def scope(tok: str) -> Optional[Dict[str, Any]]:
    with _lock:
        s = _tokens.get(tok or "")
        if s and s["exp"] >= time.time():
            return dict(s)
    return None


def tools_for(role: str) -> List[str]:
    """The tools an agent of this role gets: knowledge always; sessions when some entry allows its group."""
    from . import codegraph
    from .sidecar import asm, autologin
    names = list(KNOWLEDGE_TOOLS) + list(MEMORY_TOOLS)
    run = str((CURRENT.get() or {}).get("run") or "")
    if codegraph.attached(run) is not None:
        names.append(codegraph.TOOL)               # the run's target has a Graphify index (line.codegraph)
    from . import runboard
    if runboard._ctx(run) is not None:
        names += BOARD_TOOLS                       # the run board + project messages (line.runboard)
    hook = HOOK_SCOPE.get()
    if hook is not None:
        named = list(hook.get("apps") or [])
        return names + (SESSION_TOOLS if autologin.entries_named(named) or (named and asm.enabled()) else [])
    if autologin.entries_for(group_of(role)) or asm.enabled():   # the person's App Session Manager sessions
        names += SESSION_TOOLS
    return names


# ------------------------------------------------------------------ handlers

def _knowledge(cfg: Any, sc: Dict[str, Any], args: Dict[str, Any]) -> str:
    from .rag.http_adapter import HttpRagAdapter
    from .ragmap import enabled, run_cfg
    q = str(args.get("question") or args.get("query") or "").strip()
    if not q:
        raise ValueError("question is required")
    if not enabled(cfg):
        raise ValueError("This engine has no knowledge store configured (LINE_RAG is not http).")
    chars = max(500, min(int(args.get("max_chars") or 4000), 8000))
    rag = HttpRagAdapter.from_config(run_cfg(cfg, sc.get("rag_project") or ""))
    hits = rag.retrieve(sc.get("role") or "agent", "ask", ["*"], chars, query=q) or []
    text = "\n\n".join(h.get("text", "") for h in hits if h.get("text")).strip()
    return text or "Nothing in the project's knowledge matches this question."


def ask(cfg: Any, rag_project: str, question: str) -> Dict[str, Any]:
    """Admin > Sidecars > Project knowledge: the answer an agent of a run on this project would get."""
    try:
        return {"text": _knowledge(cfg, {"rag_project": rag_project, "role": "agent"}, {"question": question})}
    except ValueError as e:
        return {"text": str(e), "error": True}
    except Exception as e:   # noqa: BLE001
        return {"text": "The project's knowledge store did not answer: %s" % e, "error": True}


def handle(cfg: Any, tool: str, tok: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """{"text"} or {"text", "error": True}. Raises PermissionError for a bad token or a tool out of scope."""
    sc = scope(tok)
    if sc is None:
        raise PermissionError("unknown or expired agent token")
    if tool in KNOWLEDGE_TOOLS:
        try:
            return {"text": _knowledge(cfg, sc, args)}
        except ValueError as e:
            return {"text": str(e), "error": True}
        except Exception as e:   # noqa: BLE001 - the store being down is an answer, not a crash
            return {"text": "The project's knowledge store did not answer: %s" % e, "error": True}
    if tool in BOARD_TOOLS:
        from . import agent_messages, runboard
        run = str(sc.get("run") or "")
        ctx = runboard._ctx(run)
        if ctx is None:
            return {"text": "This run has no board (it is not being driven now).", "error": True}
        store, rcfg, project = ctx
        if tool == "read_board":
            return {"text": runboard.text(store, run) or "The board of this run is empty so far."}
        try:
            m = agent_messages.post(store, rcfg, project, run, str(sc.get("role") or "agent"), args.get("to") or "all",
                                    str(args.get("kind") or "note"), str(args.get("text") or ""),
                                    str(args.get("reply_to") or ""))
        except ValueError as e:
            return {"text": str(e), "error": True}
        return {"text": "Posted to %s in the run's project (message %s)." % (", ".join("@" + t for t in m["to"]), m["id"])}
    if tool == "code_graph":
        from . import codegraph
        try:
            return {"text": codegraph.ask(cfg, str(sc.get("run") or ""), str(args.get("op") or "query"), args)}
        except ValueError as e:
            return {"text": str(e), "error": True}
    if tool in MEMORY_TOOLS:
        from . import agent_memory
        try:
            return {"text": agent_memory.handle(cfg, sc, tool, args, tok)}
        except ValueError as e:
            return {"text": str(e), "error": True}
        except Exception as e:   # noqa: BLE001
            return {"text": "The project's knowledge store did not answer: %s" % e, "error": True}
    if tool in SESSION_TOOLS:
        from .sidecar import autologin
        try:
            return {"text": autologin.call(tool, sc["group"], args, apps=sc.get("apps"), holder=tok,
                                           label="%s of run %s" % (sc.get("role") or "agent", sc.get("run") or "-"))}
        except ValueError as e:
            return {"text": str(e), "error": True}
    raise PermissionError("no tool %s" % tool)


__all__ = ["HOOK_SCOPE", "ask", "issue", "revoke", "scope", "tools_for", "handle", "group_of", "ENGINE_URL", "KNOWLEDGE_TOOLS",
           "SESSION_TOOLS"]
