"""Distiller: a finished run's failures -> candidate lessons (design §8 e1-e3).

1. collect signals from the run's events (code, not model):
     verify.failed      {code, fingerprint, reason, evidence}          role builder|fixer, step build
     escalated          unit or run escalation                          role by code (CODE_KEY)
     unit.blocked       builder ended BLOCKED:<reason>                 builder, build
     unit.requeued      code MERGE_CONFLICT                            builder, merge
     reconcile.diverged reader A/B disagreed                           reader, read
     qas.result         verdict red (builder, qas) / flaky (test_author, qas)
     review.done        the reviewer blocked a verified attempt (ok false, blocking > 0)   builder, review
     REVIEW_KINDS       reviewer / judge decisions, when a slice emits them (body code|verdict, role)
   Units with a cheat flag (TEST_TAMPER anywhere, or unit.detail cheat / holdout_red) give no
   signals (design e3: lessons only from clean units). Infra codes (budget, lease, RAG, cancel)
   are not learnable.
2. group by key (role, step, stack) + fingerprint (the gate fingerprint, else a hash of code and
   the normalised reason). A group whose (key, fingerprint) already has a lesson only adds
   provenance (run, units, evidence) to it: no model call, no duplicate.
3. one model call per (role, step) with the new groups: role "distiller", key "<role>.<step>"
   (fake fixture dry/distiller/<role>.<step>.json). Every lesson must quote evidence = event ids
   of its own group (``<run>:<seq>``); a lesson citing an unknown id, naming a guard / gate code /
   threshold, or telling the agent to touch tests is dropped (lint, design R1 / I22).
4. survivors are stored as status "candidate" (LearnStore "lesson") and lesson.proposed is emitted.
   evalgate decides what happens next. Nothing changes on the run that produced them.

The promised outcome of every lesson is fixed in code (first-pass yield of matching units), never
"fewer error codes" (design N5).
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import E_RUN, E_UNIT, TERMINAL_RUN_STATES, Envelope, now_ms
from . import LESSON_PROPOSED, emit, setting
from .lstore import LearnStore

ROLE = "distiller"
OUTCOME_METRIC = "first_pass_yield"

#: gate code of a reviewer block
REVIEW_BLOCK = codes.REVIEW_BLOCK
#: reviewer / judge decision events of other slices; picked up when present
REVIEW_KINDS = ("review.result", "review.failed", "judge.decision")
REVIEW_BAD = ("reject", "rejected", "fail", "failed", "defects", "wrong")

#: gate code -> (role, step) of the lesson key
CODE_KEY: Dict[str, Tuple[str, str]] = {
    codes.SPEC_MISSING_FILE: ("reader", "ingest"),
    codes.QUOTE_UNMATCHED: ("reader", "read"),
    codes.READ_DIVERGED: ("reader", "read"),
    codes.TEST_GREEN_ON_EMPTY: ("test_author", "author"),
    codes.TEST_UNTRACED: ("test_author", "author"),
    codes.GRAPH_CYCLE: ("planner", "plan"),
    codes.UNIT_TOO_BIG: ("planner", "plan"),
    codes.CLAIM_VIOLATION: ("builder", "build"),
    codes.BUILD_FAIL: ("builder", "build"),
    codes.TEST_FAIL: ("builder", "build"),
    codes.NO_PROGRESS: ("builder", "build"),
    codes.SECRET_FOUND: ("builder", "build"),
    codes.BLOCKED: ("builder", "build"),
    codes.SCHEMA_INVALID: ("builder", "build"),
    codes.MERGE_CONFLICT: ("builder", "merge"),
    codes.SMOKE_FAIL: ("builder", "deploy"),
    codes.QAS_RED: ("builder", "qas"),
    codes.FLAKY: ("test_author", "qas"),
}

#: not learnable: infrastructure / control-plane outcomes
NOT_LEARNABLE = frozenset({codes.BUDGET_EXCEEDED, codes.LEASE_LOST, codes.RAG_DEGRADED, codes.CANCELLED,
                           codes.LLM_ERROR, codes.ENVELOPE_INVALID, codes.UNKNOWN_KIND,
                           codes.ILLEGAL_TRANSITION, codes.STATE_CONFLICT, codes.NOT_FOUND,
                           codes.VERSION_CONFLICT, codes.PRECONDITION_REQUIRED, codes.CONFIG_INVALID})
CHEAT_CODES = frozenset({codes.TEST_TAMPER})

MAX_GROUPS_PER_CALL = 6
MAX_SIGNALS_PER_GROUP = 5
MAX_EVIDENCE = 20

SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["lessons"],
    "properties": {
        "lessons": {"type": "array", "items": {
            "type": "object",
            "required": ["fingerprint", "symptom", "fix", "evidence"],
            "properties": {
                "fingerprint": {"type": "string"},
                "symptom": {"type": "string"},
                "cause": {"type": "string"},
                "fix": {"type": "string"},
                "evidence": {"type": "array", "items": {"type": "string"}},
                "cause_inferred": {"type": "boolean"},
            }}},
    },
}

# ------------------------------------------------------------------ lint / scrub

_BANNED_WORDS = ("verifier", "guard", "fingerprint", "quarantin", "locked test", "skiptest", "@skip",
                 "unittest.skip", "xfail", "expectedfailure", "edit the test", "change the test",
                 "modify the test", "delete the test", "remove the test", "disable the test",
                 "bypass", "plan-vs-diff", "retry ladder", "threshold", "budget")
_SECRET_RX = [
    re.compile(r"(?i)\b(api[_-]?key|secret|token|password|passwd|client[_-]?secret)\b\s*[:=]\s*\S+"),
    re.compile(r"\b[A-Za-z0-9+/_\-]{32,}={0,2}\b"),
]


def scrub(text: str) -> str:
    """Mask secret-looking values before a lesson is stored or published (design e1 / I11)."""
    out = str(text or "")
    out = _SECRET_RX[0].sub(lambda m: m.group(1) + "=***", out)
    return _SECRET_RX[1].sub("***", out)


def lint(text: str) -> List[str]:
    """Problems of a lesson text: names a gate code, a guard / verifier / threshold, or tells the
    agent to touch tests. A lesson must teach the work, not how to pass the checks (design I22)."""
    low = (text or "").lower()
    bad = ["names gate code %s" % c for c in sorted(codes.ALL_CODES) if c in (text or "")]
    bad += ["mentions %r" % w for w in _BANNED_WORDS if w in low]
    return bad


# ------------------------------------------------------------------ signals


def event_id(run: str, seq: int) -> str:
    return "%s:%d" % (run, int(seq))


def _norm(text: str) -> str:
    t = (text or "").strip().splitlines()[0] if (text or "").strip() else ""
    t = re.sub(r"[0-9a-f]{7,}", "#", t.lower())
    t = re.sub(r"\d+", "#", t)
    return re.sub(r"\s+", " ", t)[:160]


def fingerprint_of(code: str, fingerprint: str = "", reason: str = "") -> str:
    if fingerprint:
        return str(fingerprint)
    return hashlib.sha1(("%s|%s" % (code, _norm(reason))).encode("utf-8")).hexdigest()[:16]


def lesson_id(role: str, step: str, stack: str, fingerprint: str) -> str:
    return "L-" + hashlib.sha1(("%s|%s|%s|%s" % (role, step, stack, fingerprint)).encode("utf-8")).hexdigest()[:12]


def _units(store: Any, run: str) -> Dict[str, Dict[str, Any]]:
    return {u["id"]: u for u in store.query(E_UNIT, run=run)}


def _role_for(code: str, unit: Optional[Mapping[str, Any]]) -> Tuple[str, str]:
    role, step = CODE_KEY.get(code, ("builder", "build"))
    if unit is not None and int(unit.get("fixer_gen", 0) or 0) > 0 and role == "builder":
        role = "fixer"
    return role, step


def collect_signals(store: Any, run: str, stack: str = "python") -> List[Dict[str, Any]]:
    """The run's learnable failure signals, in event order (see module doc)."""
    units = _units(store, run)
    events = store.events_after(0, run=run, limit=100000)
    cheat = {u for u, row in units.items()
             if (row.get("detail") or {}).get("cheat") or (row.get("detail") or {}).get("holdout_red")}
    for ev in events:
        if str(ev.body.get("code", "")) in CHEAT_CODES and ev.env.unit:
            cheat.add(ev.env.unit)
    out: List[Dict[str, Any]] = []

    def add(ev: Any, code: str, reason: str, fp: str = "", role_step: Optional[Tuple[str, str]] = None,
            unit: str = "") -> None:
        unit = unit or ev.env.unit
        if not code or code in NOT_LEARNABLE or code in CHEAT_CODES or (unit and unit in cheat):
            return
        role, step = role_step or _role_for(code, units.get(unit))
        out.append({"id": event_id(run, ev.seq), "kind": ev.kind, "code": code, "unit": unit,
                    "attempt": ev.env.attempt, "model": ev.env.model, "role": role, "step": step, "stack": stack,
                    "fingerprint": fingerprint_of(code, fp, reason), "text": scrub(reason)[:600],
                    "ts_ms": ev.ts_ms})

    for ev in events:
        b = ev.body or {}
        if ev.kind == codes.VERIFY_FAILED:
            add(ev, str(b.get("code", "")), "%s %s" % (b.get("reason", ""), b.get("evidence", "")),
                str(b.get("fingerprint", "")))
        elif ev.kind == codes.ESCALATED:
            code = str(b.get("code", ""))
            if code == codes.CANCELLED:
                continue
            reason = str(b.get("reason") or b.get("message") or "")
            add(ev, str(b.get("failure_code") or code), reason, str(b.get("fingerprint", "")))
        elif ev.kind == codes.UNIT_BLOCKED:
            add(ev, codes.BLOCKED, str(b.get("reason", "")))
        elif ev.kind == codes.UNIT_REQUEUED and b.get("code") == codes.MERGE_CONFLICT:
            add(ev, codes.MERGE_CONFLICT, str(b.get("why") or b.get("reason") or ""))
        elif ev.kind == codes.RECONCILE_DIVERGED:
            fields = b.get("fields") or []
            paths = ",".join(sorted(str(f.get("path", "")) for f in fields if isinstance(f, Mapping)))
            add(ev, codes.READ_DIVERGED, "readers diverged on %s" % paths)
        elif ev.kind == codes.QAS_RESULT and b.get("verdict") in ("red", "flaky"):
            code = codes.FLAKY if b.get("verdict") == "flaky" else codes.QAS_RED
            tests = b.get("quarantined") if code == codes.FLAKY else b.get("failing")
            add(ev, code, "%s %s on QAS: %s" % (b.get("f_item", ""), b.get("verdict"), ",".join(tests or [])))
        elif ev.kind == codes.REVIEW_DONE:
            # the clean-context reviewer blocked a verified attempt (line.review emits review.done)
            if b.get("ok") is False and int(b.get("blocking") or 0) > 0:
                add(ev, REVIEW_BLOCK, "review blocked: %s finding(s) %s" % (b.get("blocking"), b.get("summary") or ""),
                    str(b.get("fingerprint", "")), ("builder", "review"))
        elif ev.kind in REVIEW_KINDS:
            verdict = str(b.get("verdict", "")).lower()
            code = str(b.get("code", ""))
            if not code and verdict not in REVIEW_BAD:
                continue
            role = str(b.get("role") or "builder")
            add(ev, code or codes.BUILD_FAIL, str(b.get("reason") or b.get("summary") or verdict),
                str(b.get("fingerprint", "")), (role, str(b.get("step") or "review")))
    return out


def group_signals(signals: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """[{key: {role, step, stack}, fingerprint, code, signals: [...], units: [...]}] in first-seen order."""
    groups: Dict[Tuple[str, str, str, str], Dict[str, Any]] = {}
    for s in signals:
        k = (s["role"], s["step"], s["stack"], s["fingerprint"])
        g = groups.get(k)
        if g is None:
            g = groups[k] = {"key": {"role": s["role"], "step": s["step"], "stack": s["stack"]},
                             "fingerprint": s["fingerprint"], "code": s["code"], "signals": [], "units": []}
        g["signals"].append(dict(s))
        if s.get("unit") and s["unit"] not in g["units"]:
            g["units"].append(s["unit"])
    return list(groups.values())


# ------------------------------------------------------------------ distil


def _prompt(run: str, role: str, step: str, stack: str, groups: Sequence[Mapping[str, Any]]) -> str:
    from ..llm.port import load_prompt
    blocks = []
    for g in groups:
        lines = ["### fingerprint %s (code %s)" % (g["fingerprint"], g["code"])]
        for s in g["signals"][:MAX_SIGNALS_PER_GROUP]:
            lines.append("- event %s [%s unit=%s attempt=%s]: %s" % (s["id"], s["kind"], s["unit"] or "-",
                                                                    s["attempt"], s["text"]))
        blocks.append("\n".join(lines))
    return load_prompt(ROLE, run=run, target_role=role, step=step, stack=stack, groups="\n\n".join(blocks))


def _render(lesson: Mapping[str, Any]) -> str:
    return "%s -> %s" % (str(lesson.get("symptom", "")).strip().rstrip("."), str(lesson.get("fix", "")).strip())


def _models(cfg: Any) -> Tuple[str, str]:
    """(distiller model, judge model): the judge is the strongest model and never the distiller's."""
    main = str(getattr(cfg, "model", "") or "")
    alt = str(getattr(cfg, "model_alt", "") or "") or main
    distiller = str(setting(cfg, "learn_distiller_model") or alt)
    judge = str(setting(cfg, "learn_judge_model") or main)
    if judge == distiller and alt and main and alt != main:
        judge = main if distiller != main else alt
    return distiller, judge


def _env(store: Any, cfg: Any, run: str, model: str = "") -> Envelope:
    row = store.get(E_RUN, run) or {}
    return Envelope(run=run, agent_version=str(getattr(cfg, "agent_version", "") or ""), model=model,
                    spec_hash=str(row.get("spec_hash", "") or ""))


def distil(store: Any, llm: Any, lstore: LearnStore, run: str, cfg: Any = None, *,
           clock_ms: Optional[int] = None) -> Dict[str, Any]:
    """Distil the finished run ``run``. Returns {"proposed": [lesson ids], "merged": [lesson ids],
    "dropped": [{"fingerprint", "why"}], "signals": n}. A run that is not final -> nothing."""
    row = store.get(E_RUN, run) or {}
    res: Dict[str, Any] = {"proposed": [], "merged": [], "dropped": [], "signals": 0}
    if row.get("state") not in TERMINAL_RUN_STATES:
        res["skipped"] = "run not final"
        return res
    stack = str(setting(cfg, "learn_stack"))
    t = int(clock_ms if clock_ms is not None else now_ms())
    signals = collect_signals(store, run, stack)
    res["signals"] = len(signals)
    units = _units(store, run)
    merged_units = {u for u, r in units.items() if r.get("state") == "merged"}
    fresh: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for g in group_signals(signals):
        k = g["key"]
        lid = lesson_id(k["role"], k["step"], k["stack"], g["fingerprint"])
        cur = lstore.get("lesson", lid)
        if cur is not None:
            prov = dict(cur.get("provenance") or {})
            runs = list(prov.get("runs") or [])
            if run not in runs:
                runs.append(run)
                prov["runs"] = runs
                prov["units"] = sorted(set(prov.get("units") or []) | {"%s:%s" % (run, u) for u in g["units"]})
                ev = list(cur.get("evidence") or []) + [s["id"] for s in g["signals"]]
                lstore.update("lesson", lid, provenance=prov, evidence=ev[:MAX_EVIDENCE],
                              seen=int(cur.get("seen", 1)) + 1, last_seen_ms=t)
                res["merged"].append(lid)
            continue
        fresh.setdefault((k["role"], k["step"]), []).append(g)
    if not fresh:
        return res
    d_model, _ = _models(cfg)
    for (role, step), groups in fresh.items():
        for i in range(0, len(groups), MAX_GROUPS_PER_CALL):
            chunk = groups[i:i + MAX_GROUPS_PER_CALL]
            by_fp = {g["fingerprint"]: g for g in chunk}
            try:
                ans = llm.complete(ROLE, _prompt(run, role, step, stack, chunk), SCHEMA,
                                   key="%s.%s" % (role, step), model=d_model or None, run=run)
            except LineError as e:
                res["dropped"].extend({"fingerprint": fp, "why": "llm:" + e.code} for fp in by_fp)
                continue
            data = ans.data if isinstance(ans.data, Mapping) else {}
            for le in data.get("lessons") or []:
                if not isinstance(le, Mapping):
                    continue
                fp = str(le.get("fingerprint", ""))
                g = by_fp.get(fp)
                if g is None:
                    res["dropped"].append({"fingerprint": fp, "why": "unknown fingerprint"})
                    continue
                ids = {s["id"] for s in g["signals"]}
                ev = [str(x) for x in (le.get("evidence") or [])]
                if not ev or any(x not in ids for x in ev):
                    res["dropped"].append({"fingerprint": fp, "why": "evidence not in group",
                                           "evidence": ev})
                    continue
                text = scrub(_render(le))
                problems = lint(text + " " + str(le.get("cause", "")))
                if problems:
                    res["dropped"].append({"fingerprint": fp, "why": "lint", "problems": problems})
                    continue
                k = g["key"]
                lid = lesson_id(k["role"], k["step"], k["stack"], fp)
                if lstore.get("lesson", lid) is not None:
                    continue
                verified = any(u in merged_units for u in g["units"]) and row.get("state") == "green"
                lesson = {
                    "key": dict(k), "fingerprint": fp, "code": g["code"],
                    "symptom": scrub(str(le.get("symptom", "")))[:400], "cause": scrub(str(le.get("cause", "")))[:400],
                    "fix": scrub(str(le.get("fix", "")))[:600], "text": text[:800],
                    "evidence": ev[:MAX_EVIDENCE],
                    "cause_inferred": bool(le.get("cause_inferred", not verified)),
                    "provenance": {"source_run": run, "runs": [run],
                                   "units": ["%s:%s" % (run, u) for u in g["units"]],
                                   "fix_verified": verified, "distiller_model": ans.model or d_model},
                    "metric": OUTCOME_METRIC, "status": "candidate", "version": 1, "seen": 1,
                    "created_ms": t, "last_seen_ms": t, "usd": float(ans.usd or 0.0),
                }
                lstore.put("lesson", lid, lesson)
                emit(store, LESSON_PROPOSED, _env(store, cfg, run, ans.model or d_model),
                     {"lesson": lid, "key": dict(k), "fingerprint": fp, "evidence": ev[:MAX_EVIDENCE]})
                res["proposed"].append(lid)
                by_fp.pop(fp, None)
            for fp in by_fp:
                if fp not in {d.get("fingerprint") for d in res["dropped"]}:
                    res["dropped"].append({"fingerprint": fp, "why": "no lesson proposed"})
    return res


__all__ = ["ROLE", "SCHEMA", "CODE_KEY", "REVIEW_KINDS", "collect_signals", "group_signals", "distil",
           "lesson_id", "lint", "scrub", "fingerprint_of", "event_id"]
