"""The agents' working memory in the knowledge store: the same discipline a person's Claude session follows there.

A person's session spends few tokens because the store does the looking up: a hook computes one short turn
context per message (project, action menu with on-demand plans, findings, nearest lesson titles), each step
asks for ONE bounded pack instead of many searches, a full row is read only when used, and every turn leaves a
worklog the next session reads instead of re-deriving. The agents of a run get the same:

  turn context   every agentic call starts with GET /turn/context for its task (added to the prompt by
                 llm/cli.with_hooks) plus a short kernel: how to use the tools below, budget first
  tools          step_context  POST /context/step       one bounded pack (entities, knowledge, log) + open threads
  (dlc mcp)      read_items    POST /vector/scroll      a row in full, only for a truncated item that is used
                 follow_plan   GET  /policy/plan        the rules of one action of the menu, in order
                 record_finding POST /vector/add        scope findings: a problem + its fix, read by later agents
                 save_lesson   POST /vector/add         scope knowledge, kind lesson: a reusable rule
                 write_worklog POST /vector/add         scope log: what was done (the engine also writes one)
  worklog        after every agentic call the engine stores one log row (role, run, unit, outcome, the agent's
                 closing summary) unless the agent wrote one itself: no extra model turn

The store is the run's project (detail.rag_project) with the shared lessons project as fallback for reads.
Off when the engine has no http knowledge store (LINE_RAG != http) or LINE_AGENT_MEMORY=0. Every call is best
effort: a store that does not answer never fails an agent call.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional

from . import codes

TOOLS = ["step_context", "read_items", "follow_plan", "record_finding", "save_lesson", "write_worklog"]
SCOPES = {"knowledge": "knowledge", "log": "log", "findings": "findings"}
TURN_CHARS = 3000
PACK_CHARS = 6000
MAX_WRITE = 4000
#: recall: findings and lessons come by similarity to the task (top RECALL_K per source above RECALL_FLOOR), one
#: title line each with its id, never the whole list; read_items gives the full row (like the store's own lessons block)
RECALL_K = int(os.environ.get("LINE_AGENT_RECALL_K", "3"))
RECALL_FLOOR = float(os.environ.get("LINE_AGENT_RECALL_FLOOR", "0.6"))
RECALL_LINES = 6
TITLE_CHARS = 200
#: read-only libraries every agent may read by id (read_items), after its run's project and the shared lessons:
#: the design library (styles, specs, reference HTML) that the 'design user interface' plan points to
LIBRARY = tuple(p.strip() for p in os.environ.get("LINE_AGENT_LIBRARY", "designer").split(",") if p.strip())

KERNEL = """## Working memory (the project's knowledge store)
The turn context below was computed for this task: project, the action menu, findings and the nearest lessons.
Do not search for what it already answers. Then, step by step:
- step_context: ONE call per step of your work with the step's intent in plain English; it returns one bounded
  pack (entities, knowledge, log) and its open threads. Prefer it to guessing; at most 3 extra steps per question.
- read_items: read a row in full only when you use a truncated item.
- The run board at the end of your prompt is what the earlier steps settled: continue from it, never redo a
  settled step. post_message tags the roles of this run that need a fact or decision from you (never private).
- code_graph (when listed): the repository's code map; ask it where code lives and what a change affects before
  reading files, then Read only the lines it names.
- follow_plan: when an action of the menu fits your task, read its plan and follow it.
- record_finding: when you hit a problem and fixed it (a title naming the problem; symptom, cause, fix).
- save_lesson: when you learnt a rule that holds beyond this task (a title that is the rule; short, imperative).
  Later agents find both by similarity to their task and see only the title first: make the title say it.
The engine stores your closing summary as this call's worklog; end with what you did and its result."""

#: the agents' action menu, seeded once into the store for every project (source_policy POLICY_VERSION): an
#: agent's turn context lists these; follow_plan returns the rules of one, in order
POLICY_VERSION = "dlc-agents-2026-10-17"
POLICIES: List[Dict[str, Any]] = [
    {"action": "analyse spec", "description": "Spec analyst: turn a request, ticket or bug report into a clear, "
     "grounded spec before the readers and builders start.",
     "rules": [
         ("links first", "Open every ticket or page the request links (get_session + fetch or open_page) before "
                         "anything else; quote ticket fields verbatim."),
         ("project memory", "step_context once per question you need answered (what exists, earlier fixes, "
                            "decisions); read a truncated item with read_items only when you use it."),
         ("code", "Read the repository read-only: find where the change lands; name files and functions."),
         ("write", "Write the analysis: what is asked, where in the code, what the project already knows, "
                   "acceptance checks, open questions. Facts with their source; no guesses presented as facts."),
         ("record", "A wrong or missing piece of project knowledge you found: record_finding.")]},
    {"action": "build unit", "description": "Builder: implement one planned unit on its branch, with its tests "
     "green.",
     "rules": [
         ("findings first", "Read FINDINGS in your turn context; a finding on the files or errors of this unit "
                            "is applied, not rediscovered."),
         ("how to build", "One step_context for how this repository builds and tests (commands, conventions) "
                          "unless the turn context already says it."),
         ("conventions", "Follow the repository's own style, layout and test framework; no new dependency "
                         "unless the unit asks for it."),
         ("tests", "Run the unit's tests and the existing ones it touches; never weaken a locked acceptance "
                   "test."),
         ("record", "A non-obvious problem you fixed (a tool quirk, an environment trap, a misleading "
                    "error): record_finding with symptom, cause, fix. A rule that holds beyond this unit: "
                    "save_lesson."),
         ("finish", "Leave git to the line (no commit, rebase, merge or push): the engine commits your work "
                    "and the merger integrates it. End with what you changed, the test result and SUBMIT.")]},
    {"action": "merge unit", "description": "Merger: integrate a verified unit into main; resolve its conflicts "
     "with the units merged before it.",
     "rules": [
         ("both sides", "Read both sides of every overlap (git diff, git log -p on the files): what the unit was "
                        "asked to do and what main gained since."),
         ("business rule", "step_context or search_knowledge for the business rule that decides the overlap "
                           "(the feature, field or rule involved, earlier decisions); keep both intents unless a "
                           "rule says otherwise, and name the rule that decided."),
         ("locked tests", "Never change locked acceptance tests; make the code satisfy them."),
         ("git", "Resolve, git add, git rebase --continue (or commit the integration fix); never push, never "
                 "abort the rebase, never touch other branches."),
         ("verdict", "SUBMIT when integrated and the tests pass; BLOCKED:<reason> when the unit cannot be "
                     "integrated as specified (e.g. a locked test no code can satisfy): a person decides."),
         ("record", "A conflict pattern or decision worth keeping: record_finding (files, both intents, the "
                    "rule that decided).")]},
    {"action": "fix failure", "description": "Fixer or builder retry: make a failing check pass (tests, lint, "
     "build, deploy, QAS).",
     "rules": [
         ("error verbatim", "Read the failure output in full; quote the first real error line."),
         ("known first", "step_context with the error text: a finding or lesson for it comes before any "
                         "experiment."),
         ("smallest fix", "Change the least code that fixes the cause, not the symptom; rerun the check."),
         ("record", "record_finding (symptom, cause, fix) when the cause was not obvious from the error.")]},
    {"action": "review change", "description": "Reviewer or verifier: judge a unit's change against its spec and "
     "the project's rules.",
     "rules": [
         ("spec", "Check the change against the unit's acceptance checks first, then the project's conventions "
                  "(step_context when unsure)."),
         ("evidence", "Every remark names the file and line and the rule it breaks."),
         ("verdict", "SUBMIT when it meets the spec; BLOCKED:<reason> with the concrete gap otherwise.")]},
    {"action": "run hook task", "description": "Hook agent: a task an admin attached to a run event (close a "
     "ticket, check an approval, post a note).",
     "rules": [
         ("context", "Read context.md first: run, spec, repository, commits, earlier hooks."),
         ("act", "Use only the apps the hook names; never print secrets."),
         ("verdict", "A waiting hook ends with SUBMIT or BLOCKED:<reason> on the last line.")]},
    {"action": "deploy and test", "description": "Deploy or QAS agent: put the build on its test environment and "
     "run the acceptance tests.",
     "rules": [
         ("how", "step_context for how this project deploys and tests (scripts, environments, accounts)."),
         ("never prod", "Never deploy to production; the guard refuses it anyway."),
         ("report", "Report each acceptance check with its result; record_finding for an environment trap.")]},
]

# the change sizer's rubric (understand.sizer.RULES): editable in the store, read by every run's sizer
from .understand.sizer import ACTION as _SIZE_ACTION, RULES as _SIZE_RULES   # noqa: E402
POLICIES.append({"action": _SIZE_ACTION, "description": "Change sizer: put a request (any flow) on level 1-4; the "
                 "level decides who builds it (1-2 one agent, 3-4 the team).", "rules": list(_SIZE_RULES)})

_wrote: Dict[str, bool] = {}           # agent call token -> wrote its own worklog
_lock = threading.Lock()
_seeded = False


def enabled(cfg: Any) -> bool:
    from .ragmap import enabled as store_on
    return os.environ.get("LINE_AGENT_MEMORY", "1").strip() != "0" and store_on(cfg)


def _project(cfg: Any, project: str = "") -> str:
    from .ragmap import shared
    if project:
        return project
    extra = dict(getattr(cfg, "rag_extra", None) or {})
    return str(extra.get("project") or "") or shared(cfg)


def _pool(cfg: Any) -> str:
    """The shared lesson pool every project's agents read (rag_extra.shared_project, else ragmap.shared)."""
    from .ragmap import shared
    return str(dict(getattr(cfg, "rag_extra", None) or {}).get("shared_project") or "") or shared(cfg)


def _call(cfg: Any, method: str, path: str, body: Any = None) -> Dict[str, Any]:
    from .ragmap import _http
    st, j, _ = _http(cfg, method, path, body)
    if st >= 400:
        raise RuntimeError("store answered %s: %s" % (st, str(j.get("detail") or j.get("error") or j)[:300]))
    return j


# ------------------------------------------------------------------ turn context (prompt)

def seed(cfg: Any) -> int:
    """Put the agents' action menu (POLICIES) into the store once per engine process; an action already there
    with this POLICY_VERSION is left alone. -> actions written. Never raises."""
    global _seeded
    if _seeded or not enabled(cfg):
        return 0
    n = 0
    try:
        have = {a.get("action"): a for a in (_call(cfg, "GET", "/policy/actions?project=" + urllib.parse.quote(
            _project(cfg))).get("actions") or [])}
        for p in POLICIES:
            if (have.get(p["action"]) or {}).get("source_policy") == POLICY_VERSION:
                continue
            _call(cfg, "POST", "/policy/action/set", {"project": "every project", "action": p["action"],
                                                       "description": p["description"], "priority": 100,
                                                       "source_policy": POLICY_VERSION})
            for i, (sub, content) in enumerate(p["rules"], 1):
                _call(cfg, "POST", "/policy/rule/set", {"project": "every project", "action": p["action"],
                                                         "sub_action": sub, "seq": i, "content": content})
            n += 1
        _seeded = True
    except Exception:   # noqa: BLE001 - the next call tries again
        pass
    return n


def turn_context(cfg: Any, role: str, task: str, project: str = "") -> str:
    """The kernel and the store's turn context for one agent call ('' when the store is off or silent): the
    run project's menu, then the findings and lessons nearest the task by similarity, title only (recall)."""
    from .ragmap import shared
    if not enabled(cfg):
        return ""
    seed(cfg)
    proj = _project(cfg, project)
    task1 = " ".join((task or "").split())[:700]
    try:
        j = _call(cfg, "GET", "/turn/context?" + urllib.parse.urlencode(
            {"text": "project %s, %s: %s" % (proj, role or "agent", task1)}))
    except Exception:   # noqa: BLE001 - best effort
        return ""
    body = str(j.get("text") or "").split("\n", 1)[-1]          # drop the hook's own header line
    body = re.sub(r"GET /policy/plan\?action=<label>&project=\S+ and follow it", "call follow_plan with it", body)
    body = re.sub(r"\(read a whole row with POST /vector/scroll[^)]*\)", "(read_items for the full row)", body)
    body = _FINDINGS_BLOCK.sub("", body)    # the store lists the first findings, not the near ones: recall below
    out = ["TURN CONTEXT (computed for this task: project, action menu, findings and lessons are already looked "
           "up)", body.strip()]
    pool = str(dict(getattr(cfg, "rag_extra", None) or {}).get("shared_project") or "") or shared(cfg)
    near = recall(cfg, proj, pool, "%s: %s" % (role or "agent", task1))
    out.append("FINDINGS AND LESSONS near this task (title only; read_items with the id and scope for the full "
               "row):" if near else "FINDINGS AND LESSONS: none above the floor for this task.")
    out += near
    return "\n\n" + KERNEL + "\n\n" + "\n".join(out)[:TURN_CHARS]


#: one-shot (non-agentic) roles that write content and so must apply earlier lessons; the spec readers stay
#: independent of the store (they must read the spec as written)
RECALL_ROLES = ("test_author", "planner", "reviewer", "judge")


def lessons_block(cfg: Any, role: str, task: str, project: str = "") -> str:
    """For a one-shot call (no tools): the findings and lessons nearest its task, title only. '' when none."""
    from .ragmap import shared
    if role not in RECALL_ROLES or not enabled(cfg):
        return ""
    proj = _project(cfg, project)
    pool = str(dict(getattr(cfg, "rag_extra", None) or {}).get("shared_project") or "") or shared(cfg)
    near = recall(cfg, proj, pool, "%s: %s" % (role, " ".join((task or "").split())[:700]))
    if not near:
        return ""
    return ("\n\n## Lessons and findings from earlier runs, near this task (apply those that fit; never weaken "
            "the spec for them)\n" + "\n".join(near))


_FINDINGS_BLOCK = re.compile(r"^FINDINGS \([^)]*\):.*\n?(?:^ +- .*\n?)*", re.M)


def title_of(text: str) -> str:
    """The first line, or first sentence, of a stored row: what an agent sees before it reads the row."""
    line = (text or "").strip().split("\n", 1)[0].strip()
    cut = line.find(". ")
    if 0 < cut < TITLE_CHARS:
        line = line[:cut + 1]
    return line if len(line) <= TITLE_CHARS else line[:TITLE_CHARS - 3].rstrip() + "..."


def recall(cfg: Any, project: str, pool: str, text: str) -> List[str]:
    """Findings and lessons of the run's project, and the shared pool's lessons, nearest to the task: the top
    RECALL_K of each source above RECALL_FLOOR, best first, one title line each. Never raises."""
    asks = [("findings", project, None), ("knowledge", project, {"kind": "lesson"})]
    if pool and pool != project:
        asks.append(("knowledge", pool, None))
    hits: Dict[str, Any] = {}
    for scope, proj, where in asks:
        body: Dict[str, Any] = {"text": text[:1000], "k": RECALL_K, "scope": scope, "project": proj,
                                "min_score": RECALL_FLOOR, "max_chars": 400}
        if where:
            body["where"] = where
        try:
            for h in _call(cfg, "POST", "/vector/query", body).get("hits") or []:
                vid, score = str(h.get("vector_id") or ""), float(h.get("score") or 0)
                if vid and score >= RECALL_FLOOR and score > hits.get(vid, (0,))[0]:
                    hits[vid] = (score, scope, title_of(str(h.get("source_text") or "")))
        except Exception:   # noqa: BLE001 - recall helps; a store hiccup never stops the agent
            continue
    best = sorted(hits.items(), key=lambda kv: -kv[1][0])[:RECALL_LINES]
    return ["  - %s (%s, %.2f): %s" % (vid, scope, score, title) for vid, (score, scope, title) in best]


# ------------------------------------------------------------------ tools

def _pack(j: Dict[str, Any]) -> str:
    out = []
    for it in j.get("items") or []:
        mark = " [truncated, %s chars: read_items]" % it.get("text_len") if it.get("truncated") else ""
        out.append("- %s (%s%s)%s\n  %s" % (it.get("id"), it.get("tier"), (", %.2f" % it["score"]) if
                                            isinstance(it.get("score"), (int, float)) else "", mark,
                                            str(it.get("text") or "").replace("\n", "\n  ")))
    for t in j.get("open_threads") or []:
        out.append("open thread %s: %s %s" % (t.get("kind"), t.get("hint") or "", ", ".join(t.get("ids") or t.get("refs") or [])))
    return "\n".join(out) or "Nothing above the floor for this step."


def handle(cfg: Any, sc: Dict[str, Any], tool: str, args: Dict[str, Any], tok: str = "") -> str:
    """One memory tool call of an agent (sc = its token scope: run, role, rag_project). Raises ValueError for
    a bad argument; the caller turns other errors into an answer."""
    if not enabled(cfg):
        raise ValueError("This engine has no knowledge store configured.")
    proj = _project(cfg, str(sc.get("rag_project") or ""))
    if tool == "step_context":
        text = str(args.get("text") or args.get("question") or "").strip()
        if not text:
            raise ValueError("text is required: the step's intent in plain English")
        j = _call(cfg, "POST", "/context/step", {"text": text, "project": proj,
                                                 "include_log": bool(args.get("include_log")),
                                                 "budget_chars": max(1000, min(int(args.get("max_chars") or PACK_CHARS), 12000))})
        return _pack(j)
    if tool == "read_items":
        from .ragmap import shared
        ids = [str(x) for x in (args.get("ids") or []) if str(x).strip()][:10]
        if not ids:
            raise ValueError("ids is required")
        out, left = [], list(ids)
        # the run's project first, then the shared lessons and the read-only libraries (a plan names their ids)
        pool = str(dict(getattr(cfg, "rag_extra", None) or {}).get("shared_project") or "") or shared(cfg)
        for p in dict.fromkeys([proj, pool] + list(LIBRARY)):
            for scope in (str(args.get("scope") or ""),) if args.get("scope") else ("knowledge", "log", "findings"):
                if not p or not left:
                    break
                j = _call(cfg, "POST", "/vector/scroll", {"scope": scope, "project": p, "ids": left})
                for h in j.get("hits") or []:
                    if h.get("vector_id") in left:
                        left.remove(h.get("vector_id"))
                        out.append("%s (%s)\n%s" % (h.get("vector_id"), scope, h.get("source_text")))
        return "\n\n".join(out) or "No such rows in this project."
    if tool == "follow_plan":
        action = str(args.get("action") or "").strip()
        if not action:
            raise ValueError("action is required (a label of the action menu)")
        j = _call(cfg, "GET", "/policy/plan?" + urllib.parse.urlencode({"action": action, "project": proj}))
        rules = j.get("rules") or []
        return "\n".join("%d. [%s] %s" % (r.get("seq") or i + 1, r.get("sub_action"), r.get("content"))
                         for i, r in enumerate(rules)) or "No plan for '%s' in this project." % action
    kind = {"record_finding": "findings", "save_lesson": "knowledge", "write_worklog": "log"}.get(tool)
    if kind:
        text = str(args.get("text") or "").strip()
        if len(text) < 20:
            raise ValueError("text is required (at least a sentence)")
        subject = str(args.get("subject") or sc.get("role") or "agent").strip()[:80]
        if tool == "save_lesson" and args.get("share"):   # a rule for any project: the shared pool
            proj = _pool(cfg)
        if tool != "write_worklog":   # title first: what recall shows, and the line similarity matches best
            text = titled("LESSON" if tool == "save_lesson" else "FINDING", subject, str(args.get("title") or ""),
                          text)
        write(cfg, proj, kind, text[:MAX_WRITE], subject, str(sc.get("role") or ""), str(sc.get("run") or ""),
              extra={"kind": "lesson"} if tool == "save_lesson" else None)
        if tool == "write_worklog" and tok:
            with _lock:
                _wrote[tok] = True
        return "stored in %s (%s)" % (proj, kind)
    raise ValueError("no memory tool %s" % tool)


def titled(kind: str, subject: str, title: str, text: str) -> str:
    """'<KIND> [<subject>]: <title>' then the body. No title given: the body's first sentence is the title."""
    body = text.strip()
    if re.match(r"^(LESSON|FINDING)( LEARNED)? \[", body):
        return body                                   # already titled (e.g. copied from another store)
    body = re.sub(r"^(LESSON|FINDING):\s*", "", body)
    title = " ".join((title or "").split()) or title_of(body)
    rest = body[len(title):].lstrip(" .\n") if body.startswith(title) else body
    return "%s [%s]: %s\n%s" % (kind, subject, title.rstrip("."), rest) if rest else "%s [%s]: %s" % (
        kind, subject, title.rstrip("."))


def write(cfg: Any, project: str, scope: str, text: str, subject: str, role: str, run: str,
          extra: Optional[Dict[str, Any]] = None) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta = {"scope": scope, "project": project, "subject": subject, "topic": subject, "ts": ts,
            "author": "dlc-agent:%s" % (role or "agent"), "run": run, **(extra or {})}
    _call(cfg, "POST", "/vector/add", {"text": text, "scope": scope, "metadata": meta})


# ------------------------------------------------------------------ the engine's worklog per agent call

def wrote_own(tok: str) -> bool:
    with _lock:
        return bool(_wrote.pop(tok, False))


def call_worklog(cfg: Any, role: str, run: str, key: str, outcome: str, text: str, usd: float,
                 tok: str = "") -> None:
    """After an agentic call: one log row unless the agent stored its own. Never raises."""
    try:
        if not enabled(cfg) or (tok and wrote_own(tok)):
            return
        tail = " ".join((text or "").split())[-1200:]
        body = "%s %s of run %s%s: %s ($%.2f). %s" % (time.strftime("%Y-%m-%d"), role, run or "-",
                                                     (" (%s)" % key) if key else "", outcome, usd or 0.0, tail)
        write(cfg, _project(cfg), "log", body, "agent %s" % role, role, run)
    except Exception:   # noqa: BLE001
        pass


# ------------------------------------------------------------------ learning after a run (distil)

DISTIL_ROLE = "distiller"
DISTIL_PROMPT = """You are the distiller of an automated delivery line. Turn the project's new worklogs (what its
agents did, failed at and fixed) into knowledge the next agents read, so they do not repeat the work.

The knowledge store answers on {url} (no sign-in; JSON). Use curl from Bash (or Python urllib). Steps:
1. GET {url}/distill/next?project={project}&limit=20 . If it says done true: reply 'nothing new' and SUBMIT.
2. Follow its 'rules' field. Write items from its logs: findings (symptom, cause, fix: names, paths and errors
   verbatim), lessons (short imperative rules that hold beyond one task), how-tos (how this project builds, tests,
   deploys). Merge into its 'neighbours' (updates / contradicts) instead of writing duplicates. English only.
3. POST {url}/distill/submit {{"project": "{project}", "batch_id": <from next>, "items": [...], "contexts": [...],
   "signal_words": [...], "distilled_by": "dlc-distiller"}} , even with an empty item list. A submit with rejected
   items keeps the batch open: fix only those and resend with the same batch_id. Repeat 1-3 until done (at most
   {batches} batches).
4. GET {url}/distill/pending?project={project} and approve the items you proposed: POST {url}/distill/approve
   {{"project": "{project}", "ids": [...], "share": [<ids of lessons that hold for any project>]}} ; shared
   lessons reach every project's agents through the pool '{pool}'. Leave contested items alone.
5. End with one line: logs read, items accepted, merged, rejected, shared; then SUBMIT."""

_distilling: Dict[str, bool] = {}


def consented(cfg: Any, project: str) -> bool:
    """Has this project consented to distilling in the store? Asked before the distiller's
    model call: without consent every /distill route answers 403 and the call would only burn tokens. A store
    that does not answer counts as no."""
    try:
        return bool(_call(cfg, "GET", "/distill/cursor?project=" + urllib.parse.quote(project)).get("consented"))
    except Exception:   # noqa: BLE001
        return False


def distil_after_run(pipe: Any, batches: int = 3) -> bool:
    """At a run's end: one background distiller call on the run's project (never two at once per project).
    -> started. Never raises; off with LINE_AGENT_LEARN=0."""
    import threading as _t
    from .ragmap import shared
    cfg = getattr(pipe, "cfg", None)
    if os.environ.get("LINE_AGENT_LEARN", "1").strip() == "0" or not enabled(cfg) or not hasattr(pipe, "llm"):
        return False
    proj = _project(cfg)
    with _lock:
        if _distilling.get(proj):
            return False
        _distilling[proj] = True
    home = os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")
    work = os.path.join(home, "distil", proj)
    pool = str(dict(getattr(cfg, "rag_extra", None) or {}).get("shared_project") or "") or shared(cfg)
    prompt = DISTIL_PROMPT.format(url=str(cfg.rag_url).rstrip("/"), project=proj, pool=pool, batches=batches)

    def go() -> None:
        try:
            if not consented(cfg, proj):
                pipe.log("%s: distil %s: skipped, the store has no consent to distil this project" % (pipe.run, proj))
                return
            os.makedirs(work, exist_ok=True)
            pipe.llm.agentic(DISTIL_ROLE, work, prompt, 40, 1.0, key="distil", run=pipe.run)
        except Exception as e:   # noqa: BLE001
            try:
                pipe.log("%s: distil %s: %s" % (pipe.run, proj, e))
            except Exception:   # noqa: BLE001
                pass
        finally:
            with _lock:
                _distilling.pop(proj, None)

    _t.Thread(target=go, name="line-distil-%s" % proj, daemon=True).start()
    return True


# ------------------------------------------------------------------ learning from a failed run (retro)

RETRO_ROLE = "retro"
RETRO_PROMPT = """You are the retrospective agent of an automated delivery line. Run {run} of project {project} ended
{state} ({code}: {message}). Find out why, and make sure no later run fails the same way.

Evidence from the run (escalations, blocked units with their own reasons, failed checks, merger notes):
-----
{evidence}
-----

Do this, in order:
1. Work out the root cause from the evidence (read files under {repo} read-only when it helps). Tell the cause
   apart from its symptom: name the agent role whose output caused it (solo agent or lead, solo reviewer, spec
   analyst, readers, test author, planner, builder, merger, deploy) and what it did wrong. When an agent stopped
   BLOCKED, judge the block itself: was what it said is missing really missing (only a person or another system
   can supply it), or could it have chosen a reasonable reading and gone on? Say which.
2. step_context with the cause in plain words: if a finding or lesson already says it, do not repeat it (you
   may say it happened again).
3. record_finding once: a title naming the problem the way a later agent would meet it; text with symptom
   (codes and messages verbatim), cause, fix or prevention, the run id.
4. If the cause is a rule that holds for any project (how to write acceptance tests, how to split units, how
   to word a spec), save_lesson with share true: the title is the rule in one line, addressed to the role that
   must follow it; the text adds 'Why:' in one sentence. Not for one-off accidents (a revoked token, a
   cancelled run). Later agents find these by similarity and see only the title first.
5. End with one line: cause, finding stored, lesson stored (or why not); then SUBMIT."""

_NOISE = ("run.state", "unit.state", "unit.dispatched", "lease", "heartbeat", "budget")


def retro_evidence(store: Any, run: str, limit: int = 12_000) -> str:
    """The failure trail of a run, newest last: escalations, blocked units, failed checks, merger notes."""
    from .contracts import E_ESCALATION
    out: List[str] = []
    for e in store.query(E_ESCALATION, run=run) or []:
        out.append("ESCALATION %s: %s" % (e.get("code"), str(e.get("message") or "")[:400]))
        ed = e.get("detail") or {}
        if ed.get("blocked_kind") or ed.get("blocked_reason"):     # an agent stopped and said why (solo.blocked)
            out.append("BLOCKED (%s), the agent's reason: %s" % (ed.get("blocked_kind") or "?",
                                                                str(ed.get("blocked_reason") or "")[:1500]))
        if ed.get("text"):
            out.append("The agent's last words:\n%s" % str(ed["text"])[-1500:])
    for ev in store.events_after(0, run=run) or []:
        kind = getattr(ev, "kind", "")
        if any(kind.startswith(n) for n in _NOISE):
            continue
        if kind in (codes.UNIT_BLOCKED, codes.VERIFY_FAILED, codes.UNIT_REQUEUED, codes.MERGER_RAN, codes.ESCALATED,
                    codes.RECONCILE_DIVERGED, codes.HOOK_BLOCKED) or "fail" in kind:
            unit = getattr(getattr(ev, "env", None), "unit", "") or ""
            out.append("%s%s %s" % (kind, (" [%s]" % unit) if unit else "",
                                    json.dumps(getattr(ev, "body", {}), default=str)[:900]))
    text = "\n".join(out)
    return text[-limit:] if len(text) > limit else (text or "(no failure events recorded)")


def retro_after_failure(pipe: Any, wait: bool = False) -> Dict[str, Any]:
    """After a run that ended escalated (not cancelled by a person or stopped by a hook): one agentic call
    that records a finding and, for a general rule, a shared lesson. Off with LINE_AGENT_LEARN=0. Never
    raises. wait=True runs it on this thread and returns its outcome."""
    from .contracts import E_ESCALATION, E_RUN
    cfg = getattr(pipe, "cfg", None)
    if os.environ.get("LINE_AGENT_LEARN", "1").strip() == "0" or not enabled(cfg) or not hasattr(pipe, "llm"):
        return {"started": False, "reason": "learning is off"}
    row = pipe.store.get(E_RUN, pipe.run) or {}
    esc = (pipe.store.query(E_ESCALATION, run=pipe.run) or [{}])[-1]
    code = str(esc.get("code") or (row.get("detail") or {}).get("code") or "")
    if code in (codes.CANCELLED, codes.HOOK_STOP):
        return {"started": False, "reason": "%s is a person's decision, nothing to learn" % code}
    home = os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")
    work = os.path.join(home, "retro", pipe.run)
    prompt = RETRO_PROMPT.format(run=pipe.run, project=_project(cfg), state=row.get("state", "escalated"),
                                 code=code or "?", message=str(esc.get("message") or "")[:400],
                                 evidence=retro_evidence(pipe.store, pipe.run), repo=getattr(pipe, "repo", "") or "-")
    result: Dict[str, Any] = {"started": True}

    def go() -> None:
        try:
            os.makedirs(work, exist_ok=True)
            res = pipe.llm.agentic(RETRO_ROLE, work, prompt, 30, 1.0, key="retro", run=pipe.run)
            result.update(outcome=str(getattr(res, "outcome", "") or ""), usd=float(getattr(res, "usd", 0) or 0),
                          summary=str(getattr(res, "text", "") or "")[-1500:])
        except Exception as e:   # noqa: BLE001
            result.update(error=str(e)[:300])
            try:
                pipe.log("%s: retro: %s" % (pipe.run, e))
            except Exception:   # noqa: BLE001
                pass

    if wait:
        go()
    else:
        import threading as _t
        _t.Thread(target=go, name="line-retro-%s" % pipe.run, daemon=True).start()
    return result


__all__ = ["TOOLS", "KERNEL", "enabled", "turn_context", "handle", "write", "call_worklog", "wrote_own",
           "distil_after_run", "consented", "DISTIL_ROLE", "retro_after_failure", "retro_evidence", "RETRO_ROLE"]
