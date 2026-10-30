"""Precedents: the decisions PEOPLE took at gates, kept per PROJECT and per KIND of decision (spec sign-off, plan
approval, final review ...), never per process or version: the same process in two projects learns different
things, and changing or retiring a process loses none of them. An automatic decision is never a precedent (the
system must not teach itself from its own guesses).

A gate may auto-approve (docs/flow-enhance_bugfix.html, "Auto-approve"): before parking for a person, an agent
checks whether the case is SIMPLE by the business's own criteria (data of the gate) AND people approved enough
similar cases in this project before. Both -> the run goes on with a logged automatic decision; otherwise it waits.

    record(store, run_row, gate, kind, decision, ...)   in the engine store (contracts.E_PRECEDENT)
    of(store, project, kind) -> [precedent]             newest last
    project_of(detail) -> the project key of a run
    auto(pipe, definition, gate, docs) -> {"decision", "reason"} | None
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from ..contracts import E_PRECEDENT, now_ms

MAX_CASE = 1500
MAX_SHOWN = 8
_AUTO = re.compile(r"^\s*AUTO:\s*(yes|no)\s*\|?(.*)$", re.I | re.M)


def project_of(detail: Dict[str, Any]) -> str:
    return str(detail.get("project") or detail.get("rag_project") or "default")


def kind_of(gate: Dict[str, Any]) -> str:
    return str((gate.get("auto") or {}).get("kind") or gate.get("kind") or gate.get("name") or "")


def record(store: Any, detail: Dict[str, Any], run: str, gate: Dict[str, Any], decision: str, note: str, by: str,
           case: str, process_ref: str) -> str:
    project = project_of(detail)
    kind = kind_of(gate)
    n = len(store.query(E_PRECEDENT, project=project, kind=kind)) + 1
    pid = "%s:%s:%d" % (project, kind, n)
    store.put(E_PRECEDENT, pid, {"id": pid, "project": project, "kind": kind, "gate": gate.get("name"),
                                 "decision": decision, "note": note[:600], "by": by, "run": run, "ms": now_ms(),
                                 "case": case[:MAX_CASE], "process": process_ref,
                                 "passed": decision in (gate.get("pass") or [])}, run=run)
    return pid


def of(store: Any, project: str, kind: str) -> List[Dict[str, Any]]:
    return store.query(E_PRECEDENT, project=project, kind=kind)


def auto(pipe: Any, definition: Any, gate: Dict[str, Any], docs: str, case: str) -> Optional[Dict[str, Any]]:
    """The gate's auto-approve check, or None when it does not apply / says no. Never raises."""
    cfg = gate.get("auto") or {}
    if not cfg or not cfg.get("criteria"):
        return None
    from .checks import render
    from ..contracts import E_RUN
    detail = (pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}
    approved = [p for p in of(pipe.store, project_of(detail), kind_of(gate))      # other runs only: a run never
                if p.get("passed") and p.get("run") != pipe.run]                  # approves itself
    if len(approved) < int(cfg.get("min_precedents", 1)):
        return None
    shown = approved[-MAX_SHOWN:]
    prompt = render(definition.prompt(str(cfg.get("prompt") or "auto_approve")), {
        "criteria": str(cfg["criteria"]), "gate_title": gate.get("title") or gate.get("name"),
        "precedents": "\n\n".join("PRECEDENT %s (decided %s by %s): %s\nNOTE: %s" % (
            p["id"], p["decision"], p["by"], p.get("case") or "", p.get("note") or "-") for p in shown),
        "case": case[:MAX_CASE], "documents": docs})
    try:
        res = pipe.llm.agentic(str(cfg.get("role") or "reviewer"), pipe.workdir, prompt,
                               int(cfg.get("max_turns") or 10), float(cfg.get("usd") or 0.3),
                               key="auto-%s#%d" % (gate.get("name"), len(approved)), run=pipe.run)
    except Exception:   # noqa: BLE001 - a failed check means a person decides
        return None
    finally:
        try:
            pipe._charge_stage()
        except Exception:   # noqa: BLE001
            pass
    m = _AUTO.search(str(getattr(res, "text", "") or ""))
    if not m or m.group(1).lower() != "yes":
        return None
    decision = str(cfg.get("decision") or (gate.get("pass") or [""])[0])
    return {"decision": decision, "reason": m.group(2).strip()[:600] or "simple and approved before",
            "precedents": [p["id"] for p in shown], "usd": round(float(getattr(res, "usd", 0) or 0), 4)}


__all__ = ["record", "of", "auto", "project_of", "kind_of"]
