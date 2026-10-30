"""Processes configured in Dify: the flow decides, the line executes.

With LINE_PROCESS_SOURCE=dify the order of decisions of a run (size it, ask a person, run it, deliver it) is a Dify
workflow app instead of code, so a process is changed in Dify's editor without a release of the engine. The line
keeps everything Dify cannot do: the agents in worktrees, the gates, leases, budgets and resume.

The pattern is the task token of an external orchestrator (Step Functions waitForTaskToken, Camunda external tasks):

  * the engine starts the process app (Dify service API, one app per process, LINE_DIFY_FLOWS) with the run's
    request, process, project and the level a person gave;
  * a Human Input node whose title starts with "DLC:" is a TASK for the engine. Its form carries the parameters in a
    ```dlc {json}``` block; the engine does the task and submits the form with the action "done" or "failed" (its
    one paragraph input, when there is one, gets the result as JSON). Dify then continues on that action's branch;
  * any other Human Input node is a decision for a PERSON. The run shows it (GET /api/runs/{run}/process) and the
    person answers it in the frontend (POST /api/runs/{run}/process/forms/{form}) or in Dify's own form page.

Every task node owns a GROUP of agents (CrewAI's crew per task, LangGraph's subgraph per node): the node says who
works and on what, never how. How each agent works is its own sub-process, kept by the agent and not by the flow:
its persona project agent-<role> in the knowledge store (rules, open findings, change history; a new role gets one
on first use), its agent hooks (agent_start instructions, before_tool refusals), its lessons and its retro. The LLM
port adds all of it to every call of that role, so one node can be re-staffed in Dify without touching the engine
and an agent's learning follows the agent into whatever node it is put in.

  DLC: run      {"level"?: 1-4, "agents"?: [...], "lane"?, "note"?}
                the line's build group with its code gates (solo / solo_reviewer / solo_lead, or the team lanes);
                agents imply the level when none is given (solo_lead -> 3, solo_reviewer -> 2, solo -> 1).
                Answered when the run ends: done = green, failed = escalated
  DLC: deliver  {}  push the project to its source repository (projects.deliver)
  DLC: <name>   {"agents": [role, ...], "goal": "...", "max_turns"?, "max_usd"?}
                any other group: the agents work one after the other on a detached worktree of the project (never
                the line's copy), each seeing the request, the goal and what the agents before it delivered.
                Before the build it runs inside the size seam, after the run in the follower.

Where it sits: Pipeline._stages calls size(pipe) in place of the sizer; Pipeline._finish calls on_run_end(pipe).
What the run knows lives in detail.process {source, flow, app, workflow_run, task, pending, trace, outcome}, so a
restarted engine re-attaches to the same Dify run (the events of a run are replayed with its state snapshot).
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Iterator, List, Optional

from . import codes
from .codes import LineError
from .contracts import E_RUN, now_ms

TASK_PREFIX = "DLC:"
USER = "dlc-engine"                 # the Dify end user of every process run (the events route checks it)
POLL_S = 15                         # while a person decides, how often the run looks at Dify again
DONE, FAILED = "done", "failed"
_PARAMS = re.compile(r"```dlc\s*(\{.*?\})\s*```", re.S)


def enabled(cfg: Any) -> bool:
    return str(getattr(cfg, "process_source", "") or "").strip().lower() == "dify" and bool(_base(cfg))


def _base(cfg: Any) -> str:
    return str(getattr(cfg, "dify_url", "") or "").rstrip("/")


def flows(cfg: Any) -> Dict[str, str]:
    """process id -> Dify app key (LINE_DIFY_FLOWS, a JSON object; "*" is the app for any other process)."""
    raw = getattr(cfg, "dify_flows", "") or ""
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    try:
        data = json.loads(raw) if str(raw).strip() else {}
    except ValueError as e:
        raise LineError(codes.CONFIG_INVALID, "LINE_DIFY_FLOWS is not JSON: %s" % e, {"field": "dify_flows"})
    return {str(k): str(v) for k, v in (data or {}).items()}


def app_key(cfg: Any, process: str) -> str:
    f = flows(cfg)
    key = f.get(process) or f.get("*") or ""
    if not key:
        raise LineError(codes.CONFIG_INVALID, "no Dify flow for process %r (LINE_DIFY_FLOWS has %s)"
                        % (process, sorted(f)), {"field": "dify_flows", "process": process})
    return key


# ------------------------------------------------------------------ Dify service API


def _req(cfg: Any, key: str, method: str, path: str, body: Any = None, timeout: float = 60) -> Any:
    r = urllib.request.Request(_base(cfg) + "/v1" + path, method=method,
                               data=json.dumps(body).encode() if body is not None else None,
                               headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        return urllib.request.urlopen(r, timeout=timeout)
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")[:400]
        raise LineError(codes.LLM_ERROR, "Dify %s %s: HTTP %s %s" % (method, path, e.code, text),
                        {"status": e.code, "path": path})
    except (urllib.error.URLError, OSError) as e:
        raise LineError(codes.LLM_ERROR, "Dify %s %s: %s" % (method, path, e), {"path": path})


def _sse(resp: Any) -> Iterator[Dict[str, Any]]:
    with resp:
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            try:
                yield json.loads(line[5:].strip())
            except ValueError:
                continue


def _segment(events: Iterator[Dict[str, Any]]) -> Dict[str, Any]:
    """Read one stretch of a run: until it pauses (forms waiting) or ends. -> {workflow_run, status, forms,
    outputs, error, trace}"""
    out: Dict[str, Any] = {"workflow_run": "", "status": "running", "forms": {}, "outputs": {}, "error": "",
                           "trace": []}
    seen: Dict[str, Dict[str, Any]] = {}     # every form of the stretch; a replayed snapshot repeats answered ones
    finished = set()
    for ev in events:
        kind, data = ev.get("event"), ev.get("data") or {}
        out["workflow_run"] = out["workflow_run"] or str(ev.get("workflow_run_id") or data.get("workflow_run_id")
                                                        or (data.get("id") if kind == "workflow_started" else "")
                                                        or "")
        if kind == "node_finished":
            finished.add(str(data.get("node_id") or ""))
        if kind == "node_finished" and data.get("node_type") not in ("loop-start", "iteration-start"):
            out["trace"].append({"node": data.get("node_id"), "title": data.get("title"),
                                 "type": data.get("node_type"), "status": data.get("status")})
        elif kind == "human_input_required":
            seen[str(data.get("form_id"))] = _form(data)
        elif kind == "workflow_paused":
            waiting = [r for r in data.get("reasons") or [] if r.get("form_id")]
            for r in waiting:                       # the pause names the forms that wait now
                out["forms"][str(r["form_id"])] = _form(r) if r.get("form_token") else seen.get(str(r["form_id"]))
            if not waiting:                         # no reasons: the forms whose node has not finished
                out["forms"] = {fid: f for fid, f in seen.items() if f["node"] not in finished}
            out["forms"] = {fid: f for fid, f in out["forms"].items() if f}
            out["status"] = "paused"
            break
        elif kind == "workflow_finished":
            out["status"] = str(data.get("status") or "succeeded")
            out["outputs"] = data.get("outputs") or {}
            out["error"] = str(data.get("error") or "")
            break
        elif kind == "error":
            out["status"], out["error"] = "failed", str(ev.get("message") or data)
            break
    return out


def _form(data: Dict[str, Any]) -> Dict[str, Any]:
    title = str(data.get("node_title") or "")
    content = str(data.get("form_content") or "")
    m = _PARAMS.search(content)
    try:
        params = json.loads(m.group(1)) if m else {}
    except ValueError:
        params = {}
    task = title[len(TASK_PREFIX):].strip().lower() if title.upper().startswith(TASK_PREFIX) else ""
    return {"form": str(data.get("form_id") or ""), "token": str(data.get("form_token") or ""),
            "node": str(data.get("node_id") or ""), "title": title, "task": task, "params": params,
            "content": _PARAMS.sub("", content).strip(),
            "inputs": [i.get("output_variable_name") for i in data.get("inputs") or []],
            "actions": [{"id": a.get("id"), "title": a.get("title")} for a in data.get("actions") or []],
            "expires": data.get("expiration_time")}


def start(cfg: Any, key: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
    resp = _req(cfg, key, "POST", "/workflows/run", {"inputs": inputs, "response_mode": "streaming", "user": USER},
                timeout=float(getattr(cfg, "dify_timeout_s", 300) or 300))
    return _segment(_sse(resp))


def watch(cfg: Any, key: str, workflow_run: str) -> Dict[str, Any]:
    """The run's state now: executed nodes replayed, then live until it pauses or ends."""
    resp = _req(cfg, key, "GET", "/workflow/%s/events?user=%s&include_state_snapshot=true" % (workflow_run, USER),
                timeout=float(getattr(cfg, "dify_timeout_s", 300) or 300))
    seg = _segment(_sse(resp))
    seg["workflow_run"] = seg["workflow_run"] or workflow_run
    return seg


def submit(cfg: Any, key: str, token: str, action: str, inputs: Optional[Dict[str, Any]] = None) -> None:
    """Answer a form. An answer that already landed (a resume after a crash between submit and save) is fine."""
    try:
        _req(cfg, key, "POST", "/form/human_input/" + token, {"action": action, "inputs": inputs or {},
                                                                "user": USER}).read()
    except LineError as e:
        if (e.detail or {}).get("status") == 412 and "submitted" in e.message:
            return
        raise


def definition(cfg: Any, key: str, form: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The form as Dify renders it now (a replayed pause can carry the template, not the values); None when it
    was answered already (by anyone: Dify's own form page, another engine call)."""
    try:
        data = json.loads(_req(cfg, key, "GET", "/form/human_input/" + form["token"]).read() or b"{}")
    except LineError as e:
        if (e.detail or {}).get("status") == 412:
            return None
        raise
    return _form(dict(data, form_id=form["form"], form_token=form["token"], node_id=form["node"],
                      node_title=form["title"], actions=data.get("user_actions") or []))


# ------------------------------------------------------------------ run state (detail.process)


def _detail(store: Any, run: str) -> Dict[str, Any]:
    return dict((store.get(E_RUN, run) or {}).get("detail") or {})


def _save(store: Any, run: str, **changes: Any) -> Dict[str, Any]:
    from .statemachine import update_row
    detail = _detail(store, run)
    proc = dict(detail.get("process") or {}, **changes, updated_ms=now_ms())
    detail["process"] = proc
    update_row(store, E_RUN, run, {"detail": detail})
    return proc


def _pending(cfg: Any, key: str, store: Any, run: str, seg: Dict[str, Any]):
    """-> (task form or None, {form id: person form}) waiting now, without the ones this engine already answered
    (right after a submit Dify may still report them until it resumes), each read fresh from Dify."""
    done = set((_detail(store, run).get("process") or {}).get("submitted") or [])
    forms = {fid: definition(cfg, key, f) for fid, f in seg["forms"].items() if fid not in done}
    forms = {fid: f for fid, f in forms.items() if f}
    task = next((f for f in forms.values() if f["task"]), None)
    return task, {fid: f for fid, f in forms.items() if not f["task"]}


def _answered(store: Any, run: str, form_id: str) -> None:
    sub = list((_detail(store, run).get("process") or {}).get("submitted") or [])
    _save(store, run, submitted=(sub + [form_id])[-200:])


def _keep(seg: Dict[str, Any], forms: Dict[str, Any]) -> Dict[str, Any]:
    """Only what a frontend needs of a waiting person form (never the token)."""
    return {fid: {k: v for k, v in f.items() if k != "token"} for fid, f in forms.items()}


def _inputs_for(form: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
    names = [n for n in form.get("inputs") or [] if n]
    return {names[0]: json.dumps(result, ensure_ascii=False)[:20000]} if names else {}


def _spec(pipe: Any) -> str:
    import os
    try:
        with open(os.path.join(pipe.pack, "spec.md"), encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


# ------------------------------------------------------------------ agent groups

_ROLE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
RUN_ROLES = {"solo_lead": 3, "solo_reviewer": 2, "solo": 1}


def agents_of(task: Dict[str, Any]) -> List[str]:
    raw = (task.get("params") or {}).get("agents") or []
    if isinstance(raw, str):
        raw = [a for a in re.split(r"[,\s]+", raw) if a]
    out = [str(a).strip().lower() for a in raw if str(a).strip()]
    bad = [a for a in out if not _ROLE.match(a)]
    if bad:
        raise LineError(codes.SCHEMA_INVALID, "agent names must be role ids: %s" % bad, {"agents": out})
    return out


def _worktree(pipe: Any, name: str) -> str:
    """A detached worktree of the project's main for a group: what it writes never reaches the line's copy."""
    import os
    import subprocess
    root = os.path.join(getattr(pipe.cfg, "workroot", "") or os.path.dirname(pipe.pack), "groups", pipe.run)
    work = os.path.join(root, re.sub(r"[^A-Za-z0-9_.-]+", "-", name)[:60] or "group")
    repo = getattr(pipe, "repo", "") or ""
    os.makedirs(root, exist_ok=True)
    if repo and os.path.isdir(os.path.join(repo, ".git")) and not os.path.isdir(work):
        r = subprocess.run(["git", "-C", repo, "worktree", "add", "--detach", "-f", work, "HEAD"],
                           capture_output=True, text=True, timeout=120)
        if r.returncode == 0:
            return work
    os.makedirs(work, exist_ok=True)              # no code yet (a new system): an empty folder
    return work


def run_group(pipe: Any, task: Dict[str, Any], process: str) -> Dict[str, Any]:
    """Run one node's agents in order. -> {group, agents, summary, outputs, usd, ok}. An agent's failure ends the
    group as failed (the flow decides what that means); a group that cannot start raises LineError."""
    name = task["task"] or "group"
    agents = agents_of(task)
    if not agents:
        raise LineError(codes.SCHEMA_INVALID, "task %r names no agents" % task["title"], {"task": name})
    p = task.get("params") or {}
    turns = int(p.get("max_turns") or 40)
    usd = min(float(p.get("max_usd") or 1.0), float(getattr(pipe.cfg, "max_usd_call", 1.5) or 1.5))
    work = _worktree(pipe, name)
    spec = _spec(pipe)[:6000]
    goal = str(p.get("goal") or task.get("content") or "")[:4000]
    project = _detail(pipe.store, pipe.run).get("project") or "-"
    outputs: List[Dict[str, Any]] = []
    ok = True
    for role in agents:
        pipe._check_cancel()
        before = "\n\n".join("[%s]\n%s" % (o["agent"], o["text"][-3000:]) for o in outputs) or "(you are the first)"
        prompt = ("You are the %s agent in the group '%s' of the %s process (run %s, project %s).\n\n"
                  "GOAL OF THIS GROUP:\n%s\n\nTHE REQUEST:\n%s\n\nWHAT THE AGENTS BEFORE YOU IN THIS GROUP "
                  "DELIVERED:\n%s\n\nYour working folder is a scratch copy of the project; nothing you change "
                  "there is built or shipped. Finish with a short summary of what you did and what you found."
                  % (role, name, process, pipe.run, project, goal, spec, before))
        try:
            res = pipe.llm.agentic(role, work, prompt, turns, usd, key="group:%s:%s" % (name, role), run=pipe.run)
            outputs.append({"agent": role, "text": str(getattr(res, "text", "") or "")[-6000:],
                            "usd": round(float(getattr(res, "usd", 0) or 0), 4)})
        except Exception as e:   # noqa: BLE001 - one agent failing ends the group as failed
            outputs.append({"agent": role, "text": "", "error": "%s: %s" % (type(e).__name__, str(e)[:500])})
            ok = False
            break
    result = {"group": name, "agents": agents, "ok": ok, "summary": (outputs[-1].get("text") or "")[-3000:],
              "outputs": outputs, "usd": round(sum(o.get("usd") or 0 for o in outputs), 4)}
    groups = list((_detail(pipe.store, pipe.run).get("process") or {}).get("groups") or [])
    groups.append(dict({k: v for k, v in result.items() if k != "outputs"}, node=task.get("node"), ms=now_ms()))
    _save(pipe.store, pipe.run, groups=groups[-30:])
    pipe.log("%s: group %s (%s) %s, $%.2f" % (pipe.run, name, ",".join(agents), "done" if ok else "failed",
                                              result["usd"]))
    return result


def _reply(cfg: Any, key: str, store: Any, run: str, form: Dict[str, Any], action: str,
           inputs: Optional[Dict[str, Any]] = None) -> None:
    submit(cfg, key, form["token"], action, inputs)
    _answered(store, run, form["form"])


def _do_group(cfg: Any, key: str, pipe: Any, task: Dict[str, Any], process: str) -> None:
    try:
        res = run_group(pipe, task, process)
        _reply(cfg, key, pipe.store, pipe.run, task, DONE if res["ok"] else FAILED, _inputs_for(task, res))
    except LineError as e:
        _reply(cfg, key, pipe.store, pipe.run, task, FAILED, _inputs_for(task, {"error": e.message}))


# ------------------------------------------------------------------ the size seam of the pipeline


def size(pipe: Any) -> Dict[str, Any]:
    """In place of sizer.run: drive the process until it hands the line a 'DLC: run' task. Returns detail.sizing.
    Blocks while a person decides (POLL_S, cancel-aware); a process that ends first stops the run (HOOK_STOP)."""
    from .understand import sizer
    store, run, cfg = pipe.store, pipe.run, pipe.cfg
    detail = _detail(store, run)
    if detail.get("sizing"):
        return detail["sizing"]
    process = str(detail.get("flow") or "enhancement").strip().lower()
    key = app_key(cfg, process)
    proc = detail.get("process") or {}
    if not proc.get("workflow_run"):
        inputs = {"request": _spec(pipe)[:int(getattr(cfg, "dify_max_request", 8000) or 8000)], "kind": process,
                  "given_level": str(detail.get("level") or ""), "project": str(detail.get("project") or ""),
                  "run": run}
        seg = start(cfg, key, inputs)
        proc = _save(store, run, source="dify", flow=process, workflow_run=seg["workflow_run"], trace=seg["trace"],
                     started_ms=now_ms())
        pipe.log("%s: process %s started in Dify (workflow run %s)" % (run, process, seg["workflow_run"]))
    else:
        seg = watch(cfg, key, proc["workflow_run"])
    while True:
        task, people = _pending(cfg, key, store, run, seg)
        _save(store, run, trace=seg["trace"], pending=_keep(seg, people), status=seg["status"])
        if seg["status"] == "paused" and task is None and not people:   # only forms just answered: Dify resumes
            time.sleep(2)
            seg = watch(cfg, key, proc["workflow_run"])
            continue
        if task is not None:
            if task["task"] == "deliver":           # nothing to deliver before the build
                _reply(cfg, key, store, run, task, FAILED, _inputs_for(task, {"error": "deliver before the run"}))
                seg = watch(cfg, key, proc["workflow_run"])
                continue
            if task["task"] != "run":
                _do_group(cfg, key, pipe, task, process)
                seg = watch(cfg, key, proc["workflow_run"])
                continue
            p = task["params"] or {}
            try:
                level = int(p.get("level") or 0)
            except (TypeError, ValueError):
                level = 0
            if level not in sizer.LEVELS:
                implied = [RUN_ROLES[a] for a in agents_of(task) if a in RUN_ROLES]
                level = max(implied) if implied else sizer.UNSURE_LEVEL
            result = sizer._leveled({"ms": now_ms(), "level": level, "by": "dify:" + process,
                                     "reasons": [str(p.get("reason") or "")] if p.get("reason") else []},
                                    cfg, capped=False)
            lane = str(p.get("lane") or "").strip().lower()
            if lane in sizer.LANES or lane == sizer.SOLO:
                result["lane"] = lane
            if p.get("note"):
                result["note"] = str(p["note"])[:2000]
            if agents_of(task):
                result["agents"] = agents_of(task)
            _save(store, run, task={k: task[k] for k in ("form", "token", "node", "title")}, pending={})
            return sizer._save(pipe, result)
        if seg["status"] != "paused":       # the process ended before the line had anything to build
            _save(store, run, outcome={"status": seg["status"], "outputs": seg["outputs"], "error": seg["error"]})
            from .pipeline import Escalate
            why = str((seg["outputs"] or {}).get("reason") or (seg["outputs"] or {}).get("decision")
                      or seg["error"] or seg["status"])
            raise Escalate(codes.HOOK_STOP, "the %s process (Dify) ended the run: %s" % (process, why),
                           {"process": "dify", "flow": process, "outputs": seg["outputs"]})
        # a person decides: wait, looking again every POLL_S (the answer may come from Dify's own form page)
        pipe.log("%s: process waits for a person: %s" % (run, ", ".join(f["title"] for f in people.values())))
        deadline = time.monotonic() + POLL_S
        while time.monotonic() < deadline:
            pipe._check_cancel()
            time.sleep(1)
        seg = watch(cfg, key, proc["workflow_run"])


# ------------------------------------------------------------------ after the run


def on_run_end(pipe: Any) -> None:
    """The run is terminal: answer the 'DLC: run' task, then follow the rest of the process (deliver, people) in
    the background. Never raises."""
    try:
        store, run, cfg = pipe.store, pipe.run, pipe.cfg
        row = store.get(E_RUN, run) or {}
        proc = (row.get("detail") or {}).get("process") or {}
        task = proc.get("task") or {}
        if not enabled(cfg) or not task.get("token") or proc.get("answered"):
            return
        key = app_key(cfg, proc.get("flow") or "enhancement")
        ok = row.get("state") == "green"
        result = {"run": run, "state": row.get("state"), "code": row.get("code") or "",
                  "usd": (row.get("detail") or {}).get("spent_usd"),
                  "message": str(row.get("message") or "")[:2000]}
        submit(cfg, key, task["token"], DONE if ok else FAILED, _inputs_for({"inputs": ["result"]}, result))
        _answered(store, run, task["form"])
        _save(store, run, answered=DONE if ok else FAILED)
        pipe.log("%s: process task %r answered %s" % (run, task.get("title"), DONE if ok else FAILED))
        threading.Thread(target=follow, args=(cfg, store, run), kwargs={"pipe": pipe}, name="dify-follow-" + run,
                         daemon=True).start()
    except Exception as e:   # noqa: BLE001 - the process is told later by a resume; the run's end stands
        try:
            pipe.log("%s: process run end: %s" % (pipe.run, e))
        except Exception:    # noqa: BLE001
            pass


def follow(cfg: Any, store: Any, run: str, max_s: float = 86400, pipe: Any = None) -> Dict[str, Any]:
    """After the run: do the remaining engine tasks (deliver, agent groups) until the process ends; people answer
    the rest."""
    from . import projects
    proc = _detail(store, run).get("process") or {}
    key = app_key(cfg, proc.get("flow") or "enhancement")
    until = time.monotonic() + max_s
    seg: Dict[str, Any] = {}
    while time.monotonic() < until:
        seg = watch(cfg, key, proc["workflow_run"])
        if seg["status"] != "paused":
            _save(store, run, trace=seg["trace"] or (_detail(store, run).get("process") or {}).get("trace") or [], pending={}, status=seg["status"],
                  outcome={"status": seg["status"], "outputs": seg["outputs"], "error": seg["error"]})
            return seg
        task, people = _pending(cfg, key, store, run, seg)
        _save(store, run, trace=seg["trace"], pending=_keep(seg, people), status=seg["status"])
        if task is None:
            time.sleep(POLL_S if people else 2)
            continue
        if task["task"] == "deliver":
            pid = str(_detail(store, run).get("project") or "")
            try:
                res = projects.deliver(pid)
                _reply(cfg, key, store, run, task, DONE, _inputs_for(task, res))
            except Exception as e:   # noqa: BLE001 - the process decides what a failed push means
                _reply(cfg, key, store, run, task, FAILED, _inputs_for(task, {"error": str(e)[:1000]}))
        elif task["task"] != "run" and pipe is not None:
            _do_group(cfg, key, pipe, task, proc.get("flow") or "enhancement")
        else:
            _reply(cfg, key, store, run, task, FAILED,
                   _inputs_for(task, {"error": "task %s cannot run after the run" % task["title"]}))
    return seg


# ------------------------------------------------------------------ API


def view(store: Any, run: str) -> Dict[str, Any]:
    """GET /api/runs/{run}/process"""
    proc = _detail(store, run).get("process") or {}
    out = {k: v for k, v in proc.items() if k != "task"}
    if proc.get("task"):
        out["task"] = {k: v for k, v in proc["task"].items() if k != "token"}
    return {"run": run, "process": out or None}


def answer(cfg: Any, store: Any, run: str, form_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """POST /api/runs/{run}/process/forms/{form} {action, inputs?, who?}: a person's decision, sent to Dify."""
    proc = _detail(store, run).get("process") or {}
    if not proc.get("workflow_run"):
        raise LineError(codes.NOT_FOUND, "run %s has no Dify process" % run, {"run": run})
    key = app_key(cfg, proc.get("flow") or "enhancement")
    if form_id in (proc.get("submitted") or []):
        raise LineError(codes.STATE_CONFLICT, "form %s of run %s is answered already" % (form_id, run),
                        {"run": run, "form": form_id})
    seg = watch(cfg, key, proc["workflow_run"])          # the token is read fresh; it is never stored for people
    form = seg["forms"].get(form_id)
    if form is not None:
        form = definition(cfg, key, form)
    if form is None or form["task"]:
        raise LineError(codes.NOT_FOUND, "no person form %s waiting in run %s" % (form_id, run),
                        {"run": run, "form": form_id, "waiting": sorted(seg["forms"])})
    action = str(body.get("action") or "")
    if action not in [a["id"] for a in form["actions"]]:
        raise LineError(codes.SCHEMA_INVALID, "action must be one of %s" % [a["id"] for a in form["actions"]],
                        {"form": form_id})
    inputs = body.get("inputs") if isinstance(body.get("inputs"), dict) else {}
    _reply(cfg, key, store, run, form, action, inputs)
    proc = _detail(store, run).get("process") or {}
    answered: List[Dict[str, Any]] = list(proc.get("answers") or [])
    answered.append({"form": form_id, "title": form["title"], "action": action, "who": str(body.get("who") or ""),
                     "ms": now_ms()})
    _save(store, run, answers=answered[-50:],
          pending={k: v for k, v in (proc.get("pending") or {}).items() if k != form_id})
    return {"run": run, "form": form_id, "action": action, "submitted": True}


def catalog_processes(cfg: Any, processes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """catalog(): the processes that run from Dify say so (source, the app it is configured in)."""
    if not enabled(cfg):
        return processes
    f = flows(cfg)
    return [dict(p, source="dify" if (f.get(p["id"]) or f.get("*")) else "line") for p in processes]
