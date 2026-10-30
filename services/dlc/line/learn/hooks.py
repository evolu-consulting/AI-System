"""Integration points of the learning loop. All no-ops unless ``learn_enabled`` is on.

ctx is anything with ``store``, ``cfg``, ``llm`` and (optionally) ``rag`` attributes, e.g. the
Pipeline itself. Neither hook ever raises.

on_prompt(ctx, role, step, run, unit="", stack=None, query="") -> str
    Where: Pipeline._context(role, step) (today it calls rag.retrieve directly); for builder /
    fixer prompts pass the unit id so canary arms apply, and the situation in words as query. Returns the lessons block (local lessons +
    RagPort.retrieve within learn_serve_max_chars), "" when disabled or nothing matches. Replaces
    the direct retrieve call; when disabled the caller keeps its old behaviour.

on_run_end(ctx, run) -> dict
    Where: pipeline.drive, in the finally block after _finish() (the run is terminal). Order:
      1. outcomes: every unit of the run with a lesson arm -> record_outcome (first-pass yield)
      2. decide(): promote / withdraw (rollback on harm) every canary and active lesson
      3. expire(): TTL
      4. distil(): new candidate lessons from this run
      5. judge(): offline gate for every candidate (-> canary or rejected)
    Lessons only change what LATER runs are served; nothing on the finished run changes.
    Returns {"outcomes", "decisions", "expired", "distilled", "judged"}.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..contracts import E_UNIT
from . import setting
from .distiller import distil
from .evalgate import decide, expire, judge, record_outcome, unit_first_pass
from .lstore import LearnStore
from .serve import serve_lessons

_STORES: Dict[str, LearnStore] = {}


def learn_store(ctx: Any) -> LearnStore:
    """ctx.learn_store when set, else one LearnStore per configured path (shared in the process)."""
    ls = getattr(ctx, "learn_store", None)
    if isinstance(ls, LearnStore):
        return ls
    from .lstore import default_path
    path = default_path(getattr(ctx, "cfg", None))
    if path not in _STORES:
        _STORES[path] = LearnStore(path)
    return _STORES[path]


def _rag(ctx: Any) -> Any:
    try:
        return getattr(ctx, "rag", None)
    except Exception:   # noqa: BLE001 - a lazily built RAG port may fail to build
        return None


def on_prompt(ctx: Any, role: str, step: str, run: str, unit: str = "", stack: Optional[str] = None,
              query: str = "") -> str:
    cfg = getattr(ctx, "cfg", None)
    if not setting(cfg, "learn_enabled"):
        return ""
    try:
        sv = serve_lessons(learn_store(ctx), role, step, stack or str(setting(cfg, "learn_stack")), run=run,
                           unit=unit, rag=_rag(ctx), cfg=cfg, query=query)
        return sv.text
    except Exception:   # noqa: BLE001 - serving is best effort
        return ""


def on_run_end(ctx: Any, run: str) -> Dict[str, Any]:
    cfg = getattr(ctx, "cfg", None)
    if not setting(cfg, "learn_enabled"):
        return {}
    out: Dict[str, Any] = {"outcomes": 0, "decisions": [], "expired": [], "distilled": {}, "judged": []}
    try:
        store, ls, rag = ctx.store, learn_store(ctx), _rag(ctx)
        for u in store.query(E_UNIT, run=run):
            ok = unit_first_pass(store, run, u["id"])
            if ok is None:
                continue
            for a in ls.query("arm", run=run, unit=u["id"]):
                if record_outcome(ls, a["lesson"], run, u["id"], ok, {"attempt": u.get("attempt", 0)}) is not None:
                    out["outcomes"] += 1
        for le in ls.query("lesson"):
            if le.get("status") in ("canary", "active"):
                d = decide(store, ls, le["id"], cfg, run=run, rag=rag)
                if d["action"] != "keep":
                    out["decisions"].append(d)
        out["expired"] = expire(store, ls, cfg, run=run, rag=rag)
        llm = getattr(ctx, "llm", None)
        if llm is not None:
            out["distilled"] = distil(store, llm, ls, run, cfg)
            for le in ls.query("lesson", status="candidate"):
                out["judged"].append(judge(store, llm, ls, le["id"], cfg, run=run))
            from .. import outcomes                # what the distiller and the judge did, for the retro
            dist = out["distilled"] or {}
            if dist.get("proposed") or dist.get("merged") or dist.get("dropped"):
                outcomes.record(store, run, "distiller", signals=dist.get("signals"),
                                proposed=len(dist.get("proposed") or []), merged=len(dist.get("merged") or []),
                                dropped=dist.get("dropped") or [])
            judged = [j for j in out["judged"] if isinstance(j, dict) and j.get("verdict") in ("approve", "reject")]
            if judged:
                outcomes.record(store, run, "eval_judge", decisions=[
                    {k: j.get(k) for k in ("lesson", "verdict", "reason", "cases", "helps", "harm", "cold_start")}
                    for j in judged])
    except Exception as e:   # noqa: BLE001 - the learning loop never breaks a run
        out["error"] = "%s: %s" % (type(e).__name__, e)
    return out


__all__ = ["on_prompt", "on_run_end", "learn_store"]
