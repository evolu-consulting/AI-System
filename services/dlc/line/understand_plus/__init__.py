"""Understand stage, plus: plan blocks 7 (gaps, assumption register, one human round, addendum vN.k)
and 8 (contradiction detection on a system rule graph). Disabled by default (uplus_enabled /
LINE_UPLUS=1 switches it on); every hook below is then a no-op returning {"status": "off"}.

Who decides (design section 3): a conflicting requirement or a sensitive assumption is decided by a
PERSON. The line parks the run (state record human_park, event run.parked) and asks one batched
round of questions; it never picks an answer or a default itself, also not after the deadline
(reminders only). The confirmation re-read (reader B) does not run contradiction detection.
Exception chosen by the owner (2026-10-11): human_mode="decide" (LINE_HUMAN_MODE=decide) switches human
questions off; the strong model then decides each question and every decision is written to the project
worklog for later review (human.decide_all).

Hook API for pipeline.py (the integrator wires these):

  on_understood(ctx, pv, digest) -> dict
      WHERE: Pipeline._stages, right after `digest = self._digest(pv)` and before `self._tests(...)`.
      ctx: the Pipeline (uses ctx.sstore or ctx.store, ctx.run, ctx.llm, ctx.cfg, ctx.rag).
      Returns {"status": ...}:
        "off"            disabled; go on.
        "ok"             no open question; go on with pv / digest.
        "waiting_human"  questions are open; the run is parked. drive() should stop WITHOUT escalating
                         (leave the run in "understanding", release the run lease) and return; the
                         server route POST /api/runs/{id}/answers resumes it ("resume": true).
                         With uplus_park_scope="f_item", "f_items" lists the only F-items that wait.
        "refrozen"       answers (dry auto mode, or earlier answers) produced addendum vN.k; res["pv"]
                         is the new PackVersion (run.spec_hash already moved). Recompute the digest
                         for res["pv"] (self._digest re-reads, the old digest has the old version)
                         and call on_understood again (bounded: at most 3 rounds).
      Also returns "gaps" / "conflicts" summaries and "questions" (qids asked).

  on_tick(ctx) -> list        WHERE: the watchdog tick / server timer. Reminders for open questions.
  on_green(ctx) -> dict       WHERE: just before run.green. Writes the run's rules to the system
                              rule graph (completion gate R12; mirrored to the RAG System if it can).
  parked(ctx) -> bool         WHERE: Pipeline.drive start; a parked run with open questions returns
                              at once (resume only after answers).
"""

from __future__ import annotations

from typing import Any, Dict, List

from ..contracts import E_PACK, E_RUN, Digest, PackVersion, from_dict
from ._common import (CONFIG_DEFAULTS, NEW_ENTITIES, NEW_EVENT_KINDS, E_PARK, setting)
from .addendum import make_addendum
from .conflicts import commit_rules, detect_conflicts
from .gaps import check_gaps, register
from .human import (answer_question, api_answers, api_questions, ask_round, check_timeouts, decide_all,
                    dry_answer_all, dry_mode, human_mode, is_parked, park, parked_f_items, pending)


def enabled(cfg: Any) -> bool:
    return bool(setting(cfg, "uplus_enabled"))


def _store(ctx: Any) -> Any:
    return getattr(ctx, "sstore", None) or getattr(ctx, "store")


def _rag(ctx: Any) -> Any:
    try:
        return getattr(ctx, "rag", None)
    except Exception:   # noqa: BLE001 - a broken RAG wiring must not stop understanding
        return None


def on_understood(ctx: Any, pv: PackVersion, digest: Digest) -> Dict[str, Any]:
    cfg = getattr(ctx, "cfg", None)
    if not enabled(cfg):
        return {"status": "off"}
    store, run, llm = _store(ctx), ctx.run, ctx.llm
    clock = getattr(ctx, "clock", None)
    if pending(store, run):
        return {"status": "waiting_human", "pv": pv, "questions": [q["qid"] for q in pending(store, run)],
                "f_items": parked_f_items(store, run)}
    out: Dict[str, Any] = {"status": "ok", "pv": pv, "questions": []}
    drafts: List[Dict[str, Any]] = []
    if setting(cfg, "uplus_gaps"):
        g = check_gaps(pv, digest, llm, store=store, run=run, cfg=cfg, clock=clock)
        out["gaps"] = g["summary"]
        drafts += g["questions"]
    if setting(cfg, "uplus_conflicts"):
        c = detect_conflicts(pv, digest, llm, store=store, run=run, rag=_rag(ctx), cfg=cfg, clock=clock)
        out["conflicts"] = c["summary"]
        drafts += c["questions"]
    base = ((store.get(E_RUN, run) or {}).get("detail") or {}).get("spec_hash_base") or pv.version
    if drafts:
        r = ask_round(store, run, drafts, cfg=cfg, clock=clock, pack_version=pv.version, base_version=base)
        out["round"] = {k: r[k] for k in ("round", "asked", "held", "reused", "duplicates", "rejected")}
        out["questions"] = r["asked"] + r["held"]
    open_qs = pending(store, run)
    if open_qs:
        f_items = sorted({f for q in open_qs for f in q.get("f_items") or []})
        park(store, run, f_items=f_items, questions=[q["qid"] for q in open_qs],
             scope=str(setting(cfg, "uplus_park_scope")), pack_version=pv.version,
             reason="human decision needed", cfg=cfg, clock=clock)
        if dry_mode(cfg) == "auto":
            dry_answer_all(store, run, cfg=cfg, clock=clock)
        elif human_mode(cfg) == "decide":         # human questions off: the model decides and records it
            out["decided"] = [{"qid": d["qid"], "option": d["answer"]["option"], "fallback": d["fallback"],
                               "worklog": d["worklog"]} for d in decide_all(store, run, llm, rag=_rag(ctx), cfg=cfg,
                                                                            clock=clock)]
        else:
            out.update({"status": "waiting_human", "f_items": f_items})
            return out
    new_hash = (store.get(E_RUN, run) or {}).get("spec_hash") or (store.get(E_PARK, run) or {}).get("pack_version") or ""
    if new_hash and new_hash != pv.version:
        row = store.get(E_PACK, new_hash)
        if row:
            npv = from_dict(PackVersion, row)
            npv.root = pv.root
            out.update({"status": "refrozen", "pv": npv})
    return out


def on_tick(ctx: Any) -> List[Dict[str, Any]]:
    cfg = getattr(ctx, "cfg", None)
    if not enabled(cfg):
        return []
    return check_timeouts(_store(ctx), getattr(ctx, "run", None) or None, cfg=cfg, clock=getattr(ctx, "clock", None))


def on_green(ctx: Any) -> Dict[str, Any]:
    cfg = getattr(ctx, "cfg", None)
    if not enabled(cfg) or not setting(cfg, "uplus_conflicts"):
        return {"status": "off"}
    return dict(commit_rules(_store(ctx), ctx.run, rag=_rag(ctx), cfg=cfg, clock=getattr(ctx, "clock", None)), status="ok")


def parked(ctx: Any) -> bool:
    cfg = getattr(ctx, "cfg", None)
    return enabled(cfg) and is_parked(_store(ctx), ctx.run) and bool(pending(_store(ctx), ctx.run))


__all__ = ["on_understood", "on_tick", "on_green", "parked", "enabled", "check_gaps", "detect_conflicts",
           "commit_rules", "register", "make_addendum", "ask_round", "answer_question", "check_timeouts",
           "dry_answer_all", "api_questions", "api_answers", "NEW_EVENT_KINDS", "NEW_ENTITIES", "CONFIG_DEFAULTS"]
