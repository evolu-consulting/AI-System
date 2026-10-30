"""The gated flow: runs a PROCESS DEFINITION (line.process; the seed is the design of docs/flow-enhance_bugfix.html
from step 4 on) on the solo lane. This module holds no step, role, prompt, gate name, decision or business rule of
its own: they all come from the definition the run froze at its start (detail.gated.process). AI agents do the
work; people (1) supply what the agents need, (2) decide at gates, (3) handle real exceptions, (4) teach the system
through their decisions. The module keeps the rails:

  needs         at the START (the design phase), every need of the process and its steps is checked; a missing
                "block" need parks the run at the "needs" gate for its owner role, a missing "warn" need is told
                to every agent; nothing is asked of people in the middle of execution
  draft step    the step's agents write their artifacts (in parallel, read-only checkout of main), the step's
                checks run (a "block" finding sends the artifact back to its agent, Definition.retries times),
                then the gate: an auto-approve check (precedents of THIS project + the business's criteria) may
                pass it, otherwise the run parks until a person (one of gate.approvers) decides; a revise redoes the
                artifacts its target names, or with gate.routes goes back to an earlier draft step
  build step    the build agent implements the approved work in up to Config.gate_rounds rounds (suite in the
                worktree, clean QAS export, suite there); the approved artifacts and the item index join the change
  review step   findings, the step's checks on the change, actual against target per step, then the gate; a
                decision in gate.deliver delivers
Every person's decision becomes a precedent of the run's project (line.process.precedent); a run that stops names
the role that handles it (the step's incident role, else the process owner) and the supervisor.

    enabled(pipe) / run(pipe) / view(store, run) / decide(store, cfg, run, gate, body, actor, roles)
    adopt(store, cfg, run, ref, actor)   move a run parked at a gate to another version of its process
"""

from __future__ import annotations

import base64
import concurrent.futures as cf
import os
import re
import shutil
from typing import Any, Dict, List, Optional

from . import changequeue as Q
from . import codes
from . import decisions as DL
from .contracts import E_RUN, RunState, now_ms
from .process import artifacts as A
from .process import brief as BR
from .process import checks as C
from .process import definition as D
from .process import metrics as M
from .process import needs as N
from .process import precedent as P
from .process import trace as T
from .ship._util import git, git_out, tail
from .statemachine import update_row

# upload rails (not process rules): what a person may attach to a decision
MAX_NOTE = 20_000
MAX_FILES = 10
MAX_FILE_BYTES = 40 * 1024 * 1024
TEXT_FILES = (".md", ".markdown", ".txt", ".csv", ".json", ".xml", ".yml", ".yaml", ".html", ".htm", ".log")
GATE_DIR = "gate"                  # the person's additions, in the run's pack folder
MAX_REQUEST = 40_000
LEGACY = "gated-change"             # the definition a run gated before definitions existed is read with
NEEDS = "needs"                     # the gate that holds a run whose needs are missing (rails, not a process gate)


class _Rewind(Exception):
    def __init__(self, step: str):
        super().__init__(step)
        self.step = step


# ------------------------------------------------------------------ the run's definition

def flow_of(detail: Dict[str, Any]) -> str:
    return str(detail.get("flow") or "").strip().lower()


def _detail(store: Any, run: str) -> Dict[str, Any]:
    return dict((store.get(E_RUN, run) or {}).get("detail") or {})


def state(pipe: Any) -> Dict[str, Any]:
    return dict(_detail(pipe.store, pipe.run).get("gated") or {})


def _save(pipe: Any, **kv: Any) -> Dict[str, Any]:
    cur = state(pipe)
    cur.update(kv)
    pipe._set_detail(gated=cur)
    return cur


def _resolved_of(detail: Dict[str, Any]) -> D.Resolved:
    """The definition a run froze; a run gated before definitions existed gets the seed for its flow."""
    snap = (detail.get("gated") or {}).get("process")
    if snap:
        return D.frozen(snap)
    # gated by an engine older than definitions: that engine ran exactly the seed's flow
    return D.select(None, "", flow_of(detail), {"process": LEGACY})


def _resolved(pipe: Any) -> D.Resolved:
    return _resolved_of(_detail(pipe.store, pipe.run))


def enabled(pipe: Any) -> bool:
    detail = _detail(pipe.store, pipe.run)
    if (detail.get("gated") or {}).get("on"):
        return True                       # once gated, a resume stays gated whatever the settings say now
    if str(detail.get("gates") or "").lower() in ("0", "false", "off", "no"):
        return False
    mode = str(getattr(pipe.cfg, "gates", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    try:
        return D.select(pipe.cfg, pipe.repo, flow_of(detail), detail, store=pipe.store) is not None
    except ValueError:
        return True                       # a definition applies but cannot run: run() says why


def _metric(pipe: Any, step: str, **counts: Any) -> None:
    _save(pipe, metrics=M.add(state(pipe).get("metrics") or {}, step, **counts))


def _step_of_gate(r: D.Resolved, gate: str) -> str:
    return NEEDS if gate == NEEDS else str((r.gate(gate) or {}).get("_step") or gate)


def _epoch(st: Dict[str, Any], gate: str) -> int:
    return int((st.get("epochs") or {}).get(gate, 0))


# ------------------------------------------------------------------ the read-only planning checkout

def _checkout(pipe: Any) -> str:
    wt = os.path.join(pipe.workdir, "gate-read")
    with Q.repo_lock(pipe.repo):                   # runs of one project share the repository's worktree list
        git(pipe.repo, "worktree", "prune", check=False)
        if os.path.isdir(wt):
            git(pipe.repo, "worktree", "remove", "--force", wt, check=False)
            shutil.rmtree(wt, ignore_errors=True)
        git(pipe.repo, "worktree", "add", "-q", "--detach", wt, "main")
    return wt


def _drop_checkout(pipe: Any, wt: str) -> None:
    with Q.repo_lock(pipe.repo):
        git(pipe.repo, "worktree", "remove", "--force", wt, check=False)
    shutil.rmtree(wt, ignore_errors=True)


def _look(pipe: Any) -> str:
    from . import codegraph
    return "code_graph first, then Glob / Grep / Read" if codegraph.summary(pipe.cfg, pipe.run, top=1) else \
        "Glob / Grep / Read"


def _agent(pipe: Any, step: str, role: str, wt: str, prompt: str, key: str, art: Dict[str, Any],
           spec: Dict[str, Any]) -> Dict[str, Any]:
    from .pipeline import Escalate
    cfg = pipe.cfg
    t0 = now_ms()
    try:
        res = pipe.llm.agentic(role, wt, prompt, int(spec.get("max_turns") or getattr(cfg, "gate_plan_turns", 60) or 60),
                               float(spec.get("usd") or getattr(cfg, "gate_plan_usd", 1.5) or 1.5), key=key,
                               run=pipe.run)
    finally:
        pipe._charge_stage()
    outcome = str(getattr(res, "outcome", "") or "")
    text = str(getattr(res, "text", "") or "")
    usd = round(float(getattr(res, "usd", 0) or 0), 4)
    if outcome.startswith("BLOCKED") or not text.strip():
        from .solo import blocked
        kind, why = blocked(outcome, text)
        raise Escalate(codes.NO_PROGRESS, "the %s stopped (%s): %s" % (role, kind, why[:300] or outcome),
                       {"lane": "gated", "role": role, "blocked_kind": kind, "blocked_reason": why[:2000],
                        "text": tail(text, 2000)})
    return {"doc": A.document(text, art), "usd": usd, "ms": now_ms(), "work_ms": now_ms() - t0}


# ------------------------------------------------------------------ the person's additions

def _target_parts(gate: Dict[str, Any], d: Dict[str, Any], every: List[str]) -> List[str]:
    targets = gate.get("targets") or {}
    t = str(d.get("target") or "")
    return list(targets.get(t) or every) if (t and targets) else list(every)


def _additions(pipe: Any, r: D.Resolved, gate: str, artifact: str = "") -> str:
    """What people added for the agent that works on `artifact` at `gate`'s step (notes and files), newest last:
    the gate's own send-backs, and send-backs of later gates that routed the work back to this step."""
    g = r.gate(gate) or {}
    step = g.get("_step")
    order = [s["gate"]["name"] for s in r.steps() if s.get("gate")]
    earlier = set(order[:order.index(gate)]) if gate in order else set()
    out: List[str] = []
    for d in state(pipe).get("log") or []:
        mine = d.get("gate") == gate and d.get("decision") in (g.get("revise") or [])
        routed = bool(step) and d.get("route_to") == step
        dg = r.gate(str(d.get("gate") or "")) or {}
        # a person who approves an earlier gate with a note sets conditions every later step must follow
        settled = d.get("gate") in earlier and d.get("decision") in (dg.get("pass") or []) and bool(d.get("note"))
        if not (mine or routed or settled) or d.get("auto"):
            continue
        if mine and artifact and artifact not in _target_parts(g, d, [artifact]):
            continue
        if settled:
            out.append("A PERSON APPROVED gate %s WITH THESE CONDITIONS (follow them):\n%s" % (d.get("gate"), d.get("note")))
            continue
        out.append("FROM A PERSON (gate %s, round %s):\n%s" % (d.get("gate"), d.get("round"), d.get("note") or "(no note)"))
        for f in d.get("files") or []:
            out.append("  attached: %s (markdown text of %s; Read it)" % (f.get("path"), f.get("name")))
    return ("\n".join(out) + "\n") if out else ""


def _all_additions(pipe: Any, r: D.Resolved) -> str:
    """Every person's send-back and every approval note of the draft gates, once each, for the build."""
    out: List[str] = []
    for d in state(pipe).get("log") or []:
        g = r.gate(str(d.get("gate") or "")) or {}
        step = next((s for s in r.steps() if s.get("gate", {}).get("name") == d.get("gate")), {})
        if d.get("auto") or step.get("kind") != "draft" or not (d.get("note") or d.get("files")):
            continue
        kind = "APPROVED WITH CONDITIONS" if d.get("decision") in (g.get("pass") or []) else "SENT BACK"
        out.append("FROM A PERSON (gate %s, %s):\n%s" % (d.get("gate"), kind, d.get("note") or "(files only)"))
        for f in d.get("files") or []:
            out.append("  attached: %s (markdown text of %s; Read it)" % (f.get("path"), f.get("name")))
    return ("\n".join(out) + "\n") if out else ""


def _gate_notes(pipe: Any, r: D.Resolved) -> List[Dict[str, Any]]:
    """The notes people decided the draft gates with, oldest first: {"gate", "by", "note", "pass", "artifacts"}.
    A pass note sets conditions that settle questions of the artifacts it approved (its target's, or the step's)."""
    out: List[Dict[str, Any]] = []
    for d in state(pipe).get("log") or []:
        step = next((s for s in r.steps() if s.get("gate", {}).get("name") == d.get("gate")), {})
        if d.get("auto") or step.get("kind") != "draft" or not str(d.get("note") or "").strip():
            continue
        g = r.gate(str(d.get("gate"))) or {}
        every = [a["artifact"] for a in step.get("agents") or []]
        out.append({"gate": d.get("gate"), "by": d.get("by") or "", "note": str(d["note"]).strip(),
                    "pass": d.get("decision") in (g.get("pass") or []), "artifacts": _target_parts(g, d, every)})
    return out


def _settled_for(notes: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """{artifact: ["gate <g>, approved by <who>: <note>"]} from the pass notes, for the living spec."""
    out: Dict[str, List[str]] = {}
    for n in notes:
        if n["pass"]:
            for a in n["artifacts"]:
                out.setdefault(a, []).append("gate %s, approved by %s: %s" % (n["gate"], n["by"] or "-", n["note"]))
    return out


_WORD = re.compile(r"[^\W_]{3,}")
_REF = re.compile(r"\b[A-Z]{1,4}-?\d+\b")
_COMMON = frozenset("the and for with that this not are was were has have from into its use used uses all any "
                    "but can may must should will per via one two then than also only same each when what".split())


def _words(text: str) -> set:
    return {w for w in _WORD.findall(text.lower()) if w not in _COMMON}


#: an agent saying it followed a person's gate note ("as the spec approver required", "the plan approver asked")
_CITES_PERSON = re.compile(r"\b(approver|approved|the person|gate note|as (?:required|asked|agreed))\b", re.I)
MATCH_WORDS = 8          # a long decision is settled by a note holding half of up to this many of its words


def settled_at(text: str, notes: List[Dict[str, Any]]) -> str:
    """The gate whose person's note already settles `text` (an agent's decision or question), or "": they share an
    item reference (F2, Q3, TC-4) and a word; or the note holds half the decision's words (at most MATCH_WORDS
    counted, so a long decision is not held to a long list); or the decision cites the approver and shares two
    words with the note (run R20261025-153358-b293: 'I copied them from @fontsource ... as the spec approver
    required' was listed as 'needs a person')."""
    words, refs = _words(text), set(_REF.findall(text))
    cites = bool(_CITES_PERSON.search(text))
    low = text.lower()
    best, rank = "", (-1, -1)
    for n in notes:
        shared = words & _words(n["note"])
        if (refs & set(_REF.findall(n["note"])) and shared) or (words and 2 * len(shared) >= min(len(words), MATCH_WORDS)) \
                or (cites and len(shared) >= 2):
            r = (int(str(n["gate"]).lower() in low), len(shared))   # the gate it names, then the closest note
            if r > rank:
                best, rank = str(n["gate"]), r
    return best


def _spec_text(pipe: Any) -> str:
    with open(os.path.join(pipe.pack, "spec.md"), encoding="utf-8") as fh:
        return fh.read()


def _docs(r: D.Resolved, st: Dict[str, Any]) -> Dict[str, str]:
    return {a: str((st.get(a) or {}).get("doc") or "") for a in (r.data.get("artifacts") or {})}


def _values(pipe: Any, r: D.Resolved, wt: str) -> Dict[str, Any]:
    """What a prompt may name: the request, the run, the checkout, missing needs, every artifact and its fields."""
    from .solo import _tests_in
    st = state(pipe)
    v: Dict[str, Any] = {"request": _spec_text(pipe)[:MAX_REQUEST], "flow": flow_of(_detail(pipe.store, pipe.run))
                         or "change", "run": pipe.run, "wt": wt, "look": _look(pipe) if wt else "",
                         "tests_in_repo": _tests_in(wt) if wt else "", "drift": T.drift_text(st.get("drift") or []),
                         "needs_missing": N.missing_text((st.get("needs") or {}).get("rows") or [])}
    queue = Q.text(pipe.store, str(_detail(pipe.store, pipe.run).get("project") or ""), pipe.run)
    v["queue"] = queue + "\n" if queue else ""
    for name, doc in _docs(r, st).items():
        v[name] = doc
        for k, val in A.fields(doc, r.artifact(name)).items():
            v["%s_%s" % (name, k)] = val
    return v


# ------------------------------------------------------------------ the gates

def _needs_gate(r: D.Resolved, st: Dict[str, Any]) -> Dict[str, Any]:
    """The rails gate that holds a run whose needs are missing: its owners supply them, then a re-check."""
    rows = (st.get("needs") or {}).get("rows") or []
    miss = [x for x in rows if not x.get("ok")]
    owners = sorted({x["owner"] for x in miss})
    return {"name": NEEDS, "step": "needs", "title": "Supply what the agents need before they start",
            "board": "understand", "decisions": ["supply", "recheck"], "pass": ["recheck"], "revise": ["supply"],
            "targets": {x["id"]: [] for x in miss}, "target_labels": {x["id"]: x["what"] for x in miss},
            "default_target": miss[0]["id"] if miss else "", "show": ["@needs"], "approvers": [],
            "decision_labels": {"supply": "Supply this need", "recheck": "Check again"},
            "note_label": "Paste the information (or attach the documents) for the need chosen below",
            "note_placeholder": "Owners: %s" % ", ".join(owners), "_step": "needs"}


def _gate_def(r: D.Resolved, st: Dict[str, Any], gate: str) -> Dict[str, Any]:
    return _needs_gate(r, st) if gate == NEEDS else dict(r.gate(gate) or {})


def _open(pipe: Any, r: D.Resolved, gate: str) -> None:
    """Park the run at `gate` (or keep it parked): detail.gate, the board, gate.opened once per round."""
    from .pipeline import Parked
    st = state(pipe)
    g = _gate_def(r, st, gate)
    rnd = int((st.get("rounds") or {}).get(gate, 0)) + 1
    detail = _detail(pipe.store, pipe.run)
    if (detail.get("gate") or {}).get("name") != gate:
        detail["gate"] = {"name": gate, "round": rnd, "step": g.get("step"), "ms": now_ms()}
        update_row(pipe.store, E_RUN, pipe.run, {"detail": detail})
        try:
            pipe.sm.em.run_event(pipe.run, codes.GATE_OPENED, {"gate": gate, "round": rnd})
        except Exception:   # noqa: BLE001 - the event is a record; the gate holds without it
            pass
    pipe._board(str(g.get("board") or g.get("_step") or gate), "waiting for a person",
                "step %s: %s" % (g.get("step") or gate, g.get("title") or gate))
    raise Parked("gate %s: waiting for a person (step %s)" % (gate, g.get("step") or gate))


def _taken(pipe: Any, r: D.Resolved, gate: str) -> Optional[Dict[str, Any]]:
    """The decision taken at the gate's current round, consumed once (pending -> log), counted, and a person's
    decision mirrored into the project's knowledge store."""
    st = state(pipe)
    pend = dict(st.get("pending") or {})
    d = pend.pop(gate, None)
    if d is None:
        return None
    d = dict(d, epoch=_epoch(st, gate))
    rounds = dict(st.get("rounds") or {})
    rounds[gate] = int(rounds.get(gate, 0)) + 1
    opened = int((_detail(pipe.store, pipe.run).get("gate") or {}).get("ms") or 0)
    _save(pipe, pending=pend, rounds=rounds, log=list(st.get("log") or []) + [d])
    g = _gate_def(r, st, gate)
    _metric(pipe, _step_of_gate(r, gate), human_decisions=1,
            revisions=1 if d.get("decision") in (g.get("revise") or []) else 0,
            wait_ms=max(int(d.get("ms") or now_ms()) - opened, 0) if opened else 0)
    if gate != NEEDS:
        try:                                   # what people decide is knowledge of THIS project
            pipe.rag.write_worklog("gate decision %s" % gate, "%s decided %s at %s (run %s, process %s): %s" % (
                d.get("by"), d.get("decision"), g.get("title") or gate, pipe.run, r.ref(), d.get("note") or "-"),
                idem_key="gate:%s:%s:%s" % (pipe.run, gate, rounds[gate]))
        except Exception:   # noqa: BLE001 - the engine store keeps the precedent anyway
            pass
    return d


def _approved(pipe: Any, r: D.Resolved, gate: str) -> bool:
    st = state(pipe)
    passing = set(_gate_def(r, st, gate).get("pass") or [])
    ep = _epoch(st, gate)
    return any(d.get("gate") == gate and d.get("decision") in passing and int(d.get("epoch", 0)) == ep
               for d in st.get("log") or [])


def _close_gate(pipe: Any) -> None:
    detail = _detail(pipe.store, pipe.run)
    if detail.pop("gate", None) is not None:
        update_row(pipe.store, E_RUN, pipe.run, {"detail": detail})


def _try_auto(pipe: Any, r: D.Resolved, g: Dict[str, Any], docs: Dict[str, str]) -> bool:
    """The gate's auto-approve check, once per round. True when it decided (logged, never a precedent)."""
    if not g.get("auto"):
        return False
    st = state(pipe)
    gate = g["name"]
    if any(not d.get("auto") and (d.get("gate") == gate and d.get("decision") in (g.get("revise") or [])
                                  or d.get("route_to") == g.get("_step")) for d in st.get("log") or []):
        return False                       # a person sent this work back in this run: that person looks again
    rnd = int((st.get("rounds") or {}).get(gate, 0))
    tried = dict(st.get("auto_tried") or {})
    if tried.get(gate) == "%d.%d" % (_epoch(st, gate), rnd):
        return False
    tried[gate] = "%d.%d" % (_epoch(st, gate), rnd)
    _save(pipe, auto_tried=tried)
    shown = "\n\n".join("## %s\n%s" % (r.artifact(n).get("title") or n, docs.get(n, ""))
                        for n in g.get("show") or [] if n in docs)
    res = P.auto(pipe, r, g, shown, _spec_text(pipe))
    if not res:
        return False
    st = state(pipe)
    rounds = dict(st.get("rounds") or {})
    rounds[gate] = rnd + 1
    d = {"gate": gate, "round": rnd + 1, "decision": res["decision"], "note": "auto-approved: " + res["reason"],
         "files": [], "by": "auto", "auto": True, "precedents": res["precedents"], "ms": now_ms(),
         "epoch": _epoch(st, gate)}
    _save(pipe, rounds=rounds, log=list(st.get("log") or []) + [d])
    DL.record(pipe.pack, DL.entry(pipe.run, r, g, d, state(pipe), pipe.pack, auto=True))   # on disk, never a signal
    _metric(pipe, g.get("_step") or gate, auto_decisions=1, agent_usd=res.get("usd", 0.0))
    try:
        pipe.sm.em.run_event(pipe.run, codes.GATE_DECIDED, {"gate": gate, "decision": res["decision"], "by": "auto",
                                                            "auto": True, "precedents": res["precedents"]})
    except Exception:   # noqa: BLE001
        pass
    return True


def _route(pipe: Any, r: D.Resolved, step: Dict[str, Any], d: Dict[str, Any]) -> None:
    """A revise decision with gate.routes[decision].back_to: the work goes back to that earlier draft step; every
    gate from there to here must pass again and every artifact from there to here is written again."""
    to = ((step["gate"].get("routes") or {}).get(d.get("decision")) or {}).get("back_to")
    if not to:
        return
    ids = [s["id"] for s in r.steps()]
    span = r.steps()[ids.index(to):ids.index(step["id"]) + 1]
    st = state(pipe)
    epochs = dict(st.get("epochs") or {})
    reset = {}
    for s in span:
        if s.get("gate"):
            epochs[s["gate"]["name"]] = int(epochs.get(s["gate"]["name"], 0)) + 1
        for a in s.get("agents") or []:
            reset[a["artifact"] + "_round"] = -1
    log = list(st.get("log") or [])
    log[-1] = dict(log[-1], route_to=to)
    _save(pipe, epochs=epochs, log=log, **reset)
    raise _Rewind(to)


# ------------------------------------------------------------------ checks

def _rules_reader(pipe: Any) -> Any:
    def read(path: str) -> str:
        cp = git(pipe.repo, "show", "main:%s" % path.strip("/\\"), check=False)
        return cp.stdout if cp.returncode == 0 else ""
    return read


def _run_checks(pipe: Any, r: D.Resolved, step: Dict[str, Any], docs: Dict[str, str], wt: str = "",
                diff: str = "", only: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    gate = (step.get("gate") or {}).get("name") or step["id"]
    ctx = C.Ctx(r, docs, pipe=pipe, wt=wt, diff=diff, gate=gate, rules_reader=_rules_reader(pipe))
    out: List[Dict[str, Any]] = []
    for c in step.get("checks") or []:
        arts = [c.get("artifact")] + list(c.get("to") or [])
        if only is not None and not any(a in only for a in arts if a):
            continue
        try:
            out += C.run(c, ctx)
        except ValueError as e:
            out.append({"check": c.get("check"), "severity": "warn", "artifact": c.get("artifact") or "",
                        "text": "check could not run: %s" % e})
    return out


def _checks_text(rows: List[Dict[str, Any]]) -> str:
    return "\n".join("- [%s, %s] %s: %s" % (f["severity"], f["check"], f.get("artifact") or "-", f["text"])
                     for f in rows)


# ------------------------------------------------------------------ needs (the start of a run)

def _needs(pipe: Any, r: D.Resolved) -> None:
    """Check every need now, at the start: a missing "block" need holds the run at the needs gate until its owner
    supplies it (or a re-check finds it); "warn" needs only go to the agents' prompts."""
    flow = flow_of(_detail(pipe.store, pipe.run))
    if not N.collect(r, flow):
        return
    st = state(pipe)
    parked_here = (_detail(pipe.store, pipe.run).get("gate") or {}).get("name") == NEEDS
    if st.get("needs") and not parked_here and not N.blocking(st["needs"].get("rows") or []):
        return                            # checked once at the start; a resume later in the run does not ask again
    while True:
        rows = N.check(r, pipe, flow)
        _save(pipe, needs={"rows": rows, "ms": now_ms()})
        if not N.blocking(rows):
            if (_detail(pipe.store, pipe.run).get("gate") or {}).get("name") == NEEDS:
                _close_gate(pipe)
            if parked_here or any(not x["ok"] for x in rows):
                miss = [x["id"] for x in rows if not x["ok"]]
                pipe._board("understand", "needs checked", "every blocking need is there" +
                            ("; not supplied (agents are told): %s" % ", ".join(miss) if miss else ""))
            return
        d = _taken(pipe, r, NEEDS)
        if d is None:
            _open(pipe, r, NEEDS)
        _close_gate(pipe)


# ------------------------------------------------------------------ draft steps

def _draft(pipe: Any, r: D.Resolved, step: Dict[str, Any]) -> None:
    """The step's agents write their artifacts, the checks run, then the gate (auto-approve or a person); a revise
    sends back the artifacts its target names, or routes back to an earlier step."""
    from .solo import _forward
    from . import outcomes
    g = dict(step["gate"], _step=step["id"])
    gate = g["name"]
    agents = list(step["agents"])
    every = [a["artifact"] for a in agents]
    retries = int(r.data.get("retries", 1) or 0)
    while not _approved(pipe, r, gate):
        Q.check_mine(pipe)                         # a later run ignored this run's slot: stop, change nothing
        st = state(pipe)
        rnd = int((st.get("rounds") or {}).get(gate, 0))
        last = next((d for d in reversed(st.get("log") or []) if d.get("gate") == gate
                     and int(d.get("epoch", 0)) == _epoch(st, gate)), None)
        redo = set(every) if last is None else set(_target_parts(g, last, every))
        todo = [a for a in agents if int(st.get(a["artifact"] + "_round", -1)) != rnd
                and (a["artifact"] in redo or not st.get(a["artifact"]) or int(st.get(a["artifact"] + "_round", 0)) < 0)]
        stale = [] if todo or (st.get("pending") or {}).get(gate) else _stale(pipe, agents, st)
        if stale:                                  # an earlier run of the project pushed approved work since
            _refresh(pipe, r, step, gate, stale, rnd, st)
            continue
        if todo:
            if step.get("state"):
                _forward(pipe, RunState(step["state"]))
            b = step.get("board") or {}
            pipe._board(str(b.get("stage") or step["id"]), str(b.get("who") or step["id"]), str(b.get("text") or ""))
            if "drift" not in st:
                index_dir = str(((r.step("build") or {}).get("persist") or {}).get("dir") or "")
                st = _save(pipe, drift=T.drift(pipe.repo, "main", index_dir) if index_dir else [])
            wt = _checkout(pipe)
            fp = Q.fingerprint(pipe.store, pipe.run)   # the queue this draft is written on
            try:
                done = _write(pipe, r, step, gate, todo, wt, rnd, {})
                docs = dict(_docs(r, st), **{k: v["doc"] for k, v in done.items()})
                found = _run_checks(pipe, r, step, docs, wt, only=list(done))
                for attempt in range(1, retries + 1):
                    back = sorted({f["artifact"] for f in found if f["severity"] == "block" and f["artifact"] in done})
                    if not back:
                        break
                    fb = {a: C.render(r.prompt("check_feedback"), {"attempt": attempt, "findings": _checks_text(
                        [f for f in found if f["artifact"] == a])}) for a in back}
                    again = _write(pipe, r, step, gate, [x for x in todo if x["artifact"] in back], wt, rnd, fb,
                                   suffix=".%d" % attempt)
                    done.update(again)
                    docs.update({k: v["doc"] for k, v in again.items()})
                    found = _run_checks(pipe, r, step, docs, wt, only=list(done))
            finally:
                _drop_checkout(pipe, wt)
            checks = dict(state(pipe).get("checks") or {})
            checks[gate] = found
            _save(pipe, checks=checks, **{k: dict(v, queue_fp=fp) for k, v in done.items()},
                  **{k + "_round": rnd for k in done})
            for a in todo:
                if a.get("record_drafts"):
                    outcomes.record(pipe.store, pipe.run, a["role"], drafts=rnd + 1)
            _metric(pipe, step["id"], drafts=1)
        if _try_auto(pipe, r, g, _docs(r, state(pipe))):
            continue
        d = _taken(pipe, r, gate)
        if d is None:
            _open(pipe, r, gate)
        _close_gate(pipe)
        pipe._board(str(g.get("board") or g.get("_step") or gate), "%s by %s" % (d.get("decision"), d.get("by") or "-"),
                    "step %s: %s" % (g.get("step") or gate, g.get("title") or gate))   # the card no longer waits
        if d.get("decision") in (g.get("revise") or []):
            log = state(pipe).get("log") or []
            for a in agents:
                if a["artifact"] in _target_parts(g, d, every):
                    outcomes.record(pipe.store, pipe.run, a["role"], revised_by_person=[
                        str(x.get("note") or "")[:300] for x in log if x.get("gate") == gate and not x.get("auto")
                        and x.get("decision") in (g.get("revise") or [])
                        and a["artifact"] in _target_parts(g, x, every)])
            _route(pipe, r, step, d)
    Q.check_mine(pipe)
    Q.push(pipe, step["id"], {a["artifact"]: str((state(pipe).get(a["artifact"]) or {}).get("doc") or "")
                              for a in agents})


def _stale(pipe: Any, agents: List[Dict[str, Any]], st: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The step's agents whose draft was written on a queue that has changed since (the process's queue policy:
    refresh_drafts). A draft written before queue fingerprints existed counts as fresh."""
    if not Q.policy(pipe.cfg, pipe.store, pipe.run).get("refresh_drafts"):
        return []
    fp = Q.fingerprint(pipe.store, pipe.run)
    return [a for a in agents if isinstance(st.get(a["artifact"]), dict)
            and str(st[a["artifact"]].get("queue_fp", fp)) != fp]


def _refresh(pipe: Any, r: D.Resolved, step: Dict[str, Any], gate: str, stale: List[Dict[str, Any]], rnd: int,
             st: Dict[str, Any]) -> None:
    """The change queue moved while the draft waited at its gate: the gate closes, the agents write the draft
    again on top of the queue as it is now (their earlier draft and what changed in the prompt), the checks run,
    and the loop opens the gate again for the same round."""
    _close_gate(pipe)
    n = int((st.get("refreshes") or {}).get(gate, 0)) + 1
    b = step.get("board") or {}
    pipe._board(str(b.get("stage") or step["id"]), str(b.get("who") or step["id"]),
                "the change queue changed: writing the draft again on top of it")
    took = {}
    fb = {}
    for a in stale:
        old = dict(st.get(a["artifact"]) or {})
        took.update({s["id"]: {"seq": int(s.get("seq") or 0), "run": s.get("run"),
                               "gone": s.get("state") in ("dropped", "ignored"),
                               "pushed": sorted((s.get("pushed") or {}).keys())}
                     for s in Q.changed_since(pipe.store, pipe.run, str(old.get("queue_fp") or ""))})
        fb[a["artifact"]] = (Q.refresh_text(pipe.store, pipe.run, str(old.get("queue_fp") or ""))
                             + "\nYOUR EARLIER DRAFT:\n-----\n%s\n-----\n" % str(old.get("doc") or ""))
    wt = _checkout(pipe)
    fp = Q.fingerprint(pipe.store, pipe.run)
    try:
        done = _write(pipe, r, step, gate, stale, wt, rnd, fb, suffix=".q%d" % n)
        docs = dict(_docs(r, st), **{k: v["doc"] for k, v in done.items()})
        found = _run_checks(pipe, r, step, docs, wt, only=list(done))
    finally:
        _drop_checkout(pipe, wt)
    checks = dict(state(pipe).get("checks") or {})
    checks[gate] = found
    refreshes = dict(st.get("refreshes") or {}, **{gate: n})
    log = list(st.get("refresh_log") or []) + [{"gate": gate, "n": n, "round": rnd, "ms": now_ms(),
                                                "artifacts": sorted(done), "took": sorted(took.values(),
                                                                                          key=lambda x: x["seq"])}]
    _save(pipe, checks=checks, refreshes=refreshes, refresh_log=log[-20:],
          **{k: dict(v, queue_fp=fp) for k, v in done.items()}, **{k + "_round": rnd for k in done})
    _metric(pipe, step["id"], drafts=1, queue_refreshes=1)
    pipe.log("%s: gate %s: drafts %s written again on top of the change queue (%s)"
             % (pipe.run, gate, ", ".join(sorted(done)), ", ".join("#%d" % t["seq"] for t in took.values())))


def _write(pipe: Any, r: D.Resolved, step: Dict[str, Any], gate: str, agents: List[Dict[str, Any]], wt: str,
           rnd: int, feedback: Dict[str, str], suffix: str = "") -> Dict[str, Dict[str, Any]]:
    """Run the agents in parallel. -> {artifact: {"doc", "usd", "ms", "work_ms"}}"""
    base = _values(pipe, r, wt)
    jobs = {}
    with cf.ThreadPoolExecutor(max_workers=max(len(agents), 1), thread_name_prefix="gate-agents") as ex:
        for a in agents:
            name = a["artifact"]
            prompt = C.render(r.prompt(a["prompt"]), dict(base, additions=_additions(pipe, r, gate, name)))
            prompt += feedback.get(name, "")
            ep = _epoch(state(pipe), gate)
            key = "gate-%s#%d%s%s" % (name, rnd, (".e%d" % ep) if ep else "", suffix)
            jobs[name] = ex.submit(_agent, pipe, step["id"], a["role"], wt, prompt, key, r.artifact(name), a)
        done = {k: f.result() for k, f in jobs.items()}
    _metric(pipe, step["id"], agent_calls=len(done), agent_usd=round(sum(v["usd"] for v in done.values()), 4),
            work_ms=max((v.get("work_ms", 0) for v in done.values()), default=0))
    return done


def brief(pipe: Any) -> str:
    """The approved work, added to the build agent's prompt."""
    r = _resolved(pipe)
    step = r.step("build") or {}
    text = C.render(r.prompt(step["brief"]), _values(pipe, r, "")) if step.get("brief") else ""
    adds = _all_additions(pipe, r)
    return text + ("\nNotes a person gave at the gates:\n" + adds if adds else "")


# ------------------------------------------------------------------ the build step

def _earlier(pipe: Any) -> Dict[str, Any]:
    """The build rounds of earlier attempts of a run retried in place (line.reopen), kept with the new rounds."""
    e = (state(pipe).get("build") or {}).get("earlier")
    return {"earlier": e} if e else {}


def _build(pipe: Any, r: D.Resolved, step: Dict[str, Any]) -> str:
    """Up to Config.gate_rounds rounds: the agent implements in one worktree, the suite runs there, the approved
    artifacts and the item index join the change, the commit goes to a clean QAS export and the suite runs again;
    red anywhere -> the next round with the output. -> the green commit on the solo branch. Raises Escalate (stop
    at once, a person decides) after the last round."""
    from .pipeline import Escalate, QAS_DIR
    from .ship.deploy import Deployer
    from . import solo
    cfg = pipe.cfg
    sid = step["id"]
    rounds = max(int(step.get("rounds") or getattr(cfg, "gate_rounds", 3) or 3), 1)
    st = state(pipe)
    done = list((st.get("build") or {}).get("rounds") or [])
    if len(done) >= rounds:
        raise Escalate(codes.NO_PROGRESS, "the gated flow used its %d rounds" % rounds, {"lane": "gated"})
    wt = solo._worktree(pipe)                       # a resume starts the remaining rounds from main
    base = git_out(pipe.repo, "rev-parse", "main")
    prompt = solo._prompt(pipe, wt, _spec_text(pipe), flow_of(_detail(pipe.store, pipe.run))) + brief(pipe)
    level = 3
    try:
        from .understand.sizer import level_of
        level = level_of(pipe)
    except Exception:   # noqa: BLE001
        pass
    role = str(step.get("role") or (solo.LEAD_ROLE if level >= 3 else solo.ROLE))
    if role == solo.LEAD_ROLE:
        prompt += solo.LEAD
    turns = int(getattr(cfg, "solo_max_turns", 120) or 120)
    cap = float(getattr(cfg, "solo_max_usd", 4.0) or 4.0)
    feedback = ""
    round_tpl = r.prompt(step["round"]) if step.get("round") else "\n\nROUND {n} OF {rounds} FAILED: {what}\n{output}\n"
    deployer = Deployer(pipe.sstore, pipe.repo, cfg, qas_root=os.path.join(pipe.workdir, QAS_DIR),
                        smoke_cmd=pipe.smoke_cmd or solo.suite_argv())

    def again(n: int, what: str, output: str) -> str:
        return C.render(round_tpl, {"n": n + 1, "rounds": rounds, "what": what, "output": output})

    for n in range(len(done), rounds):
        pipe._check_cancel()
        solo._forward(pipe, RunState.BUILDING)
        pipe._board("build", "round %d of %d" % (n + 1, rounds), "the build agent implements the approved work")
        t0 = now_ms()
        try:
            res = pipe.llm.agentic(role, wt, prompt + feedback, turns, cap, key="gated#%d" % n, run=pipe.run)
        finally:
            pipe._charge_stage()
        outcome = str(getattr(res, "outcome", "") or "")
        text = str(getattr(res, "text", "") or "")
        rec: Dict[str, Any] = {"n": n + 1, "outcome": outcome[:200], "usd": round(float(getattr(res, "usd", 0) or 0), 4),
                               "ms": now_ms() - t0}
        decided = solo.decisions(text)
        _metric(pipe, sid, rounds=1, agent_calls=1, agent_usd=rec["usd"], work_ms=rec["ms"])
        if decided:
            solo._save(pipe, decisions=decided)
            _save(pipe, outside_plan=sorted(set(state(pipe).get("outside_plan") or []) | set(decided)))
        if outcome.startswith("BLOCKED") and "max_turns" not in outcome and "budget" not in outcome:
            kind, why = solo.blocked(outcome, text)
            if kind in solo.BLOCK_KINDS[:3]:        # spec / unsafe / access: only a person can settle it
                rec["blocked"] = {"kind": kind, "reason": why[:600]}
                done.append(rec)
                _save(pipe, build={**_earlier(pipe), "rounds": done})
                _metric(pipe, sid, mid_run_stops=1)
                raise Escalate(codes.NO_PROGRESS, "the build agent stopped (%s): %s" % (kind, why[:300]),
                               {"lane": "gated", "rounds": done, "blocked_kind": kind, "blocked_reason": why[:2000]})
            solo._save(pipe, questions=solo._solo(pipe).get("questions", []) + [why[:600]])
        g = solo.suite(wt)                                       # the suite in the worktree
        rec.update(suite=g["ok"], ran=g["ran"])
        if not g["ok"]:
            rec["failed"] = "suite"
            done.append(rec)
            _save(pipe, build={**_earlier(pipe), "rounds": done})
            feedback = again(n, "the whole test suite in your working copy is red", tail(g["output"], solo.GATE_TAIL))
            continue
        solo.keep_eol(wt, base)
        git(wt, "add", "-A", "--", ".", *solo.EXCLUDE)
        changed = [p for p in (git_out(wt, "diff", "--name-only", "--cached", base) or "").splitlines() if p.strip()]
        if not changed:
            rec["failed"] = "nothing changed"
            done.append(rec)
            _save(pipe, build={**_earlier(pipe), "rounds": done})
            feedback = again(n, "you changed nothing", "the approved plan asks for a change; implement it")
            continue
        hist = DL.render(DL.entries(pipe.pack))                 # the decisions that shaped the approved documents
        try:
            T.persist(wt, pipe.run, r, _docs(r, state(pipe)), changed,     # the living spec joins the change
                      settled=_settled_for(_gate_notes(pipe, r)), extra={DL.FILE: hist} if hist else None)
            _histories_behind(pipe, r, wt)
        except OSError as e:
            rec["persist"] = str(e)[:300]
        git(wt, "add", "-A", "--", ".", *solo.EXCLUDE)
        if git(wt, "diff", "--cached", "--quiet", check=False).returncode != 0:
            git(wt, "-c", "gc.auto=0", "commit", "-q", "-m", "line %s: gated round %d" % (pipe.run, n + 1))
        sha = git_out(wt, "rev-parse", "HEAD")
        solo._forward(pipe, RunState.INTEGRATING)
        solo._forward(pipe, RunState.QAS)
        pipe._board("qas", "round %d of %d" % (n + 1, rounds), "deploy dev (QAS slot) and run the tests")
        pipe._hook("before_qas")
        dep = pipe._qas_locked(lambda: deployer.deploy(pipe.run, ref=sha))
        if not dep.deployed and dep.reason != "already_live":
            rec.update(failed="qas", qas=dep.reason)
            done.append(rec)
            _save(pipe, build={**_earlier(pipe), "rounds": done})
            feedback = again(n, "the deploy to the dev slot (a clean export of your commit) or its test run failed "
                                "(%s)" % dep.reason, tail(str((dep.detail or {}).get("output", "")), solo.GATE_TAIL))
            continue
        rec["qas"] = "green"
        done.append(rec)
        _save(pipe, build={**_earlier(pipe), "rounds": done, "sha": sha, "base": base, "color": dep.color})
        notes = _gate_notes(pipe, r)                            # a choice a person settled at a gate is in the plan
        _metric(pipe, sid, decisions_outside_plan=len([x for x in state(pipe).get("outside_plan") or []
                                                       if not settled_at(x, notes)]))
        return sha
    last = done[-1] if done else {}
    _metric(pipe, sid, mid_run_stops=1)
    raise Escalate(codes.QAS_RED if last.get("failed") == "qas" else codes.NO_PROGRESS,
                   "still red after %d round(s) of implement, deploy and test: stopped for a person" % rounds,
                   {"lane": "gated", "rounds": done, "output": tail(feedback, 3000)})


# ------------------------------------------------------------------ the decision history in the repository

def _history_dir(r: D.Resolved) -> str:
    return str(((r.step("build") or {}).get("persist") or {}).get("dir") or "").strip("/\\")


def _histories_behind(pipe: Any, r: D.Resolved, wt: str) -> List[str]:
    """Earlier runs of the project whose committed decision history lacks decisions taken after their merge (their
    final review) get it now, in this change. -> the files written"""
    root = _history_dir(r)
    cdir = os.path.join(wt, root, "changes") if root else ""
    if not (cdir and os.path.isdir(cdir)):
        return []
    out = []
    for run in sorted(os.listdir(cdir)):
        path = os.path.join(cdir, run, DL.FILE)
        if run == pipe.run or not os.path.isfile(path):
            continue
        text = DL.render(DL.entries(str((pipe.store.get(E_RUN, run) or {}).get("pack_path") or "")))
        with open(path, encoding="utf-8") as fh:
            old = fh.read()
        if text and old != text.rstrip() + "\n":
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text.rstrip() + "\n")
            out.append(path)
    return out


def _history_to_main(pipe: Any, r: D.Resolved) -> str:
    """After the final review: the run's decision history, final decision included, as one commit on main (before
    the Deliver step pushes). Only while no other run of the repository builds on main (its fast-forward merge would
    be refused); otherwise the next run's change carries it (_histories_behind). -> what happened"""
    from .solo import BRANCH
    root = _history_dir(r)
    text = DL.render(DL.entries(pipe.pack)) if root else ""
    if not text:
        return ""
    rel = "%s/changes/%s/%s" % (root, pipe.run, DL.FILE)
    with Q.repo_lock(pipe.repo):
        if git_out(pipe.repo, "rev-parse", "--abbrev-ref", "HEAD") != "main" \
                or git_out(pipe.repo, "status", "--porcelain").strip():
            return "later: main is not a clean checkout"
        mine = BRANCH % pipe.run
        heads = git_out(pipe.repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/line/").split()
        if [b for b in heads if b != mine]:
            return "later: another run builds on main"
        path = os.path.join(pipe.repo, *rel.split("/"))
        try:
            with open(path, encoding="utf-8") as fh:
                if fh.read() == text.rstrip() + "\n":
                    return "up to date"
        except OSError:
            pass
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text.rstrip() + "\n")
        git(pipe.repo, "add", "--", rel)
        git(pipe.repo, "-c", "gc.auto=0", "commit", "-q", "-m", "line %s: decisions at the gates" % pipe.run)
    return "committed"


# ------------------------------------------------------------------ the review step

def findings(pipe: Any) -> List[Dict[str, Any]]:
    """What the run showed (code, no model). technical = settled in the rounds (the retro takes them to the agents),
    business = a decision or a question a person must confirm or correct, unless a person's gate note settled it."""
    st = state(pipe)
    notes = _gate_notes(pipe, _resolved(pipe))
    out: List[Dict[str, Any]] = []
    for r in (st.get("build") or {}).get("rounds") or []:
        if r.get("failed"):
            out.append({"id": "R%d" % r.get("n"), "kind": "technical", "status": "resolved in a later round",
                        "title": "round %s failed: %s" % (r.get("n"), {"suite": "test suite red in the worktree",
                                                                       "qas": "deploy / tests on the dev slot",
                                                                       }.get(r["failed"], r["failed"]))})
    solo_st = dict(_detail(pipe.store, pipe.run).get("solo") or {})
    for tag, label, rows in (("D", "decided: ", solo_st.get("decisions")), ("Q", "question: ", solo_st.get("questions"))):
        for i, text in enumerate(rows or [], 1):
            gate = settled_at(text, notes)
            out.append({"id": "%s%d" % (tag, i), "kind": "business", "title": label + text,
                        "status": ("settled at gate %s" % gate) if gate else "needs a person"})
    return out


def _report(pipe: Any, r: D.Resolved) -> Dict[str, Any]:
    rep = M.evaluate(r, state(pipe).get("metrics") or {})
    _save(pipe, report=rep)
    return rep


def _review(pipe: Any, r: D.Resolved, step: Dict[str, Any]) -> Dict[str, Any]:
    """Findings, the step's checks on the change and actual against target, then the person's review. -> decision"""
    g = dict(step["gate"], _step=step["id"])
    gate = g["name"]
    st = state(pipe)
    if "findings" not in st:
        f = findings(pipe)
        b = st.get("build") or {}
        diff = ""
        if b.get("base") and b.get("sha"):
            cp = git(pipe.repo, "diff", b["base"], b["sha"], check=False)
            diff = cp.stdout if cp.returncode == 0 else ""
        found = _run_checks(pipe, r, step, _docs(r, st), diff=diff)
        checks = dict(st.get("checks") or {})
        checks[gate] = found
        _save(pipe, findings=f, checks=checks)
        _report(pipe, r)
        pipe._board(str(g.get("board") or "result"), "findings",
                    "\n".join("%s [%s] %s" % (x["id"], x["kind"], x["title"]) for x in f)[:3000] or "no findings")
    if not _approved(pipe, r, gate):
        if not _try_auto(pipe, r, g, _docs(r, state(pipe))):
            d = _taken(pipe, r, gate)
            if d is None:
                _open(pipe, r, gate)
            _close_gate(pipe)
    d = next(x for x in reversed(state(pipe).get("log") or []) if x.get("gate") == gate)
    from . import outcomes                     # the retro (line.retro, at run end) reads this with the run's facts
    outcomes.record(pipe.store, pipe.run, "human_review", decision=d.get("decision"), solutions=d.get("note") or "",
                    findings=[x.get("title") for x in state(pipe).get("findings") or []], auto=bool(d.get("auto")))
    return dict(d, deliver=d.get("decision") in (g.get("deliver") or []))


# ------------------------------------------------------------------ the lane

def _who(r: D.Resolved, step_id: str) -> Dict[str, str]:
    s = next((x for x in r.steps() if x["id"] == step_id), {}) if step_id != NEEDS else {}
    return {"step": step_id, "handler": str(s.get("incident") or r.data.get("owner") or ""),
            "supervisor": str(s.get("supervisor") or r.data.get("owner") or ""), "process": r.ref()}


def run(pipe: Any) -> None:
    """The definition's steps on the solo lane (called by line.solo.run). Raises Parked at a gate, Escalate when
    stopped (with the role that handles it)."""
    from .pipeline import Escalate
    from .understand import ingest
    from . import outcomes, solo
    st = state(pipe)
    if not st.get("process"):
        detail = _detail(pipe.store, pipe.run)
        try:
            r = D.select(pipe.cfg, pipe.repo, flow_of(detail), detail, store=pipe.store)
        except ValueError as e:
            raise Escalate(codes.SCHEMA_INVALID, "the process definition cannot run: %s" % e, {"lane": "gated"})
        if r is None:
            raise Escalate(codes.SCHEMA_INVALID, "no process definition applies to flow %r" % flow_of(detail),
                           {"lane": "gated"})
        _save(pipe, on=True, process=r.snapshot())
    else:
        _save(pipe, on=True)
    r = _resolved(pipe)
    if not (pipe.store.get(E_RUN, pipe.run) or {}).get("spec_hash"):
        pipe._hook("run_start")
        pv = ingest(pipe.pack, pipe.sstore, pipe.rag, run=pipe.run, cfg=pipe.cfg)
        update_row(pipe.store, E_RUN, pipe.run, {"spec_hash": pv.version})
    steps = r.steps()
    ids = [s["id"] for s in steps]
    serial = Q.serial_step(steps, Q.policy(pipe.cfg, pipe.store, pipe.run))   # the process's queue policy
    sha = ""
    decision: Dict[str, Any] = {"decision": "deliver", "deliver": True}
    at = NEEDS
    try:
        _save(pipe, at=NEEDS)
        _needs(pipe, r)
        i = 0
        while i < len(steps):
            step = steps[i]
            at = step["id"]
            _save(pipe, at=at)
            if i >= serial:
                Q.wait_turn(pipe)                  # from serial_from on: one run of the project at a time
            try:
                if step["kind"] == "draft":
                    _draft(pipe, r, step)
                elif step["kind"] == "build":
                    st = state(pipe)
                    sha = str((st.get("build") or {}).get("merged") or "")
                    if not sha:
                        sha = str((st.get("build") or {}).get("sha") or "")
                        if not sha or git(pipe.repo, "cat-file", "-e", sha + "^{commit}", check=False).returncode != 0:
                            sha = _build(pipe, r, step)
                        solo._merge(pipe, sha)
                        _save(pipe, build=dict(state(pipe).get("build") or {}, merged=sha))
                    Q.merged(pipe)                 # hold_until "merged": the next run builds now
                elif step["kind"] == "review":
                    decision = _review(pipe, r, step)
            except _Rewind as rw:
                i = ids.index(rw.step)
                continue
            for h in step.get("hooks_after") or []:
                pipe._hook(h)
            i += 1
    except Escalate as e:
        e.detail = dict(e.detail or {}, process_roles=_who(r, at))
        _report(pipe, r)
        raise
    sha = sha or git_out(pipe.repo, "rev-parse", "main")
    report = _report(pipe, r)
    outcomes.record(pipe.store, pipe.run, "process", process=r.ref(), met=report["process"]["met"],
                    missed=report["process"]["missed"], steps={k: v["missed"] for k, v in report["steps"].items()
                                                               if v["missed"]})
    try:                                           # the final decision joins the history the change carries
        _save(pipe, history_commit=_history_to_main(pipe, r))
    except Exception as e:   # noqa: BLE001 - the history stays on disk and in the store; the next change carries it
        _save(pipe, history_commit="failed: %s" % str(e)[:200])
    pipe._hook("before_green")
    if decision.get("deliver"):
        pipe._deliver()
    else:
        pipe._set_detail(delivered={"skipped": "held by %s at the final review" % (decision.get("by") or "a person")})
    pipe._quiesce()
    spent = pipe._spent()
    pipe._board("result", "green", "$%.2f spent; %s; main at %s" % (spent, decision.get("decision"), sha[:12]))
    pipe._advance(RunState.GREEN, extra=[(codes.RUN_GREEN, {
        "sha": sha, "color": (state(pipe).get("build") or {}).get("color") or "", "lane": "gated",
        "qas": {"suite": "green"}, "usd": round(spent, 6), "units": 0, "quarantined": [],
        "decision": decision.get("decision"), "process": r.ref(), "kpi_met": report["process"]["met"]})])


# ------------------------------------------------------------------ the person's side (API)

def _doc(r: D.Resolved, name: str, st: Dict[str, Any], gate: str) -> Optional[Dict[str, str]]:
    if name == "@checks":
        rows = (st.get("checks") or {}).get(gate) or []
        return {"id": "checks", "title": "Checks", "text": _checks_text(rows)} if rows else None
    if name == "@drift":
        rows = st.get("drift") or []
        return {"id": "drift", "title": "Earlier spec items the code moved away from",
                "text": T.drift_text(rows)} if rows else None
    if name == "@needs":
        rows = (st.get("needs") or {}).get("rows") or []
        return {"id": "needs", "title": "What the agents need", "text": N.table(rows)} if rows else None
    if name == "@metrics":
        rep = st.get("report")
        return {"id": "metrics", "title": "Actual against target", "text": M.text(rep)} if rep else None
    if name == "@rounds":
        rounds = (st.get("build") or {}).get("rounds") or []
        return {"id": "rounds", "title": "Implement, deploy, test rounds",
                "text": "\n".join("- round %s: %s" % (x.get("n"), "green on the dev slot" if x.get("qas") == "green"
                                                      else "failed (%s)" % x.get("failed")) for x in rounds)}
    if name == "@findings":
        return {"id": "findings", "title": "Findings",
                "text": "\n".join("- **%s** [%s, %s] %s" % (f["id"], f["kind"], f["status"], f["title"])
                                  for f in st.get("findings") or []) or "none"}
    text = str((st.get(name) or {}).get("doc") or "")
    art = r.artifact(name)
    return {"id": name, "title": art.get("title") or name, "text": text, "glance": BR.glance(text, art),
            "asks": BR.asks(text, art), "edited_ms": (st.get(name) or {}).get("chat_edit_ms")}


def view(store: Any, run: str) -> Optional[Dict[str, Any]]:
    """The open gate of a run with what the person decides on, or None."""
    detail = _detail(store, run)
    g = detail.get("gate") or {}
    if not g.get("name"):
        return None
    r = _resolved_of(detail)
    name = g["name"]
    st = dict(detail.get("gated") or {})
    gd = _gate_def(r, st, name)
    docs = [d for d in (_doc(r, n, st, name) for n in gd.get("show") or []) if d]
    who = _who(r, gd.get("_step") or name)
    asks = [dict(a, artifact=d["id"], artifact_title=d["title"]) for d in docs for a in d.get("asks") or []]
    from . import gatechat
    return {"name": name, "step": gd.get("step"), "round": g.get("round"), "title": gd.get("title") or name,
            "docs": docs, "asks": asks, "pass": list(gd.get("pass") or []),
            "chat": bool(gd.get("chat")), "messages": gatechat.messages(st, name) if gd.get("chat") else [],
            "refreshed": [x for x in st.get("refresh_log") or [] if x.get("gate") == name][-5:],
            "decisions": list(gd.get("decisions") or []),
            "decision_labels": dict(gd.get("decision_labels") or {}), "targets": list(gd.get("targets") or {}),
            "target_labels": dict(gd.get("target_labels") or {}), "default_target": gd.get("default_target") or "",
            "revise": list(gd.get("revise") or []), "review": bool(gd.get("review")),
            "note_label": gd.get("note_label") or "", "note_placeholder": gd.get("note_placeholder") or "",
            "approvers": list(gd.get("approvers") or []), "supervisor": who["supervisor"], "process": r.ref(),
            "history": [d for d in st.get("log") or [] if d.get("gate") == name], "ms": g.get("ms")}


def _attach(pack: str, gate: str, rnd: int, files: List[Dict[str, Any]], folder: str = "") -> List[Dict[str, str]]:
    """Save the person's files as markdown in the pack (PDF / Word converted, text kept). -> [{name, path, warnings}]"""
    from .docread import DocError, convert_bytes, readable
    if len(files) > MAX_FILES:
        raise ValueError("at most %d files per decision" % MAX_FILES)
    out: List[Dict[str, str]] = []
    d = folder or os.path.join(pack, GATE_DIR)
    os.makedirs(d, exist_ok=True)
    for i, f in enumerate(files, 1):
        name = os.path.basename(str(f.get("name") or "file%d" % i))
        try:
            data = base64.b64decode(str(f.get("data") or ""), validate=False)
        except (ValueError, TypeError) as e:
            raise ValueError("%s: data is not base64" % name) from e
        if len(data) > MAX_FILE_BYTES:
            raise ValueError("%s is larger than %d MB" % (name, MAX_FILE_BYTES // (1024 * 1024)))
        warnings: List[str] = []
        if readable(name):
            try:
                doc = convert_bytes(name, data)
            except DocError as e:
                raise ValueError(str(e)) from e
            text, warnings = doc.text, doc.warnings
        elif name.lower().endswith(TEXT_FILES):
            text = data.decode("utf-8", errors="replace")
        else:
            raise ValueError("%s: only PDF, Word (.docx) and text files are accepted" % name)
        safe = re.sub(r"[^\w.\-]+", "_", name)[:80]
        path = os.path.join(d, "%s-r%d-%d-%s.md" % (gate, rnd, i, safe))
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        out.append({"name": name, "path": path, "warnings": "; ".join(warnings)})
    return out


def decide(store: Any, cfg: Any, run: str, gate: str, body: Dict[str, Any], actor: str = "",
           roles: Optional[List[str]] = None) -> Dict[str, Any]:
    """POST /api/runs/{run}/gates/{gate}: a person's decision at the open gate. ValueError on a bad body or a gate
    that is not open, PermissionError when the gate names approvers and the person has none of their roles (roles
    None = sign-in is off); the caller resumes the run. Every decision becomes a precedent of the run's project."""
    from .gatechat import DETAIL_LOCK
    with DETAIL_LOCK:                              # a chat answer writes the same run detail
        out = _decide(store, cfg, run, gate, body, actor, roles)
    e = out.pop("ledger", None)
    if e is not None:                              # what the person decided is knowledge of THIS project (line.decisions)
        out["recorded"] = {"disk": out.pop("on_disk", False),
                           "store": DL.push(cfg, DL.project_of(cfg, _detail(store, run)), run, e)}
    return out


def _decide(store: Any, cfg: Any, run: str, gate: str, body: Dict[str, Any], actor: str,
            roles: Optional[List[str]]) -> Dict[str, Any]:
    row = store.get(E_RUN, run) or {}
    if not row:
        raise KeyError(run)
    detail = dict(row.get("detail") or {})
    open_gate = (detail.get("gate") or {}).get("name")
    if not open_gate or open_gate != gate:
        raise ValueError("gate %s is not open on run %s (open: %s)" % (gate, run, open_gate or "none"))
    r = _resolved_of(detail)
    st = dict(detail.get("gated") or {})
    gd = _gate_def(r, st, gate)
    approvers = list(gd.get("approvers") or [])
    if approvers and roles is not None and not set(approvers) & set(roles):
        raise PermissionError("gate %s is decided by %s" % (gate, " or ".join(approvers)))
    decisions = list(gd.get("decisions") or [])
    decision = str(body.get("decision") or "").strip().lower()
    if decision not in decisions:
        raise ValueError("decision must be one of %s" % ", ".join(decisions))
    note = str(body.get("note") or "").strip()[:MAX_NOTE]
    answers = body.get("answers") or []
    if not isinstance(answers, list) or not all(isinstance(a, dict) for a in answers):
        raise ValueError("answers must be a list of {artifact, id, ok, text}")
    asks = [dict(a, artifact=n) for n in gd.get("show") or [] if not n.startswith("@")
            for a in BR.asks(str((st.get(n) or {}).get("doc") or ""), r.artifact(n))]
    if answers:                                    # the person's answer to each point the agents decided alone
        known = {(a["artifact"], a["id"]): a for a in asks}
        for a in answers:
            key = (str(a.get("artifact") or ""), str(a.get("id") or ""))
            if key not in known:
                raise ValueError("answer to %s %s: no such point at this gate" % key)
            if known[key].get("status") == "open" and not str(a.get("text") or "").strip():
                raise ValueError("%s %s is open (the agent proposed nothing): write your answer" % key)
        extra = BR.answers_note(asks, answers)
        note = (note + "\n\n" + extra if note else extra)[:MAX_NOTE]
    targets = dict(gd.get("targets") or {})
    revise = decision in (gd.get("revise") or [])
    target = ""
    if targets and revise:
        target = str(body.get("target") or gd.get("default_target") or next(iter(targets))).strip()
        if target not in targets:
            raise ValueError("target must be one of %s" % ", ".join(targets))
    files = body.get("files") or []
    if not isinstance(files, list):
        raise ValueError("files must be a list of {name, data (base64)}")
    if revise and not note and not files:
        raise ValueError("a %s needs a note or files: what should change" % decision)
    rnd = int((st.get("rounds") or {}).get(gate, 0)) + 1
    pack = str(row.get("pack_path") or "")
    folder = N.supplied_dir(pack, target) if gate == NEEDS and target else ""
    saved = _attach(pack, gate, rnd, files, folder) if files else []
    if gate == NEEDS and target and note:
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "note-r%d.md" % rnd), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(note)
    who = str(body.get("who") or actor or "a person")[:120]
    d = {"gate": gate, "round": rnd, "decision": decision, "note": note, "files": saved, "by": who, "ms": now_ms()}
    if target:
        d["target"] = target
    if answers:
        d["answers"] = [{"artifact": str(a.get("artifact")), "id": str(a.get("id")), "ok": bool(a.get("ok")),
                         "text": str(a.get("text") or "")[:2000]} for a in answers]
    pend = dict(st.get("pending") or {})
    pend[gate] = d
    st["pending"] = pend
    detail["gated"] = st
    update_row(store, E_RUN, run, {"detail": detail})
    if gate != NEEDS:
        docs = "\n".join("%s: %s" % (n, str((st.get(n) or {}).get("doc") or "")[:400]) for n in gd.get("show") or []
                         if not n.startswith("@"))
        P.record(store, detail, run, gd, decision, note, who, docs, r.ref())
    try:
        from .statemachine import StateMachine
        StateMachine(store, getattr(cfg, "agent_version", ""), getattr(cfg, "model", "")).em.run_event(
            run, codes.GATE_DECIDED, {"gate": gate, "decision": decision, "target": target, "by": who,
                                      "files": [f["name"] for f in saved]})
    except Exception:   # noqa: BLE001
        pass
    e = DL.entry(run, r, dict(gd, name=gate), d, st, pack, asks=asks)      # the spec's history, on disk now
    return {"gate": gate, "decision": decision, "round": rnd, "files": saved, "resume": True,
            "ledger": e, "on_disk": DL.record(pack, e)}


def adopt(store: Any, cfg: Any, run: str, ref: str, actor: str = "") -> Dict[str, Any]:
    """POST /api/runs/{run}:adopt-process {"process": "<id>@<version>"}: a run parked at a gate goes on with another
    version of its process. Allowed only when every step the run already passed, and the step it waits at, exist in
    that version with the same kind and the same documents (nothing done is lost or re-read differently)."""
    row = store.get(E_RUN, run) or {}
    if not row:
        raise KeyError(run)
    detail = dict(row.get("detail") or {})
    st = dict(detail.get("gated") or {})
    if not st.get("process") or not (detail.get("gate") or {}).get("name"):
        raise ValueError("run %s is not parked at a gate of a process" % run)
    old = D.frozen(st["process"])
    new = D.select(cfg, str(row.get("target") or detail.get("target") or ""), "", {"process": ref}, store=store)
    if new is None or new.id != old.id:
        raise ValueError("%s is not a version of process %s" % (ref, old.id))
    ids = [s["id"] for s in old.steps()]
    at = str(st.get("at") or "")
    upto = ids[:ids.index(at) + 1] if at in ids else []

    def shape(r: D.Resolved, sid: str) -> Any:
        s = next((x for x in r.steps() if x["id"] == sid), None)
        return None if s is None else (s["kind"], sorted(a["artifact"] for a in s.get("agents") or []),
                                       (s.get("gate") or {}).get("name"))

    broken = [sid for sid in upto if shape(old, sid) != shape(new, sid)]
    if broken:
        raise ValueError("version %s changes steps this run already went through: %s" % (new.version, ", ".join(broken)))
    st["process"] = new.snapshot()
    st.setdefault("adopted", []).append({"from": old.ref(), "to": new.ref(), "by": actor or "a person", "ms": now_ms()})
    detail["gated"] = st
    update_row(store, E_RUN, run, {"detail": detail})
    return {"run": run, "from": old.ref(), "to": new.ref()}


__all__ = ["enabled", "run", "view", "decide", "adopt", "findings", "brief", "state", "NEEDS"]
