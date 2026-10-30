"""Run hooks: agents an admin adds in Admin > Run hooks, without a new engine build.

A hook says WHEN (an event of the run), FOR WHICH runs (projects, flows), WHAT (a prompt in plain words), WITH
WHICH accounts (Autologin entries by name) and whether the run WAITS for it:

  event        run_start      before the spec is frozen (a run_start hook may write spec_addendum.md: the engine
                              appends it to spec.md, so the readers, the test author and the builders see it)
               after_plan     the plan is ready, before the build
               before_qas     every unit merged, before deploy + QAS
               before_green   QAS is green, before the run is marked green
               run_done       the run ended green            (never waits)
               run_failed     the run ended escalated         (never waits)
  mode         background     runs beside the run; its result is only recorded
               wait           the run waits for its verdict: the agent ends with SUBMIT (go on) or
                              BLOCKED:<reason> (hold)
  on_block     wait           the run is parked (run.parked, hook.blocked) until someone resumes it (the hook is
                              asked again) or passes the hook by hand (POST /api/runs/{id}/hooks/{key}:pass)
               stop           the run ends escalated with HOOK_STOP
  on_error     continue       a crash, max turns or budget of a waiting hook is logged and the run goes on
               wait           ... parks the run like a block

An agent of a hook is an agentic Claude CLI call (role 'hook'; the whole tool set behind the guard hook, plus
the run's `dlc mcp` tools). Its sessions are exactly the Autologin entries the hook names in `apps`, whatever
their agent groups. It works in DLC_HOME/hooks/work/<run>/<key>/ where the engine first writes context.md:
the run, its spec, repository, branch, commits, reports and earlier hooks' results.

Agent hooks (scope 'agent') act on every agent call instead of a run event, for all agents or the roles they
name (a role matches by prefix: 'reader' covers reader_a and reader_b), like Claude Code's own hooks:

  agent_start   the prompt is added to every matching agent call's prompt (standing instructions: 'always ...');
                no extra model call
  before_tool   'pattern' (a regular expression) is checked against every shell command of a matching agent by
                the guard (`dlc hook guard`); a match refuses the command and the prompt is the reason the agent
                reads

Storage: DLC_HOME/hooks.json (the hooks; no secrets) and DLC_HOME/hooks/runs/<run>.json (each run's results,
key = '<event>:<hook id>'). A hook that passed (or was passed by hand) is not asked again when a run resumes.

GET  /api/admin/hooks                          {"hooks", "events", "wait_events", "tests"}
POST /api/admin/hooks {hook}                   add -> hook
POST /api/admin/hooks/{id} {hook}              change
POST /api/admin/hooks/{id}:delete
POST /api/admin/hooks/{id}:test {"run"}        run the hook once on that run (in the background; result in
                                               GET .../hooks "tests"); a test never parks or stops the run
GET  /api/runs/{id}/hooks                      {"run", "results"}
POST /api/runs/{id}/hooks/{key}:pass           a person lets a held run go on (then :resume the run)
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from .contracts import E_RUN, now_ms

ROLE = "hook"
SCOPES = ("run", "agent")
AGENT_EVENTS = ("agent_start", "before_tool")
#: roles offered in Admin (an agent hook may name any role; a role matches by prefix)
ROLES = ("spec_analyst", "reader", "test_author", "planner", "builder", "reviewer", "fixer", "merger", "qas",
         "deployer", "judge", "hook")
MAX_INSTRUCTIONS = 8_000
EVENTS = ("run_start", "after_plan", "before_qas", "before_green", "run_done", "run_failed")
WAIT_EVENTS = ("run_start", "after_plan", "before_qas", "before_green")
MODES = ("background", "wait")
ON_BLOCK = ("wait", "stop")
ON_ERROR = ("continue", "wait")
FAILED_OUTCOMES = ("max_turns", "budget", "no_outcome")
ADDENDUM = "spec_addendum.md"
MAX_PROMPT = 20_000
MAX_SPEC = 60_000
RUNNING_STALE_MS = 6 * 3600 * 1000      # a background hook 'running' longer than this died with its process

_lock = threading.Lock()
_tests: Dict[int, Dict[str, Any]] = {}


def _home() -> str:
    return os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")


def path() -> str:
    return os.path.join(_home(), "hooks.json")


def _results_path(run: str) -> str:
    return os.path.join(_home(), "hooks", "runs", re.sub(r"[^A-Za-z0-9_.-]", "_", run) + ".json")


def _write_json(p: str, d: Any) -> None:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(d, fh, indent=1)
    os.replace(tmp, p)


def _read_json(p: str, default: Any) -> Any:
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


# ------------------------------------------------------------------ the hooks (admin)

def listing() -> List[Dict[str, Any]]:
    d = _read_json(path(), {})
    return list(d.get("hooks") or []) if isinstance(d, dict) else []


def get(hid: int) -> Optional[Dict[str, Any]]:
    return next((h for h in listing() if int(h.get("id") or 0) == int(hid)), None)


def _names(v: Any) -> List[str]:
    if isinstance(v, str):
        v = re.split(r"[,\n]", v)
    return [str(x).strip() for x in (v or []) if str(x).strip()][:50]


def _clean(body: Dict[str, Any], old: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    h = dict(old or {"enabled": True, "scope": "run", "event": "run_done", "mode": "background", "on_block": "wait",
                     "on_error": "continue", "projects": [], "flows": [], "apps": [], "roles": [], "pattern": "",
                     "max_turns": 30, "max_usd": 1.5})
    h.setdefault("scope", "run")
    if "scope" in body:
        h["scope"] = str(body.get("scope") or "run").strip()
    if h["scope"] not in SCOPES:
        raise ValueError("scope must be one of %s" % ", ".join(SCOPES))
    if "roles" in body:
        h["roles"] = [x.lower() for x in _names(body.get("roles"))]
    if "pattern" in body:
        h["pattern"] = str(body.get("pattern") or "").strip()
    if h["scope"] == "agent":
        return _clean_agent(body, h)
    for k in ("name", "prompt"):
        if k in body:
            h[k] = str(body.get(k) or "").strip()
    for k in ("event", "mode", "on_block", "on_error"):
        if k in body:
            h[k] = str(body.get(k) or "").strip()
    for k in ("projects", "flows", "apps"):
        if k in body:
            h[k] = _names(body.get(k))
    if "enabled" in body:
        h["enabled"] = bool(body.get("enabled"))
    if "max_turns" in body:
        h["max_turns"] = max(1, min(int(body.get("max_turns") or 30), 200))
    if "max_usd" in body:
        h["max_usd"] = max(0.05, min(float(body.get("max_usd") or 1.5), 50.0))
    if not h.get("name"):
        raise ValueError("name is required")
    if not h.get("prompt"):
        raise ValueError("prompt is required")
    if len(h["prompt"]) > MAX_PROMPT:
        raise ValueError("prompt is longer than %d characters" % MAX_PROMPT)
    if h["event"] not in EVENTS:
        raise ValueError("event must be one of %s" % ", ".join(EVENTS))
    if h["mode"] not in MODES:
        raise ValueError("mode must be one of %s" % ", ".join(MODES))
    if h["mode"] == "wait" and h["event"] not in WAIT_EVENTS:
        raise ValueError("a %s hook cannot hold the run (the run has ended): use mode background" % h["event"])
    if h["on_block"] not in ON_BLOCK:
        raise ValueError("on_block must be one of %s" % ", ".join(ON_BLOCK))
    if h["on_error"] not in ON_ERROR:
        raise ValueError("on_error must be one of %s" % ", ".join(ON_ERROR))
    return h


def _clean_agent(body: Dict[str, Any], h: Dict[str, Any]) -> Dict[str, Any]:
    for k in ("name", "prompt", "event"):
        if k in body:
            h[k] = str(body.get(k) or "").strip()
    if "enabled" in body:
        h["enabled"] = bool(body.get("enabled"))
    if h.get("event") not in AGENT_EVENTS:
        h["event"] = "agent_start" if "event" not in body else h.get("event")
    if not h.get("name"):
        raise ValueError("name is required")
    if h["event"] not in AGENT_EVENTS:
        raise ValueError("an agent hook's event must be one of %s" % ", ".join(AGENT_EVENTS))
    if not h.get("prompt"):
        raise ValueError("prompt is required (agent_start: the instructions; before_tool: why the command is refused)")
    if len(h["prompt"]) > MAX_INSTRUCTIONS:
        raise ValueError("prompt is longer than %d characters" % MAX_INSTRUCTIONS)
    if h["event"] == "before_tool":
        if not h.get("pattern"):
            raise ValueError("pattern is required for before_tool (a regular expression on the shell command)")
        try:
            re.compile(h["pattern"], re.I)
        except re.error as e:
            raise ValueError("pattern is not a valid regular expression: %s" % e)
    return h


def add(body: Dict[str, Any], by: str = "") -> Dict[str, Any]:
    with _lock:
        hooks = listing()
        h = _clean(body)
        h.update(id=max([int(x.get("id") or 0) for x in hooks] + [0]) + 1, created_ms=now_ms(), by=by)
        hooks.append(h)
        _write_json(path(), {"hooks": hooks})
    return h


def change(hid: int, body: Dict[str, Any], by: str = "") -> Dict[str, Any]:
    with _lock:
        hooks = listing()
        for i, old in enumerate(hooks):
            if int(old.get("id") or 0) == int(hid):
                h = _clean(body, old)
                h.update(updated_ms=now_ms(), by=by)
                hooks[i] = h
                _write_json(path(), {"hooks": hooks})
                return h
    raise KeyError(hid)


def remove(hid: int) -> None:
    with _lock:
        hooks = listing()
        left = [h for h in hooks if int(h.get("id") or 0) != int(hid)]
        if len(left) == len(hooks):
            raise KeyError(hid)
        _write_json(path(), {"hooks": left})


def admin_view() -> Dict[str, Any]:
    from .sidecar import autologin
    return {"hooks": listing(), "events": list(EVENTS), "wait_events": list(WAIT_EVENTS),
            "agent_events": list(AGENT_EVENTS), "roles": list(ROLES),
            "apps": [e["name"] for e in autologin.public_entries()], "tests": {str(k): v for k, v in _tests.items()}}


# ------------------------------------------------------------------ agent hooks (every agent call)

def _for_agent(event: str, role: str) -> List[Dict[str, Any]]:
    r = (role or "").lower()
    return [h for h in listing() if h.get("enabled") and h.get("scope") == "agent" and h.get("event") == event
            and (not h.get("roles") or any(r.startswith(x) for x in h["roles"]))]


def agent_instructions(role: str) -> str:
    """The agent_start hooks' instructions for an agent call of this role ('' = none). Never raises."""
    try:
        hs = _for_agent("agent_start", role)
    except Exception:   # noqa: BLE001
        return ""
    if not hs:
        return ""
    body = "\n\n".join("### %s\n%s" % (h.get("name"), h.get("prompt")) for h in hs)
    return ("\n\n## Standing instructions (Admin > Hooks; they apply to this task)\n\n" + body)[:MAX_INSTRUCTIONS * 2]


def tool_refusal(role: str, command: str) -> str:
    """Why a before_tool hook refuses this shell command of an agent of this role ('' = it may run)."""
    try:
        hs = _for_agent("before_tool", role)
    except Exception:   # noqa: BLE001
        return ""
    for h in hs:
        try:
            if re.search(str(h.get("pattern") or ""), command or "", re.I):
                return "refused by hook '%s': %s" % (h.get("name"), h.get("prompt"))
        except re.error:
            continue
    return ""


# ------------------------------------------------------------------ results per run

def results(run: str) -> Dict[str, Any]:
    d = _read_json(_results_path(run), {})
    return d if isinstance(d, dict) else {}


def _record(run: str, key: str, res: Dict[str, Any]) -> Dict[str, Any]:
    """Store a hook's result -> the result that stands. A pass by hand is never overwritten: a person who
    passed the hook while its agent was asked again (a resumed run, an engine restart) wins."""
    with _lock:
        d = results(run)
        if (d.get(key) or {}).get("passed_by"):
            return d[key]
        d[key] = res
        _write_json(_results_path(run), d)
        return res


def pass_by_hand(run: str, key: str, who: str) -> Dict[str, Any]:
    """A person lets a held run go on: the hook counts as passed (the run is then resumed by the caller)."""
    with _lock:
        d = results(run)
        if key not in d:
            raise KeyError(key)
        d[key] = dict(d[key], status="passed", passed_by=who or "someone", passed_ms=now_ms())
        _write_json(_results_path(run), d)
        return d[key]


# ------------------------------------------------------------------ firing

# POST /api/runs documents new | enhance | bug; the frontend and the process steps say the long names
_FLOW = {"new": "new-system", "enhance": "enhancement", "bug": "bug-fix"}


def _flow(name: Any) -> str:
    n = str(name or "").strip().lower()
    return _FLOW.get(n, n)


def _matches(h: Dict[str, Any], event: str, detail: Dict[str, Any]) -> bool:
    if not h.get("enabled") or h.get("event") != event or h.get("scope", "run") != "run":
        return False
    for field, value in (("projects", detail.get("project")), ("flows", detail.get("flow"))):
        norm = _flow if field == "flows" else (lambda x: str(x or "").lower())
        allowed = [norm(x) for x in (h.get(field) or [])]
        if allowed and norm(value) not in allowed:
            return False
    return True


def _git(repo: str, *args: str) -> str:
    import subprocess
    try:
        r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True, timeout=30,
                           encoding="utf-8", errors="replace")
        return (r.stdout or "").strip()
    except Exception:   # noqa: BLE001
        return ""


def _context(pipe: Any, h: Dict[str, Any], event: str, key: str) -> str:
    row = pipe.store.get(E_RUN, pipe.run) or {}
    detail = dict(row.get("detail") or {})
    pack = getattr(pipe, "pack", "") or row.get("pack_path") or ""
    repo = getattr(pipe, "repo", "") or detail.get("target") or ""
    spec_path = os.path.join(pack, "spec.md") if pack else ""
    spec = ""
    if spec_path and os.path.isfile(spec_path):
        with open(spec_path, encoding="utf-8") as fh:
            spec = fh.read()[:MAX_SPEC]
    lines = ["# Run %s (hook '%s', event %s)" % (pipe.run, h.get("name"), event), "",
             "- state: %s" % row.get("state", ""),
             "- name: %s" % detail.get("name", ""),
             "- project: %s" % detail.get("project", ""),
             "- flow: %s" % detail.get("flow", ""),
             "- spec file: %s" % spec_path,
             "- repository: %s" % repo,
             "- run folder (reports, worklog of the agents): %s" % (getattr(pipe, "workdir", "") or "")]
    if detail.get("code") or detail.get("message"):
        lines.append("- ended with: %s %s" % (detail.get("code", ""), str(detail.get("message", ""))[:500]))
    if repo and os.path.isdir(os.path.join(repo, ".git")):
        base = detail.get("base_sha") or ""
        lines += ["- branch: %s" % _git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
                  "- base commit: %s" % base, "", "## Commits of this run", "",
                  _git(repo, "log", "--oneline", "-50", ("%s..HEAD" % base) if base else "HEAD") or "(none)"]
    earlier = {k: v for k, v in results(pipe.run).items() if k != key}
    if earlier:
        lines += ["", "## Earlier hooks of this run", ""]
        lines += ["- %s (%s): %s %s" % (v.get("name"), k, v.get("status"), (v.get("reason") or "")[:300])
                  for k, v in earlier.items()]
    lines += ["", "## Spec", "", spec or "(no spec.md)"]
    return "\n".join(lines) + "\n"


PROMPT = """You are a hook agent of an automated delivery line, named '{name}'. The line runs a request (spec)
through understand, plan, build, merge, deploy and QAS. You are called at the moment '{event}' of run {run}.

Read {context} first: the run, its spec, repository, branch, commits, reports and earlier hooks.
Your working folder is {work}; write any file you produce there. Do not change the run's repository unless your
task below says so.
{apps}
YOUR TASK:
-----
{task}
-----
{tail}"""

TAIL_WAIT = """The run WAITS for your verdict. End your reply with exactly one last line:
  SUBMIT                      the run may go on
  BLOCKED:<one-line reason>   the run must hold (for example: the ticket is not approved yet)
"""
TAIL_BACKGROUND = """End your reply with a short summary of what you did, then a last line SUBMIT
(or BLOCKED:<reason> when you could not do it).
"""
TAIL_ADDENDUM = """If you found facts the team needs, write them in markdown to {addendum}: the engine adds that file
to the spec before it is frozen.
"""


def _prompt(h: Dict[str, Any], event: str, run: str, work: str, ctx_file: str) -> str:
    apps = ("You may use these signed-in apps through the dlc tools (get_session, fetch, open_page, run_js): %s.\n"
            % ", ".join(h.get("apps") or [])) if h.get("apps") else ""
    tail = TAIL_WAIT if h.get("mode") == "wait" else TAIL_BACKGROUND
    if event == "run_start":
        tail = TAIL_ADDENDUM.format(addendum=os.path.join(work, ADDENDUM)) + tail
    return PROMPT.format(name=h.get("name"), event=event, run=run, context=ctx_file, work=work, apps=apps,
                         task=h.get("prompt") or "", tail=tail)


def run_one(pipe: Any, h: Dict[str, Any], event: str, test: bool = False) -> Dict[str, Any]:
    """Run one hook for this run now; returns its result (status passed | blocked | error | done)."""
    from . import agent_tools
    key = "%s:%s" % (event, h.get("id"))
    work = os.path.join(_home(), "hooks", "work", re.sub(r"[^A-Za-z0-9_.-]", "_", pipe.run),
                        key.replace(":", "-") + ("-test" if test else ""))
    os.makedirs(work, exist_ok=True)
    ctx_file = os.path.join(work, "context.md")
    with open(ctx_file, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(_context(pipe, h, event, key))
    res: Dict[str, Any] = {"key": key, "hook": h.get("id"), "name": h.get("name"), "event": event,
                           "mode": h.get("mode"), "ms": now_ms(), "work": work, "test": test}
    cfg = pipe.cfg
    mark = agent_tools.HOOK_SCOPE.set({"apps": list(h.get("apps") or [])})
    try:
        out = pipe.llm.agentic(ROLE, work, _prompt(h, event, pipe.run, work, ctx_file),
                               int(h.get("max_turns") or 30), float(h.get("max_usd") or 1.5),
                               key="hook-%s" % h.get("id"), run=pipe.run)
        outcome = str(getattr(out, "outcome", "") or "")
        res.update(outcome=outcome, usd=round(float(getattr(out, "usd", 0) or 0), 4),
                   summary=str(getattr(out, "text", "") or "")[-2000:])
        if outcome == "SUBMIT":
            res["status"] = "passed" if h.get("mode") == "wait" else "done"
        elif outcome.startswith("BLOCKED:") and outcome[8:] not in FAILED_OUTCOMES:
            res.update(status="blocked", reason=outcome[8:].strip()[:500])
        else:
            res.update(status="error", reason=outcome or "no outcome")
    except Exception as e:   # noqa: BLE001 - a hook never crashes the run; the policy decides what follows
        res.update(status="error", reason=str(e)[:500])
    finally:
        agent_tools.HOOK_SCOPE.reset(mark)
    res["done_ms"] = now_ms()
    if event == "run_start" and not test and res["status"] in ("passed", "done"):
        _add_to_spec(pipe, h, os.path.join(work, ADDENDUM), res)
    return res


def _add_to_spec(pipe: Any, h: Dict[str, Any], src: str, res: Dict[str, Any]) -> None:
    pack = getattr(pipe, "pack", "")
    spec_path = os.path.join(pack, "spec.md") if pack else ""
    if not (spec_path and os.path.isfile(src) and os.path.isfile(spec_path)):
        return
    with open(src, encoding="utf-8") as fh:
        text = fh.read().strip()
    heading = "## %s (hook)" % h.get("name")
    with open(spec_path, encoding="utf-8") as fh:
        if heading in fh.read():
            return
    if text:
        with open(spec_path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n\n%s\n\n%s\n" % (heading, text[:MAX_SPEC]))
        res["spec_chars"] = len(text)


def _emit(pipe: Any, kind: str, body: Dict[str, Any]) -> None:
    try:
        pipe.sm.em.run_event(pipe.run, kind, body)
    except Exception as e:   # noqa: BLE001
        pipe.log("%s: %s event: %s" % (pipe.run, kind, e))


def _public(res: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in res.items() if k in ("key", "hook", "name", "event", "mode", "status", "reason",
                                                  "usd", "outcome")}


def fire(pipe: Any, event: str, hooks: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    """Run the hooks of this event for the pipeline's run. Background hooks start on threads; waiting hooks run
    here. Returns None (go on) or {"action": "park" | "stop", "message", "detail"} for the first waiting hook
    that holds the run. Never raises."""
    from . import codes
    try:
        row = pipe.store.get(E_RUN, pipe.run) or {}
        detail = dict(row.get("detail") or {})
        todo = [h for h in (listing() if hooks is None else hooks) if _matches(h, event, detail)]
    except Exception as e:   # noqa: BLE001
        pipe.log("%s: hooks %s: %s" % (pipe.run, event, e))
        return None
    if not todo:
        return None
    for h in todo:
        key = "%s:%s" % (event, h.get("id"))
        prev = results(pipe.run).get(key) or {}        # read per hook: a pass by hand may land meanwhile
        if prev.get("status") in ("passed", "done") or (
                prev.get("status") == "running" and now_ms() - int(prev.get("ms") or 0) < RUNNING_STALE_MS):
            continue                                    # a resumed run does not ask a passed hook again
        if h.get("mode") != "wait" or event not in WAIT_EVENTS:
            _record(pipe.run, key, {"key": key, "hook": h.get("id"), "name": h.get("name"), "event": event,
                                    "mode": "background", "status": "running", "ms": now_ms()})
            threading.Thread(target=_background, args=(pipe, h, event), name="line-hook-%s" % key,
                             daemon=True).start()
            continue
        pipe.log("%s: hook '%s' (%s) runs, the run waits" % (pipe.run, h.get("name"), key))
        res = run_one(pipe, h, event)
        kept = _record(pipe.run, key, res)
        _emit(pipe, codes.HOOK_RAN, _public(res))
        if kept is not res:
            pipe.log("%s: hook '%s' was passed by %s while it ran; the pass stands" % (pipe.run, h.get("name"),
                                                                                    kept.get("passed_by")))
            continue
        hold = res["status"] == "blocked" or (res["status"] == "error" and h.get("on_error") == "wait")
        if not hold:
            if res["status"] == "error":
                pipe.log("%s: hook '%s' failed (%s); the run goes on" % (pipe.run, h.get("name"), res.get("reason")))
            continue
        why = "hook '%s': %s" % (h.get("name"), res.get("reason") or res["status"])
        _emit(pipe, codes.HOOK_BLOCKED, {"key": key, "hook": h.get("id"), "name": h.get("name"),
                                         "reason": res.get("reason") or res["status"]})
        if h.get("on_block") == "stop" and res["status"] == "blocked":
            return {"action": "stop", "message": why, "detail": _public(res)}
        return {"action": "park", "message": why, "detail": _public(res)}
    return None


def _background(pipe: Any, h: Dict[str, Any], event: str) -> None:
    from . import codes
    res = run_one(pipe, h, event)
    _record(pipe.run, res["key"], res)
    _emit(pipe, codes.HOOK_RAN, _public(res))
    pipe.log("%s: hook '%s' %s %s" % (pipe.run, h.get("name"), res["status"], res.get("reason") or ""))


def test(make_pipe: Callable[[str], Any], hid: int, run: str) -> Dict[str, Any]:
    """Admin > Run hooks > Test: run the hook once on an existing run, on a thread. Its result goes to
    admin_view()["tests"][hid]; the run itself is not touched (no record, no event, no park)."""
    h = get(hid)
    if h is None:
        raise KeyError(hid)
    _tests[int(hid)] = {"run": run, "status": "running", "ms": now_ms()}

    def go() -> None:
        try:
            pipe = make_pipe(run)
            res = run_one(pipe, h, str(h.get("event") or "run_done"), test=True)
        except Exception as e:   # noqa: BLE001
            res = {"status": "error", "reason": str(e)[:500]}
        _tests[int(hid)] = dict(res, run=run, done_ms=now_ms())

    threading.Thread(target=go, name="line-hook-test-%s" % hid, daemon=True).start()
    return _tests[int(hid)]


__all__ = ["EVENTS", "WAIT_EVENTS", "AGENT_EVENTS", "SCOPES", "agent_instructions", "tool_refusal", "ROLE", "listing", "get", "add", "change", "remove", "admin_view", "results",
           "pass_by_hand", "fire", "run_one", "test", "path"]
