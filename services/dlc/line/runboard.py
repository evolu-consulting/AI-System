"""The run board: the latest status of every step of a run, in knowledge store, read by the agents of the next steps.

A run's agents worked from their own prompt only: a test author invented a helper module the planner never
heard of, a supervised re-run wrote the tests and the plan again from scratch, and nobody saw what an earlier
step had settled. Now every step leaves ONE card with its latest status in the run's knowledge store project, and every
agent call of the run starts with the board (and with the board of the run it retries):

    post(pipe, "tests", "done", "3 tests locked; they use NotesApp/client/noteSelect.js", facts={...})
    text = section(run, role)          # "## Run board" + "## Messages for <role>", for the prompt

knowledge store layout (entity cards, idempotent by project + name, so a card is REPLACED, never duplicated):
    "run <id>"               role: the run's state line; relations has_step -> every step card, retry_of -> run
    "run <id> step <step>"   role: the status line;  purpose: what the step settled (decisions, files, ids)
The engine keeps the same board on the run row (detail.board): agents get it from there in every prompt, knowledge store
holds it for people, other sessions and later runs. knowledge store off or down: the local board still works.

Messages between agents go through the project's message stack, never person to person: one message to
'all' of the project, its content tagged with the roles it is for ("@planner @builder ..."), kind and task_id
= the run (line.agent_messages). The engine is their only reader and hands each role the messages tagged for it
in the step it is working on, once.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from .contracts import E_RUN, now_ms
from .statemachine import update_row

STEPS = ("understand", "tests", "plan", "build", "merge", "qas", "result")
TITLE = {"understand": "Understand the spec", "tests": "Acceptance tests", "plan": "Plan", "build": "Build",
         "merge": "Merge", "qas": "Deploy and test (QAS)", "result": "Result"}
MAX_DETAIL = 1500
MAX_SECTION = 5000

_lock = threading.Lock()
#: run -> (store, cfg, knowledge store project): set by the pipeline for the runs it drives (line.llm.caps reads it)
_RUNS: Dict[str, tuple] = {}


def register(run: str, store: Any, cfg: Any, project: str) -> None:
    with _lock:
        _RUNS[run] = (store, cfg, project)


def unregister(run: str) -> None:
    with _lock:
        _RUNS.pop(run, None)


def _ctx(run: str) -> Optional[tuple]:
    with _lock:
        return _RUNS.get(run)


def card_name(run: str, step: str = "") -> str:
    return "run %s step %s" % (run, step) if step else "run %s" % run


def _kh(cfg: Any, body: Dict[str, Any]) -> None:
    from . import agent_memory
    if not agent_memory.enabled(cfg):
        return
    try:
        agent_memory._call(cfg, "POST", "/entities", body)
    except Exception:   # noqa: BLE001 - knowledge store down: the local board still works
        pass


def board(store: Any, run: str) -> Dict[str, Any]:
    return dict(((store.get(E_RUN, run) or {}).get("detail") or {}).get("board") or {})


def post(store: Any, cfg: Any, project: str, run: str, step: str, status: str, detail: str = "",
         facts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Replace the card of one step (local + knowledge store). status: a short word line (done, failed: ..., running)."""
    card = {"step": step, "status": str(status)[:200], "detail": str(detail or "")[:MAX_DETAIL],
            "facts": dict(facts or {}), "ms": now_ms()}
    row = store.get(E_RUN, run) or {}
    d = dict(row.get("detail") or {})
    b = dict(d.get("board") or {})
    b[step] = card
    d["board"] = b
    update_row(store, E_RUN, run, {"detail": d})
    if project:
        rels = [{"rel": "part_of", "target": card_name(run)}]
        _kh(cfg, {"project": project, "name": card_name(run, step), "type": "other",
                  "role": "%s: %s" % (TITLE.get(step, step), card["status"]), "purpose": card["detail"] or card["status"],
                  "relations": rels})
        run_rels = [{"rel": "has_step", "target": card_name(run, step)}]
        if d.get("retry_of"):
            run_rels.append({"rel": "retry_of", "target": card_name(str(d["retry_of"]))})
        _kh(cfg, {"project": project, "name": card_name(run), "type": "other",
                  "role": "%s · %s" % (d.get("name") or run, row.get("state") or ""),
                  "purpose": "Delivery run %s (%s). Latest step: %s %s" % (run, d.get("flow") or "", step, card["status"]),
                  "relations": run_rels})
    return card


def _lines(store: Any, run: str, head: str) -> List[str]:
    b = board(store, run)
    if not b:
        return []
    out = [head]
    for s in STEPS:
        c = b.get(s)
        if not c:
            continue
        out.append("- %s: %s" % (TITLE.get(s, s), c.get("status")))
        if c.get("detail"):
            out.extend("    " + ln for ln in str(c["detail"]).splitlines()[:12])
    return out


def text(store: Any, run: str) -> str:
    """The board of the run, then the boards of the runs it retries (newest first, at most two back)."""
    lines = _lines(store, run, "## Run board (the latest status of every step of this run; continue from it, "
                               "never redo a settled step)")
    seen, prev = {run}, str(((store.get(E_RUN, run) or {}).get("detail") or {}).get("retry_of") or "")
    n = 0
    while prev and prev not in seen and n < 2:
        seen.add(prev)
        lines += _lines(store, prev, "## Board of the earlier attempt %s (this run tries the same request again: "
                                     "keep what it settled, avoid what failed)" % prev)
        prev = str(((store.get(E_RUN, prev) or {}).get("detail") or {}).get("retry_of") or "")
        n += 1
    s = "\n".join(lines)
    return s[:MAX_SECTION]


def section(run: str, role: str) -> str:
    """What every agent call of `run` gets at the end of its prompt: the board, then its messages."""
    ctx = _ctx(run)
    if not run or ctx is None:
        return ""
    store, cfg, project = ctx
    parts = []
    try:
        b = text(store, run)
        if b:
            parts.append(b)
        from . import agent_messages
        m = agent_messages.deliver(store, cfg, project, run, role)
        if m:
            parts.append(m)
    except Exception:   # noqa: BLE001 - the board helps; it never fails a call
        return ""
    return ("\n\n" + "\n\n".join(parts)) if parts else ""


__all__ = ["STEPS", "register", "unregister", "card_name", "board", "post", "text", "section"]
