"""Eval gate, canary and rollout of lessons (design §8 e4-e9, R7, I32, N5). No human decides.

Lesson status: candidate -> rejected | canary -> active | withdrawn ;  active -> withdrawn | expired

1. offline gate  ``judge(lesson)``
   * holdout: past attempts of OTHER runs (a lesson is never graded on the run it came from)
     whose unit role matches the lesson key: failed attempts with the lesson's code are "relevant",
     verified first attempts are "controls". They are replayed dry: the judge reads the recorded
     inputs (code, fingerprint, failure evidence of the attempt) and says per case whether the
     lesson in the prompt would have helped, been neutral or misled (harm).
   * eval set: small fixed cases kept outside the RAG System (``learn_eval_path``,
     {"canary": "<string>", "cases": [{"id","role","step","stack","input","expected"}]}); a lesson
     containing the canary string means the eval set leaked: reject.
   * judge: LLM role "eval_judge", key = lesson id (fake fixture dry/eval_judge/<lesson id>.json),
     the strongest model and never the distiller's. Code then decides (R1): approve only when the
     judge approves, safety_ok, cites >= 1 known case, no case is harm, and at least half of the
     relevant cases are helped. With no cases at all (cold start) the judge's approval sends the
     lesson to canary with cold_start=True: the canary is the real test.
   Every decision goes to the judge history ("judge" collection, structured, no free text) and
   lesson.judged is emitted.
2. canary  approved -> status canary. ``arm(lesson, run, unit)`` puts each matching unit in "treat"
   (gets the lesson; share learn_canary_ratio) or "control", deterministically and recorded once.
   An active lesson keeps a small holdback arm (learn_holdback_ratio) so harm stays visible.
3. outcome ``record_outcome`` per (lesson, run, unit): success = the unit merged on its first attempt
   (first-pass yield), the lesson's fixed metric.
4. decision ``decide(lesson)`` (two-proportion, one-sided z = 1.645):
     harm      both arms >= learn_harm_min_sample and upper bound of (treat - control) < 0
               -> withdrawn (rollback), at any time, canary or active
     promote   canary, both arms >= learn_min_sample, lower bound > -learn_margin (non-inferior)
               and the point estimate is not below control -> active (published to the RAG System)
     give up   canary, both arms >= learn_max_sample and not promoted -> withdrawn (inconclusive)
5. TTL  ``expire()``: an active lesson not re-proven within learn_ttl_days -> expired.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import E_ATTEMPT, E_UNIT, now_ms
from . import (LESSON_CANARY, LESSON_JUDGED, LESSON_PROMOTED, LESSON_WITHDRAWN, emit, setting)
from .distiller import _env, _models, lint
from .lstore import LearnStore

ROLE = "eval_judge"
Z = 1.645
DAY_MS = 86_400_000

SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["verdict", "cases", "safety_ok"],
    "properties": {
        "verdict": {"type": "string", "enum": ["approve", "reject"]},
        "safety_ok": {"type": "boolean"},
        "reason": {"type": "string"},
        "cases": {"type": "array", "items": {
            "type": "object", "required": ["case", "effect"],
            "properties": {"case": {"type": "string"},
                           "effect": {"type": "string", "enum": ["helps", "neutral", "harm"]}}}},
    },
}

RECORD_TYPE = "lesson"          # RagPort.put_record type of published lessons


# ------------------------------------------------------------------ cases


def _role_of_unit(urow: Optional[Mapping[str, Any]]) -> str:
    if urow is not None and int(urow.get("fixer_gen", 0) or 0) > 0:
        return "fixer"
    return "builder"


def holdout_cases(store: Any, lesson: Mapping[str, Any], limit: int = 8) -> List[Dict[str, Any]]:
    """Held-out past attempts for ``lesson`` from runs other than its source runs (recorded inputs).
    Only build-step lessons have attempts; other keys get no holdout (the eval set covers them)."""
    key = lesson.get("key") or {}
    if key.get("step") not in ("build", "qas", "merge"):
        return []
    exclude = set((lesson.get("provenance") or {}).get("runs") or [])
    units: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for u in store.query(E_UNIT):
        units[(str(u.get("run", "")), str(u.get("id", "")))] = u
    relevant, controls = [], []
    for a in store.query(E_ATTEMPT):
        run = str(a.get("run", ""))
        if not run or run in exclude:
            continue
        urow = units.get((run, str(a.get("unit", ""))))
        if _role_of_unit(urow) != key.get("role"):
            continue
        d = a.get("detail") or {}
        case = {"case": "%s:%s#%s" % (run, a.get("unit"), a.get("n")), "run": run, "unit": a.get("unit"),
                "attempt": a.get("n"), "code": a.get("code", ""), "fingerprint": a.get("fingerprint", ""),
                "outcome": a.get("outcome", ""),
                "input": json.dumps({"unit_title": (urow or {}).get("title", ""),
                                     "claims": (urow or {}).get("claims", []),
                                     "evidence": str(d.get("evidence") or d.get("final") or d.get("reason") or "")[:500]},
                                    sort_keys=True)}
        if a.get("outcome") == "failed" and a.get("code") == lesson.get("code"):
            case["kind"] = "relevant"
            if a.get("fingerprint") and a.get("fingerprint") == lesson.get("fingerprint"):
                relevant.insert(0, case)
            else:
                relevant.append(case)
        elif a.get("outcome") == "verified" and int(a.get("n", 0) or 0) == 1:
            case["kind"] = "control"
            controls.append(case)
    n_rel = max(limit - limit // 4, 1) if controls else limit
    out = relevant[:n_rel]
    return out + controls[:max(limit - len(out), 0)]


def load_eval_set(path: str) -> Dict[str, Any]:
    if not path or not os.path.isfile(path):
        return {"canary": "", "cases": []}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {"canary": "", "cases": []}
    return {"canary": str(data.get("canary", "") or ""), "cases": list(data.get("cases") or [])}


def eval_cases(eval_set: Mapping[str, Any], lesson: Mapping[str, Any], limit: int = 4) -> List[Dict[str, Any]]:
    key = lesson.get("key") or {}
    out = []
    for c in eval_set.get("cases") or []:
        if c.get("role") not in (None, "", key.get("role")):
            continue
        if c.get("step") not in (None, "", key.get("step")):
            continue
        out.append({"case": "eval:%s" % c.get("id"), "kind": "eval", "input": str(c.get("input", ""))[:800],
                    "expected": str(c.get("expected", ""))[:400]})
    return out[:limit]


# ------------------------------------------------------------------ judge


def _prompt(lesson: Mapping[str, Any], cases: Sequence[Mapping[str, Any]]) -> str:
    from ..llm.port import load_prompt
    lines = []
    for c in cases:
        if c["kind"] == "eval":
            lines.append("- case %s [eval]: input: %s | expected: %s" % (c["case"], c["input"], c.get("expected", "")))
        else:
            lines.append("- case %s [%s, outcome %s, code %s]: %s" % (c["case"], c["kind"], c.get("outcome", ""),
                                                                    c.get("code", "") or "-", c["input"]))
    key = lesson.get("key") or {}
    return load_prompt(ROLE, target_role=key.get("role", ""), step=key.get("step", ""), stack=key.get("stack", ""),
                       symptom=lesson.get("symptom", ""), cause=lesson.get("cause", ""), fix=lesson.get("fix", ""),
                       cases="\n".join(lines) or "(no recorded cases)")


def _status(lstore: LearnStore, lid: str, status: str, t: int, **extra: Any) -> Dict[str, Any]:
    return lstore.update("lesson", lid, status=status, status_ms=t, **extra) or {}


def judge(store: Any, llm: Any, lstore: LearnStore, lesson_id: str, cfg: Any = None, *, run: str = "",
          clock_ms: Optional[int] = None) -> Dict[str, Any]:
    """Offline gate for one candidate lesson. Returns the decision record (also stored)."""
    t = int(clock_ms if clock_ms is not None else now_ms())
    lesson = lstore.get("lesson", lesson_id)
    if lesson is None:
        raise LineError(codes.NOT_FOUND, "lesson %s" % lesson_id, {"lesson": lesson_id})
    if lesson.get("status") != "candidate":
        return {"lesson": lesson_id, "verdict": "skip", "status": lesson.get("status")}
    run = run or str((lesson.get("provenance") or {}).get("source_run", "")) or "learn"
    eval_set = load_eval_set(str(setting(cfg, "learn_eval_path")))
    decision: Dict[str, Any] = {"lesson": lesson_id, "ts_ms": t, "verdict": "reject", "reason": "",
                                "cases": 0, "helps": 0, "harm": 0, "relevant": 0, "cold_start": False}
    text = " ".join(str(lesson.get(k, "")) for k in ("symptom", "cause", "fix", "text"))
    problems = lint(text)
    if eval_set["canary"] and eval_set["canary"] in text:
        problems.append("eval set canary string in lesson (holdout leaked)")
    _, j_model = _models(cfg)
    decision["model"] = j_model
    if problems:
        decision["reason"] = "lint: " + "; ".join(problems)[:300]
        return _finish(store, lstore, cfg, lesson, decision, run, t)
    cases = holdout_cases(store, lesson, int(setting(cfg, "learn_holdout_max"))) + eval_cases(eval_set, lesson)
    try:
        ans = llm.complete(ROLE, _prompt(lesson, cases), SCHEMA, key=lesson_id, model=j_model or None, run=run)
    except LineError as e:
        decision.update(verdict="error", reason="judge call failed: %s" % e.code)
        lstore.put("judge", "%s@%d" % (lesson_id, t), decision)
        return decision
    data = ans.data if isinstance(ans.data, Mapping) else {}
    decision["model"] = ans.model or j_model
    known = {c["case"]: c for c in cases}
    effects = {}
    for c in data.get("cases") or []:
        if isinstance(c, Mapping) and str(c.get("case")) in known:
            effects[str(c["case"])] = str(c.get("effect", "neutral"))
    rel = [c for c in cases if c["kind"] in ("relevant", "eval")]
    decision.update(cases=len(cases), relevant=len(rel),
                    helps=sum(1 for c in rel if effects.get(c["case"]) == "helps"),
                    harm=sum(1 for v in effects.values() if v == "harm"),
                    cited=len(effects), unknown_cited=sum(1 for c in data.get("cases") or []
                                                          if isinstance(c, Mapping) and str(c.get("case")) not in known))
    if data.get("verdict") != "approve":
        why = str(data.get("reason") or "").strip()
        decision["reason"] = ("judge rejected: " + why[:300]) if why else "judge rejected"
    elif not data.get("safety_ok", False):
        decision["reason"] = "judge: safety not ok"
    elif decision["harm"]:
        decision["reason"] = "harm on %d case(s)" % decision["harm"]
    elif cases and not effects:
        decision["reason"] = "judge cited no known case"
    elif decision["unknown_cited"]:
        decision["reason"] = "judge cited unknown case ids"
    elif rel and decision["helps"] * 2 < len(rel):
        decision["reason"] = "helps %d of %d relevant cases" % (decision["helps"], len(rel))
    else:
        decision["verdict"] = "approve"
        decision["cold_start"] = not cases
        decision["reason"] = "approved"
    return _finish(store, lstore, cfg, lesson, decision, run, t)


def _finish(store: Any, lstore: LearnStore, cfg: Any, lesson: Mapping[str, Any], decision: Dict[str, Any],
            run: str, t: int) -> Dict[str, Any]:
    lid = lesson["id"]
    lstore.put("judge", "%s@%d" % (lid, t), decision)
    env = _env(store, cfg, run, decision.get("model", ""))
    emit(store, LESSON_JUDGED, env, {k: decision.get(k) for k in
                                     ("lesson", "verdict", "model", "cases", "helps", "harm", "reason")})
    if decision["verdict"] == "approve":
        ratio = float(setting(cfg, "learn_canary_ratio"))
        _status(lstore, lid, "canary", t, judge=decision, canary={"ratio": ratio, "since_ms": t})
        emit(store, LESSON_CANARY, env, {"lesson": lid, "ratio": ratio})
    else:
        _status(lstore, lid, "rejected", t, judge=decision)
    return decision


# ------------------------------------------------------------------ arms and outcomes


def _bucket(lid: str, run: str, unit: str) -> float:
    h = hashlib.sha256(("%s|%s|%s" % (lid, run, unit)).encode("utf-8")).hexdigest()
    return int(h[:8], 16) / float(0xFFFFFFFF)


def arm(lstore: LearnStore, lesson: Mapping[str, Any], run: str, unit: str, cfg: Any = None,
        record: bool = True) -> str:
    """'treat' | 'control' for (lesson, run, unit); "" when the lesson is not being served.
    Stable: the first assignment is recorded and reused."""
    status = lesson.get("status")
    if status not in ("canary", "active"):
        return ""
    aid = "%s|%s|%s" % (lesson["id"], run, unit)
    cur = lstore.get("arm", aid)
    if cur is not None:
        return str(cur.get("arm", ""))
    b = _bucket(lesson["id"], run, unit)
    if status == "canary":
        side = "treat" if b < float(setting(cfg, "learn_canary_ratio")) else "control"
    else:
        side = "control" if b < float(setting(cfg, "learn_holdback_ratio")) else "treat"
    if record:
        lstore.put("arm", aid, {"lesson": lesson["id"], "run": run, "unit": unit, "arm": side,
                                "phase": status, "version": lesson.get("version", 1)})
    return side


def record_outcome(lstore: LearnStore, lesson_id: str, run: str, unit: str, success: bool,
                   detail: Optional[Mapping[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Outcome of a unit that had an arm for the lesson; None when it had none. Idempotent per unit."""
    a = lstore.get("arm", "%s|%s|%s" % (lesson_id, run, unit))
    if a is None:
        return None
    return lstore.put("outcome", "%s|%s|%s" % (lesson_id, run, unit),
                      {"lesson": lesson_id, "run": run, "unit": unit, "arm": a["arm"], "phase": a.get("phase", ""),
                       "success": bool(success), "detail": dict(detail or {})})


def unit_first_pass(store: Any, run: str, unit: str) -> Optional[bool]:
    """True: merged on attempt 1. False: merged later, or failed. None: not final yet."""
    rows = [r for r in store.query(E_UNIT, run=run) if r.get("id") == unit]
    u = rows[0] if rows else {}
    state = u.get("state")
    if state == "merged":
        return int(u.get("attempt", 1) or 1) <= 1
    if state == "failed":
        return False
    return None


# ------------------------------------------------------------------ decisions


def arm_stats(lstore: LearnStore, lesson_id: str, phase: Optional[str] = None) -> Dict[str, Dict[str, float]]:
    out = {"treat": {"n": 0, "ok": 0, "rate": 0.0}, "control": {"n": 0, "ok": 0, "rate": 0.0}}
    for o in lstore.query("outcome", lesson=lesson_id):
        if phase and o.get("phase") != phase:
            continue
        s = out.get(o.get("arm"))
        if s is None:
            continue
        s["n"] += 1
        s["ok"] += 1 if o.get("success") else 0
    for s in out.values():
        s["rate"] = s["ok"] / s["n"] if s["n"] else 0.0
    return out


def bounds(st: Mapping[str, Mapping[str, float]], z: float = Z) -> Tuple[float, float, float]:
    """(diff, lower, upper) of treat rate - control rate (normal approximation, continuity-free)."""
    t, c = st["treat"], st["control"]
    if not t["n"] or not c["n"]:
        return 0.0, -1.0, 1.0
    diff = t["rate"] - c["rate"]
    var = t["rate"] * (1 - t["rate"]) / t["n"] + c["rate"] * (1 - c["rate"]) / c["n"]
    se = math.sqrt(max(var, 0.0)) or (1.0 / math.sqrt(t["n"] + c["n"]))
    return diff, diff - z * se, diff + z * se


def decide(store: Any, lstore: LearnStore, lesson_id: str, cfg: Any = None, *, run: str = "",
           rag: Any = None, clock_ms: Optional[int] = None) -> Dict[str, Any]:
    """Promote / withdraw / keep a canary or active lesson by outcome. Returns {"action", ...}."""
    t = int(clock_ms if clock_ms is not None else now_ms())
    lesson = lstore.get("lesson", lesson_id) or {}
    status = lesson.get("status")
    if status not in ("canary", "active"):
        return {"lesson": lesson_id, "action": "none", "status": status}
    st = arm_stats(lstore, lesson_id, phase=status)
    diff, lo, hi = bounds(st)
    n_min = min(st["treat"]["n"], st["control"]["n"])
    out = {"lesson": lesson_id, "action": "keep", "status": status, "treat": st["treat"],
           "control": st["control"], "diff": round(diff, 4), "lower": round(lo, 4), "upper": round(hi, 4)}
    env = _env(store, cfg, run or str((lesson.get("provenance") or {}).get("source_run", "")) or "learn")
    if n_min >= int(setting(cfg, "learn_harm_min_sample")) and hi < 0:
        out.update(action="withdraw", reason="harm")
    elif status == "canary" and n_min >= int(setting(cfg, "learn_min_sample")) \
            and lo > -float(setting(cfg, "learn_margin")) and diff >= 0:
        out["action"] = "promote"
    elif status == "canary" and n_min >= int(setting(cfg, "learn_max_sample")):
        out.update(action="withdraw", reason="inconclusive")
    if out["action"] == "promote":
        _status(lstore, lesson_id, "active", t, promoted={"ts_ms": t, "treat": st["treat"], "control": st["control"]},
                proven_ms=t)
        emit(store, LESSON_PROMOTED, env, {"lesson": lesson_id, "treat": st["treat"], "control": st["control"]})
        publish(rag, lstore.get("lesson", lesson_id) or {})
    elif out["action"] == "withdraw":
        _status(lstore, lesson_id, "withdrawn", t, withdrawn={"ts_ms": t, "reason": out["reason"],
                                                              "treat": st["treat"], "control": st["control"]})
        emit(store, LESSON_WITHDRAWN, env, {"lesson": lesson_id, "reason": out["reason"],
                                            "treat": st["treat"], "control": st["control"]})
        publish(rag, lstore.get("lesson", lesson_id) or {})
    return out


def expire(store: Any, lstore: LearnStore, cfg: Any = None, *, run: str = "", rag: Any = None,
           clock_ms: Optional[int] = None) -> List[str]:
    """Active lessons not re-proven within learn_ttl_days -> expired. Returns their ids."""
    t = int(clock_ms if clock_ms is not None else now_ms())
    ttl = int(setting(cfg, "learn_ttl_days")) * DAY_MS
    out = []
    for le in lstore.query("lesson", status="active"):
        since = int(le.get("proven_ms") or le.get("status_ms") or le.get("created_ms") or 0)
        if ttl > 0 and t - since > ttl:
            _status(lstore, le["id"], "expired", t)
            emit(store, LESSON_WITHDRAWN, _env(store, cfg, run or "learn"), {"lesson": le["id"], "reason": "ttl"})
            publish(rag, lstore.get("lesson", le["id"]) or {})
            out.append(le["id"])
    return out


def publish(rag: Any, lesson: Mapping[str, Any]) -> bool:
    """Mirror a lesson to the RAG System (put_record "lesson"); False when absent / degraded."""
    if rag is None or not lesson.get("id"):
        return False
    body = {k: lesson.get(k) for k in ("key", "fingerprint", "code", "symptom", "cause", "fix", "text", "status",
                                       "version", "provenance", "metric")}
    body["tags"] = [str((lesson.get("key") or {}).get(k, "")) for k in ("role", "step", "stack")]
    try:
        cur = rag.get_record(RECORD_TYPE, lesson["id"])
        etag = cur[1] if cur else None
        rag.put_record(RECORD_TYPE, lesson["id"], body, if_match=etag,
                       idem_key="lesson:%s:%s:%s" % (lesson["id"], lesson.get("status"), lesson.get("status_ms", "")))
        return True
    except Exception:   # noqa: BLE001 - publishing is best effort
        return False


__all__ = ["ROLE", "SCHEMA", "holdout_cases", "load_eval_set", "eval_cases", "judge", "arm", "record_outcome",
           "unit_first_pass", "arm_stats", "bounds", "decide", "expire", "publish"]
