"""Read-only projections for a frontend: the stage nodes of a run, the agents' worklog per node, and the
run's reports. Everything is derived from store rows and events; nothing here writes.

    nodes(store, run)               -> [{id, title, stage, state, roles, started_ms, ended_ms, counts}]
    worklog(store, run, node)       -> [{ts, role, agent, kind, title, text, cost_usd?, artifact?}]
    reports(store, run)             -> [{id, kind, title, node, created_ms, mime, size, url}]
    report(store, run, rid)         -> {"report": meta, "content": text}

Node states: pending | running | awaiting (an open gate: a person decides) | queued (waits its turn in the change
queue) | paused | done | failed | skipped.
Report ids are fixed strings ("gen-<name>" for generated reports, "file-<name>" for the spec pack's own
top-level text files); a request only ever resolves an id that the listing produced, so no path from the
caller reaches the file system.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from . import codes
from .codes import LineError
from .worklog_text import attempt_text, call_text, event_text, gate_text
from .contracts import (
    E_ACC_TEST, E_ATTEMPT, E_DECISION, E_DEPLOY, E_ESCALATION, E_GATE, E_LLM_CALL, E_MERGE, E_QAS, E_RUN, E_UNIT,
    to_dict,
)

TERMINAL = ("green", "escalated")
STATE_ORDER = ["admitted", "understanding", "planning", "building", "integrating", "qas", "green"]

#: (id, title, run states the node runs in, LLM roles, event kinds / kind prefixes)
NODES: Sequence[Tuple[str, str, Tuple[str, ...], Tuple[str, ...], Tuple[str, ...]]] = (
    ("understand", "Understand the spec", ("admitted", "understanding"),
     ("reader", "reader_a", "reader_b", "reader_reread", "gaps", "conflicts", "fgraph", "human_decider"),
     ("run.admitted", "spec.frozen", "digest.done", "reconcile.diverged", "gaps.checked", "conflicts.checked",
      "human.", "spec.addendum", "run.parked", "run.unparked", "fgraph.checked")),
    ("tests", "Write acceptance tests", ("understanding",), ("test_author",), ("tests.approved",)),
    ("plan", "Plan the units", ("planning",), ("planner",), ("graph.valid",)),
    ("build", "Build the units", ("building",), ("builder", "fixer"),
     ("unit.dispatched", "unit.submitted", "unit.blocked", "unit.requeued", "verify.failed", "lease.expired",
      "seal.")),
    ("review", "Review", ("building",), ("reviewer", "judge"),
     ("review.done", "drift.signal", "judge.decision", "decision.graded")),
    ("merge", "Merge to main", ("integrating",), (), ("unit.merged",)),
    ("qas", "Deploy and test (QAS)", ("qas",), (), ("deploy.done", "qas.result")),
    ("deliver", "Deliver (push to source)", (), (), ("deliver.",)),
    ("result", "Result", (), ("distiller", "eval_judge", "hook"),
     ("run.green", "escalated", "run.paused", "run.resumed", "budget.warn", "lesson.", "app.", "hook.")),
)
NODE_IDS = tuple(n[0] for n in NODES)

_DECISION_KINDS = ("human.decided", "judge.decision", "human.answered", "spec.addendum")
_OUTPUT_KINDS = ("spec.frozen", "digest.done", "tests.approved", "graph.valid", "unit.submitted", "unit.merged",
                 "deploy.done", "qas.result", "run.green", "fgraph.checked", "review.done", "seal.sealed",
                 "app.started", "hook.ran", "deliver.pushed")
_ERROR_KINDS = ("deliver.failed", "hook.blocked", "verify.failed", "escalated", "unit.blocked", "lease.expired", "seal.tainted", "reconcile.diverged")


def _run_row(store: Any, run: str) -> Dict[str, Any]:
    row = store.get(E_RUN, run)
    if row is None:
        raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
    return row


def _events(store: Any, run: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seq = 0
    while True:
        batch = store.events_after(seq, run=run, limit=5000)
        out.extend(to_dict(e) for e in batch)
        if len(batch) < 5000:
            break
        seq = batch[-1].seq
    # events about the run after it closed (app start / stop, run-end hooks) live on the system run
    try:
        for e in store.events_after(0, run="_line", limit=100000):
            d = to_dict(e)
            if (d.get("body") or {}).get("run") == run:
                out.append(d)
    except Exception:   # noqa: BLE001
        pass
    out.sort(key=lambda e: int(e.get("seq") or 0))
    return out


def _node_of_kind(kind: str) -> Optional[str]:
    for nid, _t, _s, _r, kinds in NODES:
        for k in kinds:
            if kind == k or (k.endswith(".") and kind.startswith(k)):
                return nid
    return None


def _node_of_role(role: str) -> Optional[str]:
    for nid, _t, _s, roles, _k in NODES:
        if role in roles:
            return nid
    return None


def _state_marks(events: List[Dict[str, Any]]) -> Dict[str, int]:
    """First ts_ms at which the run entered each state."""
    marks: Dict[str, int] = {}
    for e in events:
        if e.get("kind") == "run.admitted":
            marks.setdefault("admitted", int(e.get("ts_ms") or 0))
        if e.get("kind") == "run.state":
            to = str((e.get("body") or {}).get("to") or "")
            marks.setdefault(to, int(e.get("ts_ms") or 0))
    return marks


def _rank(state: str) -> int:
    return STATE_ORDER.index(state) if state in STATE_ORDER else -1


def _tokens(calls: List[Dict[str, Any]]) -> tuple:
    """(tokens in, tokens out) of model calls, counted as the project usage does: in = input plus cache reads
    and writes, out = output."""
    t_in = t_out = 0
    for c in calls:
        u = c.get("usage") or {}
        t_in += int(u.get("input") or 0) + int(u.get("cacheRead") or 0) + int(u.get("cacheWrite") or 0)
        t_out += int(u.get("output") or 0)
    return t_in, t_out


def nodes(store: Any, run: str) -> List[Dict[str, Any]]:
    row = _run_row(store, run)
    state = str(row.get("state") or "")
    detail = row.get("detail") or {}
    paused = bool(detail.get("paused"))
    events = _events(store, run)
    calls = store.query(E_LLM_CALL, run=run)
    kinds = {e.get("kind") for e in events}
    esc_from = ""
    if state == "escalated":
        for e in reversed(events):
            if e.get("kind") == "run.state" and (e.get("body") or {}).get("to") == "escalated":
                esc_from = str((e.get("body") or {}).get("from") or "")
                break
    # where the run is now (escalated / paused runs: where it stopped)
    where = esc_from if state == "escalated" else state
    out: List[Dict[str, Any]] = []
    for nid, title, states, roles, _k in NODES:
        evs = [e for e in events if _node_of_kind(str(e.get("kind"))) == nid]
        cs = [c for c in calls if _node_of_role(str(c.get("role") or "")) == nid]
        ts = [int(e.get("ts_ms") or 0) for e in evs] + [int(c.get("ts_ms") or 0) for c in cs]
        ts = [t for t in ts if t]
        usd = round(sum(float(c.get("usd") or 0) for c in cs), 6)
        if nid == "deliver":
            k = {str(e.get("kind")) for e in evs}
            st = ("failed" if "deliver.failed" in k else "done" if "deliver.pushed" in k else
                  "skipped" if "deliver.skipped" in k or state in TERMINAL else "pending")
        elif nid == "result":
            st = "done" if state in TERMINAL else ("paused" if paused else "pending")
            if state == "escalated":
                st = "failed"
        else:
            st = _node_state(nid, states, where, state, kinds, bool(evs or cs))
            if st == "running" and paused:
                st = "paused"
        t_in, t_out = _tokens(cs)
        counts: Dict[str, Any] = {"events": len(evs), "llm_calls": len(cs), "usd": usd,
                                  "tokens_in": t_in, "tokens_out": t_out}
        if nid == "build":
            units = store.query(E_UNIT, run=run)
            counts["units"] = len(units)
            done = [u for u in units if u.get("state") == "merged"]
            counts["already_satisfied"] = sum(1 for u in done if (u.get("detail") or {}).get("nothing_to_merge"))
            counts["merged"] = len(done) - counts["already_satisfied"]      # a real merge, not an empty diff
        out.append({"id": nid, "title": title, "stage": states[0] if states else "", "state": st,
                    "roles": list(roles), "started_ms": min(ts) if ts else 0, "ended_ms": max(ts) if ts else 0,
                    "counts": counts})
    if state not in TERMINAL and not paused:
        _waiting(out, detail)
    return out


def _waiting(out: List[Dict[str, Any]], detail: Dict[str, Any]) -> None:
    """A run that waits is not running: at an open gate its step is "awaiting" (a person must decide), in the
    change queue its build is "queued" (an earlier approved run builds first)."""
    gate = str((detail.get("gate") or {}).get("name") or "")
    ids = [n["id"] for n in out]
    if gate:
        board = ""
        try:
            from .gates import _gate_def, _resolved_of
            board = str(_gate_def(_resolved_of(detail), dict(detail.get("gated") or {}), gate).get("board") or "")
        except Exception:   # noqa: BLE001 - a run gated by an older engine: mark the running step
            board = ""
        at = ids.index(board) if board in ids else next((i for i, n in enumerate(out) if n["state"] == "running"), -1)
        for i, n in enumerate(out):
            if i == at:
                n.update(state="awaiting", gate=gate)
            elif n["state"] == "running":
                n["state"] = "done" if i < at else "pending"
        return
    wait = detail.get("queue_wait")
    if wait and "build" in ids:
        at = ids.index("build")
        for i, n in enumerate(out):
            if i == at:
                n.update(state="queued", queue=wait)
            elif n["state"] == "running":
                n["state"] = "done" if i < at else "pending"


def _node_state(nid: str, states: Tuple[str, ...], where: str, state: str, kinds: set, active: bool) -> str:
    failed_here = state == "escalated" and where in states
    if nid == "understand":
        if "spec.frozen" in kinds or _rank(where) > _rank("understanding"):
            return "done"
        return "failed" if failed_here else ("running" if where in states else "pending")
    if nid == "tests":
        if "tests.approved" in kinds or _rank(where) > _rank("understanding"):
            return "done"
        if failed_here and "spec.frozen" in kinds:
            return "failed"
        return "running" if where == "understanding" and "spec.frozen" in kinds else "pending"
    if nid == "review":
        if not active:
            return "skipped" if _rank(where) > _rank("building") or state == "green" else "pending"
        return "done" if _rank(where) > _rank("building") or state == "green" else (
            "failed" if failed_here else "running")
    here = max((_rank(s) for s in states), default=-1)
    if state == "green" or _rank(where) > here:
        return "done"
    if failed_here:
        return "failed"
    if where in states:
        return "running"
    return "pending"


# ------------------------------------------------------------------ worklog


def _short(body: Any, limit: int = 600) -> str:
    try:
        s = json.dumps(body, ensure_ascii=False, sort_keys=True, default=str)
    except (TypeError, ValueError):
        s = str(body)
    return s if len(s) <= limit else s[:limit - 3] + "..."


def _event_kind(kind: str) -> str:
    if kind in _ERROR_KINDS:
        return "error"
    if kind in _DECISION_KINDS:
        return "decision"
    if kind in _OUTPUT_KINDS:
        return "output"
    return "event"


def worklog(store: Any, run: str, node: str, limit: int = 1000) -> List[Dict[str, Any]]:
    _run_row(store, run)
    if node not in NODE_IDS:
        raise LineError(codes.NOT_FOUND, "node %s" % node, {"node": node, "nodes": list(NODE_IDS)})
    out: List[Dict[str, Any]] = []
    for e in _events(store, run):
        kind = str(e.get("kind") or "")
        if _node_of_kind(kind) != node:
            continue
        env = e.get("env") or {}
        body = e.get("body") or {}
        unit = str(env.get("unit") or body.get("unit") or "")
        title, text = event_text(kind, body, unit)
        out.append({"ts": int(e.get("ts_ms") or 0), "seq": e.get("seq"), "role": _role_for(node, kind),
                    "agent": unit or "line", "kind": _event_kind(kind), "event": kind,
                    "title": title, "text": text, "raw": _short(body)})
    for c in store.query(E_LLM_CALL, run=run):
        role = str(c.get("role") or "")
        if _node_of_role(role) != node:
            continue
        key = str(c.get("key") or "")
        ok = bool(c.get("ok", True))
        title, text = call_text(c)
        raw = "%s %s via %s, $%.4f%s" % (c.get("op", "call"), "ok" if ok else "failed (%s)" % c.get("error", "?"),
                                         c.get("model", "?"), float(c.get("usd") or 0),
                                         ", repair" if c.get("repair") else "")
        out.append({"ts": int(c.get("ts_ms") or 0), "role": role, "agent": (key.split(".")[0] if key else role),
                    "kind": "llm_call" if ok else "error", "title": title, "text": text, "raw": raw,
                    "cost_usd": round(float(c.get("usd") or 0), 6)})
    if node == "build":
        att_ts = {(str(a.get("unit")), int(a.get("n") or 0)): int(a.get("ended_ms") or a.get("started_ms") or 0)
                  for a in store.query(E_ATTEMPT, run=run)}
        for g in store.query(E_GATE, run=run):
            if not g.get("unit"):
                continue                      # run-level gates (smoke, QAS) belong to the QAS node
            gate = g.get("gate") or {}
            ok = bool(gate.get("ok"))
            ts = int(g.get("ts_ms") or gate.get("ts_ms") or 0) or att_ts.get((str(g.get("unit")),
                                                                               int(g.get("attempt") or 0)), 0)
            title, text = gate_text(g)
            out.append({"ts": ts, "role": "verifier",
                        "agent": str(g.get("unit") or ""), "kind": "output" if ok else "error",
                        "title": title, "text": text,
                        "raw": "ok" if ok else "%s %s" % (gate.get("code", ""), _short(gate.get("detail") or {}, 400))})
        for a in store.query(E_ATTEMPT, run=run):
            out.append({"ts": int(a.get("ended_ms") or a.get("started_ms") or 0), "role": "builder",
                        "agent": str(a.get("unit") or ""), "kind": "output" if a.get("outcome") in ("verified", "submitted")
                        else ("error" if a.get("outcome") in ("failed", "lost", "blocked") else "event"),
                        "title": attempt_text(a)[0], "text": attempt_text(a)[1],
                        "raw": "model %s, rung %s, $%.4f %s" % (a.get("model", ""), a.get("rung", 0),
                                                                 float(a.get("usd") or 0), a.get("code", "")),
                        "cost_usd": round(float(a.get("usd") or 0), 6)})
    if node == "qas":
        qts = [int(e.get("ts_ms") or 0) for e in _events(store, run) if e.get("kind") in ("deploy.done", "qas.result")]
        for g in store.query(E_GATE, run=run):
            if g.get("unit"):
                continue
            gate = g.get("gate") or {}
            ok = bool(gate.get("ok"))
            out.append({"ts": int(g.get("ts_ms") or gate.get("ts_ms") or 0) or (max(qts) if qts else 0),
                        "role": "qas_runner", "agent": "line", "kind": "output" if ok else "error",
                        "title": gate_text(g)[0], "text": gate_text(g)[1],
                        "raw": "ok" if ok else "%s %s" % (gate.get("code", ""), _short(gate.get("detail") or {}, 400))})
    if node == "review":
        for d in store.query(E_DECISION, run=run):
            out.append({"ts": int(d.get("ts_ms") or 0), "role": "judge", "agent": str(d.get("unit") or "judge"),
                        "kind": "decision", "title": "decision %s" % d.get("kind", ""),
                        "text": _short({k: d.get(k) for k in ("action", "reason", "verdict", "instructions")
                                        if d.get(k) is not None})})
    out.sort(key=lambda r: (r.get("ts") or 0, r.get("seq") or 0))
    return out[-limit:]


def _role_for(node: str, kind: str) -> str:
    if kind.startswith("human."):
        return "human_decider" if kind == "human.decided" else "human"
    if kind.startswith("seal."):
        return "sealer"
    return {"understand": "reader", "tests": "test_author", "plan": "planner", "build": "builder",
            "review": "reviewer", "merge": "merge_queue", "qas": "qas_runner", "result": "line"}.get(node, "line")


# ------------------------------------------------------------------ reports


def _pack_files(row: Mapping[str, Any]) -> List[Tuple[str, str]]:
    pack = str(row.get("pack_path") or "")
    if not pack or not os.path.isdir(pack):
        return []
    out = []
    for name in sorted(os.listdir(pack)):
        p = os.path.join(pack, name)
        if os.path.isfile(p) and os.path.splitext(name)[1].lower() in (".md", ".txt", ".json") \
                and not name.startswith("."):
            out.append((name, p))
    return out


def _gen_implement(store: Any, run: str) -> str:
    units = sorted(store.query(E_UNIT, run=run), key=lambda u: str(u.get("id")))
    attempts = store.query(E_ATTEMPT, run=run)
    lines = ["# Implementation report", "", "Run `%s`: %d unit(s)." % (run, len(units)), ""]
    for u in units:
        mine = sorted([a for a in attempts if a.get("unit") == u.get("id")], key=lambda a: int(a.get("n") or 0))
        usd = sum(float(a.get("usd") or 0) for a in mine)
        lines += ["## %s %s" % (u.get("id"), u.get("title") or ""), "",
                  "- State: **%s**" % u.get("state"), "- F-items: %s" % ", ".join(u.get("f_items") or []),
                  "- Files (claims): %s" % ", ".join(u.get("claims") or []),
                  "- Attempts: %d, model %s, cost $%.4f" % (len(mine), u.get("model") or "", usd), ""]
        for a in mine:
            lines.append("  - #%s %s %s" % (a.get("n"), a.get("outcome") or "", a.get("code") or ""))
        lines.append("")
    return "\n".join(lines)


def _gen_tests(store: Any, run: str) -> str:
    tests = store.query(E_ACC_TEST, run=run)
    gates = store.query(E_GATE, run=run)
    qas = store.query(E_QAS, run=run)
    lines = ["# Test report", "", "## Acceptance tests (%d)" % len(tests), ""]
    for t in sorted(tests, key=lambda t: str(t.get("id"))):
        lines.append("- `%s` %s (%s)" % (t.get("name") or t.get("id"), t.get("criterion") or "", t.get("path") or ""))
    lines += ["", "## Verifier gates (%d)" % len(gates), ""]
    for g in gates:
        gate = g.get("gate") or {}
        lines.append("- %s %s #%s: %s %s" % (g.get("name", ""), g.get("unit", ""), g.get("attempt", ""),
                                             "ok" if gate.get("ok") else "FAIL", gate.get("code", "")))
    lines += ["", "## QAS (%d F-items)" % len(qas), ""]
    for q in qas:
        lines.append("- %s: %s (runs %s)" % (q.get("f_item"), q.get("verdict"), q.get("runs")))
    return "\n".join(lines)


def _gen_qas(store: Any, run: str) -> str:
    lines = ["# Deploy and QAS", ""]
    for d in store.query(E_DEPLOY, run=run):
        lines.append("- deploy %s sha %s: %s" % (d.get("color"), str(d.get("sha") or "")[:12], d.get("state")))
    lines.append("")
    for m in store.query(E_MERGE, run=run):
        lines.append("- merge %s wave %s: %s" % (m.get("unit"), m.get("wave"), m.get("state")))
    lines.append("")
    for q in store.query(E_QAS, run=run):
        lines.append("- QAS %s: **%s** runs %s%s" % (q.get("f_item"), q.get("verdict"), q.get("runs"),
                                                     " (quarantined)" if q.get("quarantined") else ""))
    return "\n".join(lines)


def _gen_questions(store: Any, run: str) -> str:
    from .contracts import E_ASSUMPTION, E_QUESTION
    lines = ["# Questions, assumptions and decisions", ""]
    qs = store.query(E_QUESTION, run=run)
    for q in qs:
        lines += ["## %s (%s)" % (q.get("qid") or q.get("id"), q.get("state", "")), "",
                  str(q.get("decision") or q.get("text") or ""), ""]
        ans = q.get("answer")
        if ans:
            lines += ["Answer: %s" % _short(ans, 800), ""]
    for a in store.query(E_ASSUMPTION, run=run):
        lines.append("- Assumption %s: %s" % (a.get("id"), a.get("text") or a.get("statement") or ""))
    for e in _events(store, run):
        if e.get("kind") == "human.decided":
            lines.append("- Decided by the model: %s" % _short(e.get("body") or {}, 800))
    return "\n".join(lines)


def _gen_decisions(store: Any, run: str) -> str:
    lines = ["# Findings and decisions", ""]
    for d in store.query(E_DECISION, run=run):
        lines.append("- %s %s: %s" % (d.get("unit", ""), d.get("kind", ""), _short(d, 500)))
    for x in store.query(E_ESCALATION, run=run):
        lines.append("- Escalation %s: %s" % (x.get("code"), x.get("message")))
    for e in _events(store, run):
        if e.get("kind") in ("review.done", "drift.signal", "lesson.proposed"):
            lines.append("- %s: %s" % (e.get("kind"), _short(e.get("body") or {}, 500)))
    return "\n".join(lines)


def _gen_seals(store: Any, run: str) -> str:
    from .contracts import E_SEAL
    lines = ["# Seals", ""]
    for s in store.query(E_SEAL, run=run):
        lines.append("- %s: %s total %s level %s docked %s" % (s.get("id"), s.get("ledger_state"), s.get("total"),
                                                               s.get("level"), s.get("docked") or ""))
    return "\n".join(lines)


_GENERATED = (
    ("gen-implement", "implement", "Implementation report", "build", _gen_implement, E_UNIT),
    ("gen-tests", "test", "Test report", "tests", _gen_tests, E_ACC_TEST),
    ("gen-qas", "qas", "Deploy and QAS report", "qas", _gen_qas, E_QAS),
    ("gen-questions", "questions", "Questions and decisions", "understand", _gen_questions, None),
    ("gen-decisions", "findings", "Findings and decisions", "review", _gen_decisions, None),
    ("gen-seals", "seal", "Seal ledger", "build", _gen_seals, "seal"),
)


def _has_rows(store: Any, run: str, entity: Optional[str], rid: str) -> bool:
    if entity is not None:
        return bool(store.query(entity, run=run))
    if rid == "gen-questions":
        from .contracts import E_ASSUMPTION, E_QUESTION
        return bool(store.query(E_QUESTION, run=run) or store.query(E_ASSUMPTION, run=run)
                    or any(e.get("kind") == "human.decided" for e in _events(store, run)))
    if rid == "gen-decisions":
        return bool(store.query(E_DECISION, run=run) or store.query(E_ESCALATION, run=run)
                    or any(e.get("kind") in ("review.done", "drift.signal") for e in _events(store, run)))
    return False


def reports(store: Any, run: str) -> List[Dict[str, Any]]:
    row = _run_row(store, run)
    base = "/api/runs/%s/reports/" % run
    out: List[Dict[str, Any]] = []
    for name, path in _pack_files(row):
        try:
            st = os.stat(path)
        except OSError:
            continue
        mime = "application/json" if name.endswith(".json") else ("text/markdown" if name.endswith(".md")
                                                                    else "text/plain")
        rid = "file-" + name
        out.append({"id": rid, "kind": "spec", "title": "Spec: " + name, "node": "understand",
                    "created_ms": int(st.st_mtime * 1000), "mime": mime, "size": int(st.st_size), "url": base + rid})
    for rid, kind, title, node, fn, entity in _GENERATED:
        if not _has_rows(store, run, entity, rid):
            continue
        text = fn(store, run)
        out.append({"id": rid, "kind": kind, "title": title, "node": node, "created_ms": int(row.get("updated_ms") or 0),
                    "mime": "text/markdown", "size": len(text.encode("utf-8")), "url": base + rid})
    return out


def report(store: Any, run: str, rid: str) -> Dict[str, Any]:
    row = _run_row(store, run)
    for meta in reports(store, run):
        if meta["id"] != rid:
            continue
        if rid.startswith("file-"):
            name = rid[5:]
            for n, path in _pack_files(row):
                if n == name:
                    with open(path, encoding="utf-8", errors="replace") as fh:
                        return {"report": meta, "content": fh.read()}
        for gid, _k, _t, _n, fn, _e in _GENERATED:
            if gid == rid:
                return {"report": meta, "content": fn(store, run)}
    raise LineError(codes.NOT_FOUND, "report %s of run %s" % (rid, run), {"run": run, "report": rid})


__all__ = ["nodes", "worklog", "reports", "report", "NODE_IDS"]
