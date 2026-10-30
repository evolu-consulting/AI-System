"""The SDLC engine: one worker thread per project runs that project's runs, and
each run walks its steps.

A STEP IS A GROUP CONVERSATION MEDIATED BY THIS SERVER. On local KH every
Claude session is the same identity, so kh-message cannot tell agents apart and
a sender never receives its own broadcast. The server therefore owns the
transcript and the turn order; each agent turn is one `claude -p` call that sees
what was said since its last turn, and every line is mirrored into kh-message
(agent name inside the content) and the step summary into the KH worklog.

Turn order inside a step: agents in the group's order, the first one leads and
is the only one allowed to close the step with STEP_DONE + a JSON summary.

TWO VIEWS, ONE FLOW. The steps are the developer's view (spec, design, build,
review, test) interleaved with the project manager's (scope sign-off, setup and
plan, UAT, release and close). Around every step the PM governance in gov.py
runs: what the lead reports becomes register items, the server re-runs the
tests itself, review/test/UAT verdicts send work back along the workflow's
rework arrows, approval steps wait for a lead, a waiting step climbs the
escalation ladder, and the budget can pause a run.

A STEP THAT WAITS FOR A PERSON PARKS ITS RUN. The worker does not sit in it:
the run goes to waiting_human and the worker takes the next runnable run of the
project (best priority first, dependencies done). A human line, Continue,
Approve or Reject puts the run back to pending.
"""

import json
import logging
import os
import re
import threading
import time
import traceback

import db
import gov
import kh
import llm
import prompts
import toolbox

log = logging.getLogger("sdlc.engine")

TOOLS_DIR = os.environ.get("SDLC_TOOLS_DIR") or os.environ.get("SDLC_KH_TOOLS") or ""   # unset: no tools catalogue
TURN_TIMEOUT = int(os.environ.get("SDLC_TURN_TIMEOUT", "1200"))
RUNNABLE = ("pending", "running")
FINISHED_STEP = ("done", "rework", "skipped")

_workers = {}
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(3)
_ticker = None


class Halt(Exception):
    """The run was paused or cancelled (by a person or the budget) between turns."""


# ---------------------------------------------------------------- workers

def next_run(project_id):
    for r in db.q("SELECT * FROM run WHERE project_id=? AND status IN ('pending','running') ORDER BY priority, id", project_id):
        if r["depends_on"]:
            dep = db.run_get(r["depends_on"])
            if dep and dep["status"] != "done":
                if r["status_reason"] != "blocked":
                    db.ex("UPDATE run SET status_reason='blocked' WHERE id=?", r["id"])
                continue
        if r["status_reason"] == "blocked":
            db.ex("UPDATE run SET status_reason='' WHERE id=?", r["id"])
        return r
    return None


class ProjectWorker(threading.Thread):
    def __init__(self, project_id):
        super().__init__(daemon=True, name="sdlc-" + project_id)
        self.project_id = project_id
        self.event = threading.Event()

    def run(self):
        while True:
            try:
                run = next_run(self.project_id)
                if not run:
                    self.event.wait(30)
                    self.event.clear()
                    continue
                execute_run(run["id"])
            except Exception:  # noqa: BLE001 - a worker must never die
                log.error("worker %s crashed: %s", self.project_id, traceback.format_exc())
                time.sleep(5)


def wake(project_id):
    with _lock:
        w = _workers.get(project_id)
        if not w or not w.is_alive():
            w = ProjectWorker(project_id)
            _workers[project_id] = w
            w.start()
        else:
            w.event.set()


def _tick_loop():
    while True:
        time.sleep(60)
        gov.tick(wake)


def start():
    """On boot: a step left 'running' by a dead process is re-run; workers and the ticker start."""
    global _slots, _ticker
    _slots = threading.BoundedSemaphore(max(1, int(gov.settings()["maxConcurrent"])))
    db.ex("UPDATE step_run SET status='pending' WHERE status='running'")
    for row in db.q("SELECT DISTINCT project_id FROM run WHERE status IN ('pending','running')"):
        wake(row["project_id"])
    if not _ticker:
        _ticker = threading.Thread(target=_tick_loop, daemon=True, name="sdlc-ticker")
        _ticker.start()


# ---------------------------------------------------------------- run / step

def set_run(rid, **kw):
    cols = ", ".join("%s=?" % k for k in kw)
    db.ex("UPDATE run SET %s WHERE id=?" % cols, *kw.values(), rid)


def set_step(sid, **kw):
    cols = ", ".join("%s=?" % k for k in kw)
    db.ex("UPDATE step_run SET %s WHERE id=?" % cols, *kw.values(), sid)


def execute_run(rid):
    run = db.run_get(rid)
    project = db.project_get(run["project_id"])
    while True:
        run = db.run_get(rid)
        if run["status"] not in RUNNABLE:
            return
        step = next((s for s in db.steps_of(rid) if s["status"] not in FINISHED_STEP), None)
        if not step:
            break
        if step["status"] == "failed":
            set_run(rid, status="failed")
            return
        set_run(rid, status="running", current_pos=step["position"])
        try:
            outcome = run_step(project, db.run_get(rid), step)
        except Halt:
            if db.one("SELECT status FROM step_run WHERE id=?", step["id"])["status"] == "running":
                set_step(step["id"], status="pending")
            return
        except Exception as exc:  # noqa: BLE001
            log.error("step %s crashed: %s", step["id"], traceback.format_exc())
            set_step(step["id"], status="failed", error=str(exc)[:1000], finished_at=db.now())
            outcome = "failed"
        if outcome == "parked":
            set_run(rid, status="waiting_human")
            return
        if outcome == "failed":
            set_run(rid, status="failed")
            err = (db.one("SELECT error FROM step_run WHERE id=?", step["id"]) or {}).get("error")
            kh.add_log(project["kh_project"], run["slug"],
                       "[sdlc] %s project=%s feature=%s task=%s FAILED: %s" % (
                           time.strftime("%Y-%m-%d"), project["slug"], run["slug"], step["group_slug"], err))
            gov.notify("failed", "Run #%d '%s' failed at '%s': %s" % (rid, run["title"], step["group_name"], (err or "")[:300]),
                       project["id"], rid, step["position"], recipient=run["owner"], level=2, kh_project=project["kh_project"])
            return
    set_run(rid, status="done", finished_at=db.now(), status_reason="")
    open_actions = db.one("SELECT COUNT(*) AS n FROM register_item WHERE run_id=? AND kind IN ('action','issue','defect') "
                          "AND status='open'", rid)["n"]
    kh.add_log(project["kh_project"], run["slug"],
               "[sdlc] %s project=%s feature=%s workflow=%s v%s DONE: all steps finished for '%s'; %d open follow-up(s)." % (
                   time.strftime("%Y-%m-%d"), project["slug"], run["slug"], run["workflow_name"],
                   (db.run_process(run) or {}).get("version", "-"), run["title"], open_actions))
    gov.notify("done", "Run #%d '%s' is done%s." % (rid, run["title"], (" with %d open follow-up(s)" % open_actions) if open_actions else ""),
               project["id"], rid, recipient=run["owner"], kh_project=project["kh_project"])


def resolve_workspace(template, project, run, group_slug):
    path = (template or "{project_folder}")
    for k, v in (("{project_folder}", project["folder"]), ("{project_slug}", project["slug"]),
                 ("{run_slug}", run["slug"]), ("{group_slug}", group_slug), ("{feature}", run["slug"])):
        path = path.replace(k, v)
    if path.startswith("~"):
        path = project["folder"] + path[1:]
    return os.path.normpath(path)


def allowed_tools(agent):
    cat, _ = toolbox.catalogue(TOOLS_DIR)
    rows = [t for t in ((cat or {}).get("tools") or []) if t["onDisk"] and not t["retired"]]
    if agent.get("tools") is None:
        return rows
    allow = {str(x).lower() for x in agent["tools"]}
    return [t for t in rows if t["key"] in allow or t["name"].lower() in allow]


def step_group(run, step):
    """The step's group and agents: from the run's frozen process, or live for runs from before snapshots."""
    node = db.proc_node(db.run_process(run), step["node_id"])
    if node:
        return node["group"], node["agents"]
    group = db.group_get(step["group_id"]) or {"name": step["group_name"], "slug": step["group_slug"], "goal": "",
                                                "workspace": "{project_folder}", "humanGate": False, "maxRounds": 1,
                                                "agentIds": [], "lane": step["lane"], "role": step["role"],
                                                "approval": False, "verifyTests": False}
    return group, [db.agent_public(db.agent_row(a)) for a in group["agentIds"] if db.agent_row(a)]


def build_ctx(project, run, step, light=False):
    group, agents = step_group(run, step)
    steps = db.steps_of(run["id"])
    ctx = {
        "group": group, "agents": agents,
        "group_name": group["name"], "group_slug": step["group_slug"], "group_goal": group.get("goal") or "",
        "gate": bool(group.get("humanGate")), "max_rounds": max(1, int(group.get("maxRounds") or 1)),
        "role": group.get("role") or "work", "lane": group.get("lane") or "dev",
        "approval": bool(group.get("approval")), "verify": bool(group.get("verifyTests")),
        "approvers": signoff_titles(group), "env": group.get("env") or "",
        "agents_line": ", ".join(a["name"] for a in agents),
        "lead_name": agents[0]["name"] if agents else "",
        "has_members": len(agents) > 1,
        "project_name": project["name"], "project_slug": project["slug"], "project_folder": project["folder"],
        "kh_project": project["kh_project"], "test_command": project.get("test_command") or "",
        "run_id": run["id"], "run_slug": run["slug"], "run_title": run["title"], "run_kind": run["kind"],
        "workflow_name": run["workflow_name"], "pos": step["position"], "total": len(steps), "attempt": step["attempt"],
    }
    if light:
        return ctx
    ws = resolve_workspace(group.get("workspace"), project, run, step["group_slug"])
    os.makedirs(ws, exist_ok=True)
    os.makedirs(project["folder"], exist_ok=True)
    ctx.update(
        workspace=ws,
        prev=[db.step_public(s) for s in steps if s["position"] < step["position"] and s["status"] in ("done", "rework")],
        kh_recent=kh.recent(project["kh_project"], 10),
        memory_url=kh.KH_URL, tools_dir=TOOLS_DIR,
        scope=gov.scope_items(run["id"]),
        open_items=gov.open_items_for_run(run["id"]),
        lessons=gov.lessons_for(project["id"]),
        attachments=gov.attachments(run["id"]),
    )
    return ctx


def session(step_id, agent_id):
    return db.one("SELECT * FROM agent_session WHERE step_run_id=? AND agent_id=?", step_id, agent_id)


def save_session(step_id, agent_id, sid, last_seq):
    db.ex("INSERT INTO agent_session(step_run_id, agent_id, session_id, last_seq) VALUES (?,?,?,?) "
          "ON CONFLICT(step_run_id, agent_id) DO UPDATE SET session_id=COALESCE(excluded.session_id, session_id), last_seq=excluded.last_seq",
          step_id, agent_id, sid, last_seq)


def all_msgs(step_id):
    return db.messages(step_id, 0)


def checkpoint(run_id):
    """Between turns: stop for a pause or cancel, and pause the run when its budget is spent."""
    run = db.run_get(run_id)
    if run["status"] in ("paused", "cancelled"):
        raise Halt(run["status"])
    project = db.project_get(run["project_id"])
    over = None
    if run["budget_usd"] and db.spent_run(run_id) >= run["budget_usd"]:
        over = "the run's budget ($%.2f)" % run["budget_usd"]
    elif project["budget_usd"] and db.spent_project(project["id"]) >= project["budget_usd"]:
        over = "the project's budget ($%.2f)" % project["budget_usd"]
    if over:
        set_run(run_id, status="paused", status_reason="budget")
        text = "Run #%d '%s' paused: it reached %s. Raise the budget and Resume to continue." % (run_id, run["title"], over)
        item = gov.add_item(project["id"], "escalation", "Budget reached on run #%d" % run_id, detail=text, run_id=run_id,
                            owner=project["owner"] or run["owner"], created_by="SDLC")
        gov.notify("budget", "%s: %s" % (item["ref"], text), project["id"], run_id, run["current_pos"], recipient=run["owner"],
                   level=3, kh_project=project["kh_project"])
        raise Halt("budget")


def metered_call(step, agent, env, prompt, ctx, project, resume=None):
    """llm.call with its tokens recorded on one llm_call row, live while the CLI streams.
    A global slot cap keeps parallel projects from flooding the rate limit."""
    call_id = db.usage_start(step["run_id"], step["id"], agent["id"], agent["model"])
    with _slots:
        return llm.call(agent["llmType"], agent["model"], agent["args"], env, prompt, ctx["workspace"],
                        [project["folder"]], resume=resume, timeout=TURN_TIMEOUT,
                        on_usage=lambda t: db.usage_set(call_id, t))


def turn(ctx, project, step, agent, is_lead, opening=False, wrapup=False, members_spoke=True):
    """One agent turn. Returns the reply text, or raises RuntimeError / Halt."""
    checkpoint(step["run_id"])
    sess = session(step["id"], agent["id"])
    since = sess["last_seq"] if sess else 0
    msgs = all_msgs(step["id"])
    new = [m for m in msgs if m["seq"] > since]
    row = db.agent_row(agent["id"])
    env = db.jload(row["env_json"], {}) if row else {}
    ctx = dict(ctx, tools=allowed_tools(agent))
    resume = sess["session_id"] if sess and sess["session_id"] else None
    text, sid, err = "", None, None
    if resume:
        prompt = prompts.delta(ctx, agent, is_lead, new, opening, wrapup, members_spoke)
        text, sid, err = metered_call(step, agent, env, prompt, ctx, project, resume=resume)
        if err:
            log.warning("resume failed for %s: %s; retrying with the full transcript", agent["name"], err)
    if not resume or err:
        prompt = prompts.full(ctx, agent, is_lead, msgs, opening, wrapup, members_spoke)
        text, sid, err = metered_call(step, agent, env, prompt, ctx, project)
    if err:
        # One more try: transient CLI failures (rate limits, network) are common overnight.
        time.sleep(10)
        text, sid, err = metered_call(step, agent, env, prompts.full(ctx, agent, is_lead, msgs, opening, wrapup, members_spoke),
                                      ctx, project)
    if err:
        raise RuntimeError("%s: %s" % (agent["name"], err))
    seq = db.add_message(step["id"], "agent", agent["name"], text or "(empty reply)", agent["id"])
    save_session(step["id"], agent["id"], sid, seq)
    kh.message(project["kh_project"], "[%s | %s/%s] %s" % (agent["name"], ctx["run_slug"], ctx["group_slug"], text))
    return text


DONE_RE = re.compile(r"^\s*\**STEP_DONE\**\s*$", re.M)


def parse_done(text):
    m = None
    for m in DONE_RE.finditer(text or ""):
        pass
    if not m:
        return None
    tail = text[m.end():]
    blocks = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", tail, re.S)
    data = None
    for b in reversed(blocks):
        try:
            data = json.loads(b)
            break
        except ValueError:
            continue
    if data is None:
        brace = tail.find("{")
        if brace >= 0:
            try:
                data = json.loads(tail[brace:tail.rfind("}") + 1])
            except ValueError:
                data = None
    if not isinstance(data, dict):
        data = {"summary": text[:m.start()].strip()[-1500:]}
    for k, d in (("summary", ""), ("artifacts", []), ("decisions", []), ("next_input", ""), ("tests", None)):
        data.setdefault(k, d)
    return data


# ---------------------------------------------------------------- closing a step: the PM gates

def close_step(project, run, step, ctx, summary, forced=False):
    """The lead closed the step (or its summary was forced). Record, verify, judge, then finish or park."""
    by = ctx["lead_name"] or "SDLC"
    notes = []
    try:
        refs = gov.ingest(project, run, step, summary, by)
        if refs:
            notes.append("registered " + ", ".join(refs))
    except Exception:  # noqa: BLE001 - governance bookkeeping never kills a step
        log.exception("register ingest failed")
    verdict, why = "pass", []
    if ctx["role"] in ("review", "test", "uat", "cutover", "hypercare") and str(summary.get("verdict") or "pass").lower() == "fail":
        verdict = "fail"
        why.append("%s reported verdict fail: %s" % (ctx["group_name"], str(summary.get("summary") or "")[:600]))
        for d in summary.get("defects") or []:
            why.append("- defect: %s" % (("%s (%s) at %s" % (d.get("title"), d.get("severity") or "?", d.get("file") or "?"))
                                         if isinstance(d, dict) else d))
    if ctx["role"] in ("intake", "blueprint"):
        # The intake signs off the SOW-level areas (A1..); the blueprint replaces them with the feature list (F1..)
        # that is built, traced to tests and accepted.
        refs = gov.ingest_scope(run["id"], summary)
        if not refs and not gov.scope_items(run["id"]):
            gov.add_scope(run["id"], run["title"], "as agreed in the intake conversation")
    if ctx["role"] == "plan" and summary.get("test_command") and not project.get("test_command"):
        db.ex("UPDATE project SET test_command=? WHERE id=?", str(summary["test_command"])[:500], project["id"])
        project = db.project_get(project["id"])
        notes.append("project test command set to: " + project["test_command"])
    if ctx["verify"]:
        v = gov.verify_tests(project, summary, int(gov.settings()["testTimeoutSec"]))
        set_step(step["id"], verify_json=json.dumps(v))
        notes.append("server test run: %s (%s)" % ("PASS" if v["passed"] else "FAIL", v["command"] or "no command"))
        if not v["passed"]:
            verdict = "fail"
            why.append("the server's own test run failed (%s, exit %s):\n%s" % (v["command"] or "no command", v["exit"],
                                                                                  v["output"][-1500:]))
            if v.get("claimed") is True:
                gov.add_item(project["id"], "issue", "Agent reported tests passed but the server's test run failed",
                             detail="Step '%s' of run #%d. Command: %s" % (ctx["group_name"], run["id"], v["command"]),
                             run_id=run["id"], step_run_id=step["id"], severity="high", created_by="SDLC")
    if ctx["role"] == "test" and gov.scope_items(run["id"]):
        unmet = gov.apply_trace(run["id"], summary)
        if unmet:
            verdict = "fail"
            why.append("scope items not traced to a passing test: " + ", ".join(unmet))
    set_step(step["id"], summary_json=json.dumps(summary), forced=1 if forced else 0, verdict=verdict)
    if notes:
        db.add_message(step["id"], "system", "SDLC", "; ".join(notes))
    if verdict == "fail":
        return finalize(project, run, db.one("SELECT * FROM step_run WHERE id=?", step["id"]), "fail", "\n".join(why))
    if forced or ctx["approval"] or ctx["approvers"]:
        set_step(step["id"], status="awaiting_approval", waiting_since=db.now(), nudge_level=0)
        what = ("the summary was forced (the lead never closed the step)" if forced else
                "sign-off needed from: " + ", ".join(ctx["approvers"]) if ctx["approvers"] else "this step needs a lead's approval")
        db.add_message(step["id"], "system", "SDLC", "Waiting for approval: %s. Approve, or Reject with a comment." % what)
        gov.notify("approval", "Run #%d '%s': step %d '%s' waits for approval (%s)." % (run["id"], run["title"], step["position"],
                                                                                        ctx["group_name"], what),
                   project["id"], run["id"], step["position"], recipient=run["owner"], level=1, kh_project=project["kh_project"])
        return "parked"
    return finalize(project, run, db.one("SELECT * FROM step_run WHERE id=?", step["id"]), "pass", "")


def finalize(project, run, step, verdict, reason):
    """Finish a step: pass -> done (and any approved change re-runs from its node); fail -> rework or failed."""
    run = db.run_get(run["id"])
    ctx = build_ctx(project, run, step, light=True)
    summary = db.jload(step["summary_json"], {}) or {}
    process = db.run_process(run) or {}
    if verdict == "fail":
        # No rework arrow: the step redoes its own work (a build whose server test run failed fixes it itself).
        target = (process.get("rework") or {}).get(step["node_id"]) or (step["node_id"] if process.get("nodes") else None)
        attempts = db.one("SELECT COUNT(*) AS n FROM step_run WHERE run_id=? AND node_id=?", run["id"], step["node_id"])["n"]
        limit = int(gov.settings()["maxRework"])
        if target and attempts <= limit:
            set_step(step["id"], status="rework", finished_at=db.now(), error=None, verdict="fail")
            back = db.proc_node(process, target)["group"]["name"]
            pos = db.insert_rework(run["id"], target, step["node_id"], step["position"],
                                   "'%s' (attempt %d) sent the work back to '%s'. Fix this:\n%s" % (
                                       ctx["group_name"], step["attempt"], back, reason))
            db.add_message(step["id"], "system", "SDLC", "Verdict FAIL: work goes back to '%s' (new step %d)." % (back, pos))
            kh.add_log(project["kh_project"], run["slug"], "[sdlc] %s project=%s feature=%s task=%s REWORK -> %s: %s" % (
                time.strftime("%Y-%m-%d"), project["slug"], run["slug"], ctx["group_slug"], back, reason[:1500]))
            return "next"
        msg = "quality gate failed%s: %s" % (" after %d attempt(s)" % attempts if target else "", reason[:900])
        set_step(step["id"], status="failed", error=msg, finished_at=db.now(), verdict="fail")
        gov.add_item(project["id"], "issue", "Quality gate failed at '%s' (run #%d)" % (ctx["group_name"], run["id"]),
                     detail=reason[:3000], run_id=run["id"], step_run_id=step["id"], severity="high", created_by="SDLC")
        return "failed"
    set_step(step["id"], status="done", finished_at=db.now(), error=None, waiting_since=None)
    tests = summary.get("tests")
    text = "[sdlc] %s project=%s feature=%s task=%s step %d/%d '%s' (%s lane) DONE%s: %s | decisions: %s | artifacts: %s | tests: %s | hand-over: %s" % (
        time.strftime("%Y-%m-%d"), project["slug"], run["slug"], ctx["group_slug"], ctx["pos"], ctx["total"], ctx["group_name"],
        ctx["lane"], " (forced, approved)" if step["forced"] else "", summary.get("summary"),
        "; ".join(map(str, summary.get("decisions") or [])), ", ".join(map(str, summary.get("artifacts") or [])),
        json.dumps(tests) if tests else "-", summary.get("next_input"))
    kh.add_log(project["kh_project"], run["slug"], text[:6000])
    if not ctx["gate"]:
        kh.add_knowledge(project["kh_project"], run["slug"], ctx["group_slug"],
                         "SDLC %s / %s / %s: %s" % (project["slug"], run["slug"], ctx["group_slug"], summary.get("summary")))
    db.add_message(step["id"], "system", "SDLC", "Step closed%s. Summary pushed to the dashboard and KH." % (
        " (forced summary, approved)" if step["forced"] else ""))
    if ctx["env"]:
        gov.promote(db.project_get(project["id"]), ctx["env"], "run #%d %s (step %d %s)" % (
            run["id"], run["slug"], step["position"], ctx["group_name"]), ctx["lead_name"] or "SDLC")
        db.add_message(step["id"], "system", "SDLC", "Promoted to %s." % ctx["env"].upper())
    rerun = run.get("rerun_from_node")
    if rerun:
        set_run(run["id"], rerun_from_node=None)
        order = [n["id"] for n in process.get("nodes") or []]
        if rerun in order and step["node_id"] in order and order.index(rerun) <= order.index(step["node_id"]):
            db.insert_rework(run["id"], rerun, step["node_id"], step["position"],
                             "an approved change request re-runs the work from here; see the change in the conversation.")
    return "next"


def human_since(step_id, seq):
    return [m for m in all_msgs(step_id) if m["seq"] > seq and m["senderKind"] in ("human", "system") and m["senderName"] != "SDLC"]


def park(step):
    s = db.one("SELECT waiting_since FROM step_run WHERE id=?", step["id"])
    set_step(step["id"], status="waiting_human", **({} if s["waiting_since"] else {"waiting_since": db.now(), "nudge_level": 0}))
    return "parked"


def run_step(project, run, step):
    if step["status"] == "awaiting_approval":
        return "parked"
    ctx = build_ctx(project, run, step)
    agents = ctx["agents"]
    if not agents:
        set_step(step["id"], status="failed", error="group '%s' has no agents" % ctx["group_name"], finished_at=db.now())
        return "failed"
    set_step(step["id"], status="running", started_at=step["started_at"] or db.now(), error=None)
    lead = agents[0]

    if ctx["gate"]:
        sess = session(step["id"], lead["id"])
        opening = sess is None
        wrap = bool(db.one("SELECT proceed FROM step_run WHERE id=?", step["id"])["proceed"])
        if wrap:
            set_step(step["id"], proceed=0)
            db.add_message(step["id"], "system", "User", "The user clicked Continue: finish this step now with what you have.")
        if not (opening or wrap or human_since(step["id"], sess["last_seq"] if sess else 0)):
            return park(step)
        set_step(step["id"], waiting_since=None, nudge_level=0)
        text = turn(ctx, project, step, lead, True, opening=opening, wrapup=wrap)
        # A human-gated step never closes on its opening turn: the user has not said anything yet.
        done = None if opening else parse_done(text)
        for m in agents[1:]:
            turn(ctx, project, step, m, False)
        if done:
            return close_step(project, run, step, ctx, done)
        return park(step)

    # Ungated: rounds, then a wrap-up turn for the lead.
    for rnd in range(1, ctx["max_rounds"] + 1):
        for i, agent in enumerate(agents):
            is_lead = i == 0
            members_spoke = rnd > 1 or not ctx["has_members"]
            text = turn(ctx, project, step, agent, is_lead, members_spoke=members_spoke)
            if is_lead and members_spoke:
                done = parse_done(text)
                if done:
                    return close_step(project, run, step, ctx, done)
    text = turn(ctx, project, step, lead, True, wrapup=True)
    done = parse_done(text)
    if done:
        return close_step(project, run, step, ctx, done)
    return close_step(project, run, step, ctx, {"summary": text[-1500:], "artifacts": [], "decisions": [],
                                                "next_input": text[-800:], "tests": None}, forced=True)


# ---------------------------------------------------------------- actions from the API

def _step(rid, pos):
    step = db.one("SELECT * FROM step_run WHERE run_id=? AND position=?", rid, pos)
    if not step:
        raise KeyError("no step %s" % pos)
    return step


def _resume(run):
    """A person answered: put a parked run back in the queue."""
    if run["status"] == "waiting_human":
        set_run(run["id"], status="pending")
    wake(run["project_id"])


def post_human(rid, content, by="User"):
    run = db.run_get(rid)
    if not run:
        raise KeyError("no run")
    if run["status"] in ("done", "failed", "cancelled"):
        raise ValueError("this run is %s" % run["status"])
    step = _step(rid, run["current_pos"])
    seq = db.add_message(step["id"], "human", by or "User", content)
    project = db.project_get(run["project_id"])
    kh.message(project["kh_project"], "[%s | %s/%s] %s" % (by or "User", run["slug"], step["group_slug"], content))
    if step["status"] == "awaiting_approval":
        # A comment on a step waiting for approval does not reopen it; Approve or Reject does.
        return seq
    _resume(run)
    return seq


def proceed(rid, pos):
    step = _step(rid, pos)
    set_step(step["id"], proceed=1)
    _resume(db.run_get(rid))


def retry(rid, pos):
    step = _step(rid, pos)
    if step["status"] != "failed":
        raise ValueError("only a failed step can be retried")
    set_step(step["id"], status="pending", error=None)
    set_run(rid, status="pending", finished_at=None, status_reason="")
    db.add_message(step["id"], "system", "SDLC", "Step retried by the user.")
    wake(db.run_get(rid)["project_id"])


def _user(actor):
    """API callers pass the signed-in user; internal callers and tests may pass a name (treated as admin)."""
    return actor if isinstance(actor, dict) else {"name": str(actor or "SDLC"), "role": "admin", "titles": ["*"]}


def signoff_titles(group):
    """The titles that must sign a step ([] while settings.signoffByTitle is off: any person signs)."""
    if not gov.settings().get("signoffByTitle"):
        return []
    return [a for a in (group.get("approvers") or []) if a]


def step_signoff(run, step):
    """The sign-off titles a step needs and which are still missing."""
    group, _ = step_group(run, step)
    required = signoff_titles(group)
    return required, gov.missing("step:%d" % step["id"], required)


def approve(rid, pos, actor, note="", title=None):
    """Sign a step waiting for approval. A step with sign-off titles closes only when every title has signed
    (e.g. UAT: business lead AND pmo); each person signs under a title they hold."""
    user = _user(actor)
    run = db.run_get(rid)
    step = _step(rid, pos)
    if step["status"] != "awaiting_approval":
        raise ValueError("this step is not waiting for approval")
    required, need = step_signoff(run, step)
    if required:
        if title:
            title = title.strip().lower()
            if title not in need:
                raise ValueError("'%s' is not a sign-off this step still needs (%s)" % (title, ", ".join(need) or "none"))
        else:
            title = next((t for t in need if gov.may_sign(user, t)), None)
            if not title:
                raise ValueError("you hold none of the sign-offs still needed: %s" % ", ".join(need))
        if not gov.may_sign(user, title):
            raise ValueError("only a %s may sign this (%s)" % (title, ", ".join(gov.holders(title)) or "nobody holds it"))
        gov.sign("step:%d" % step["id"], title, user, note)
        db.add_message(step["id"], "human", user["name"], "SIGNED OFF as %s%s" % (title, (": " + note) if note else ""))
        left = gov.missing("step:%d" % step["id"], required)
        if left:
            db.add_message(step["id"], "system", "SDLC", "Still waiting for sign-off from: " + ", ".join(left))
            project = db.project_get(run["project_id"])
            for t in left:
                for who in gov.holders(t) or [project["owner"]]:
                    gov.notify("approval", "Run #%d '%s' step %d '%s' waits for your sign-off as %s." % (
                        rid, run["title"], pos, step["group_name"], t), project["id"], rid, pos, recipient=who, level=1,
                        kh_project=project["kh_project"])
            return {"signed": title, "waitingFor": left}
    actor = user["name"]
    signers = ", ".join(sorted({x["approver"] for x in gov.signoffs("step:%d" % step["id"]) if x["decision"] == "approved"})) or actor
    set_step(step["id"], approved_by=signers, approved_at=db.now(), approval_note=note or "", waiting_since=None)
    if not required:
        db.add_message(step["id"], "human", actor, "APPROVED" + (": " + note if note else ""))
        gov.sign("step:%d" % step["id"], "lead", user, note)
    gov.approve_step_decisions(step["id"], signers)
    project = db.project_get(run["project_id"])
    finalize(project, run, db.one("SELECT * FROM step_run WHERE id=?", step["id"]), "pass", "")
    if db.run_get(rid)["status"] == "waiting_human":
        set_run(rid, status="pending")
    wake(run["project_id"])
    return {"signed": title, "waitingFor": []}


def reject(rid, pos, actor, note, send_back=False):
    """Reject a step waiting for approval. send_back follows the step's rework arrow (e.g. UAT -> Implementation);
    otherwise the same step's agents rework their result with the comment."""
    run = db.run_get(rid)
    step = _step(rid, pos)
    if step["status"] != "awaiting_approval":
        raise ValueError("this step is not waiting for approval")
    if not (note or "").strip():
        raise ValueError("say why you reject it")
    user = _user(actor)
    actor = user["name"]
    required, need = step_signoff(run, step)
    if required and not any(gov.may_sign(user, t) for t in required):
        raise ValueError("only a %s may reject this step" % " / ".join(required))
    gov.sign("step:%d" % step["id"], next((t for t in required if gov.may_sign(user, t)), "lead"), user, note, "rejected")
    # The re-done step must be signed again from the start.
    db.ex("DELETE FROM approval WHERE target=? AND decision='approved'", "step:%d" % step["id"])
    db.add_message(step["id"], "human", actor, "REJECTED: " + note)
    set_step(step["id"], approval_note=note, waiting_since=None)
    project = db.project_get(run["project_id"])
    target = ((db.run_process(run) or {}).get("rework") or {}).get(step["node_id"])
    if send_back and target:
        outcome = finalize(project, run, db.one("SELECT * FROM step_run WHERE id=?", step["id"]), "fail",
                           "Rejected by %s: %s" % (actor, note))
        if outcome == "failed":
            set_run(rid, status="failed")
        elif db.run_get(rid)["status"] == "waiting_human":
            set_run(rid, status="pending")
    else:
        set_step(step["id"], status="pending", forced=0, verdict=None)
        if db.run_get(rid)["status"] == "waiting_human":
            set_run(rid, status="pending")
    wake(run["project_id"])


def pause(rid, actor):
    run = db.run_get(rid)
    if run["status"] not in ("pending", "running", "waiting_human"):
        raise ValueError("only an active run can be paused")
    set_run(rid, status="paused", status_reason="paused by " + actor)


def resume(rid, actor):
    run = db.run_get(rid)
    if run["status"] != "paused":
        raise ValueError("this run is not paused")
    waiting = db.one("SELECT id FROM step_run WHERE run_id=? AND status IN ('waiting_human','awaiting_approval')", rid)
    set_run(rid, status="waiting_human" if waiting else "pending", status_reason="")
    wake(run["project_id"])


def cancel(rid, actor, reason=""):
    run = db.run_get(rid)
    if run["status"] in ("done", "cancelled"):
        raise ValueError("this run is already %s" % run["status"])
    set_run(rid, status="cancelled", finished_at=db.now(), status_reason=("cancelled by %s: %s" % (actor, reason)).strip(": "))
    db.ex("UPDATE step_run SET status='skipped' WHERE run_id=? AND status NOT IN ('done','rework','failed')", rid)
    wake(run["project_id"])


def rerun_from(rid, pos, reason):
    """Re-do the work from step pos: now for a finished run, after the current step for an active one."""
    run = db.run_get(rid)
    step = _step(rid, pos)
    if not step["node_id"] or not db.run_process(run):
        raise ValueError("this run predates frozen processes and cannot be re-run from a step")
    _reopen_cost(run, step, reason)
    if run["status"] in ("done", "failed"):
        db.append_rerun(rid, step["node_id"], reason)
        set_run(rid, status="pending", finished_at=None, status_reason="")
        wake(run["project_id"])
        return "now"
    if run["status"] == "cancelled":
        raise ValueError("this run was cancelled")
    set_run(rid, rerun_from_node=step["node_id"])
    return "after the current step"


def _reopen_cost(run, step, reason):
    """PM rule: re-opening a phase after its sign-off costs additional time and cost. Record it, and move the
    run's due time by the estimate of the steps that will be done again."""
    process = db.run_process(run) or {"nodes": []}
    order = [n["id"] for n in process["nodes"]]
    if step["node_id"] not in order:
        return
    tail = set(order[order.index(step["node_id"]):])
    signed = [x for x in db.steps_of(run["id"]) if x["node_id"] in tail and x["approved_by"]]
    if not signed:
        return
    names = sorted({x["group_name"] for x in signed})
    extra = sum(int(n["group"].get("estimateMin") or 10) for n in process["nodes"] if n["id"] in tail)
    if run["due_at"]:
        set_run(run["id"], due_at=db.ts_plus(extra, run["due_at"]))
    gov.add_item(run["project_id"], "issue", "Signed-off work re-opened on run #%d: %s" % (run["id"], ", ".join(names)),
                 detail="Re-opening a phase after its sign-off costs additional time and cost. Reason: %s. Due time moved by %d min." % (
                     reason[:1500], extra), run_id=run["id"], severity="medium", created_by="SDLC")


def raise_change(rid, title, detail, actor):
    """A change request on a run: a register item; while the run is active the agents are asked for its impact."""
    run = db.run_get(rid)
    item = gov.add_item(run["project_id"], "change", title, detail=detail, run_id=rid, created_by=actor)
    if run["status"] in ("pending", "running", "waiting_human"):
        step = _step(rid, run["current_pos"])
        if step["status"] != "awaiting_approval":
            post_human(rid, "CHANGE REQUEST %s: %s\n%s\nAssess its impact on scope, time and cost and name the earlier "
                            "artifacts it makes stale. Do not implement it until it is approved." % (item["ref"], title, detail), by=actor)
    return item


def decide_change(iid, approve_it, actor, rerun_pos=None, note=""):
    """Sign or reject a change request. Signatures come in the order of settings.crApprovers (steering
    committee, then client); the change is approved only when the last one signs. Then it is added to the
    scope and, unless told otherwise, the work re-runs from the spec step (the blueprint is updated first)."""
    user = _user(actor)
    actor = user["name"]
    item = gov.item_get(iid)
    if not item or item["kind"] != "change":
        raise KeyError("no change request %s" % iid)
    if item["status"] != "proposed":
        raise ValueError("this change is already %s" % item["status"])
    target = "item:%d" % iid
    seq = gov.settings()["crApprovers"] or ["lead"]
    need = gov.missing(target, seq)
    title = need[0] if need else seq[-1]
    if not gov.may_sign(user, title):
        raise ValueError("the next signature on this change is the %s (%s)" % (title, ", ".join(gov.holders(title)) or "nobody holds it"))
    gov.sign(target, title, user, note, "approved" if approve_it else "rejected")
    if approve_it and len(need) > 1:
        return dict(gov.item_get(iid), rerun=None, waitingFor=need[1:])
    item = gov.update_item(iid, {"status": "approved" if approve_it else "rejected",
                                 "detail": (item["detail"] + ("\n\nDecision note: " + note if note else "")).strip()}, actor)
    if approve_it and item["runId"] and rerun_pos is None:
        run = db.run_get(item["runId"])
        spec = next((x for x in db.steps_of(run["id"]) if x["group_id"] == "g-spec" and x["status"] == "done"), None)
        rerun_pos = spec["position"] if spec else None
    if rerun_pos in (0, "0", "none"):
        rerun_pos = None
    when = None
    if approve_it and item["runId"]:
        gov.add_scope(item["runId"], "%s: %s" % (item["ref"], item["title"]), item["detail"][:500])
        if rerun_pos:
            when = rerun_from(item["runId"], int(rerun_pos), "change request %s approved by %s: %s\n%s" % (
                item["ref"], actor, item["title"], item["detail"]))
        run = db.run_get(item["runId"])
        if run["status"] in ("pending", "running", "waiting_human"):
            step = _step(run["id"], run["current_pos"])
            db.add_message(step["id"], "system", "SDLC", "%s APPROVED by %s%s." % (
                item["ref"], actor, (", re-run " + when) if when else ""))
    return dict(item, rerun=when)
