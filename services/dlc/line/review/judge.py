"""Strong-model judge + decision log (block 14, the §6 part: an agent drifts or does the wrong thing
without crashing). No human in this loop: the spec is frozen, so the frozen spec is the only
authority and the judge decides against it.

decide_drift(ctx, unit, case)   the drift ladder reached its judge step
                                options: continue | redirect | reset | stop
decide_dispute(ctx, unit, res)  the reviewer still blocks after review_max_rounds (reviewer vs builder)
                                options: builder (overrule, unit proceeds) | fix (send back with the
                                judge's instructions) | stop

Rules enforced in code (the model cannot talk past them):
  * judge_model (default claude-opus-5-5) via LlmPort role "judge"; the judge sees only the frozen
    spec spans of the unit's F-items, a code-built case (signals / findings, never the builder's
    conversation) and the structured history of past decisions of the same kind with their grades.
  * quote gate: >= 1 quote that is literally in a unit span, else the decision is rejected -> stop.
  * safety: an answer whose instructions would touch a locked acceptance test, skip / delete /
    edit tests, loosen a guard or touch credentials is rejected -> stop.
  * spec_gap=true (the spec truly does not say) -> stop with route "spec_question": the one case
    that leaves §6 (it belongs to the conflicting-requirements path, outside this slice).
  * at most judge_max_decisions decisions per unit per run; then stop without a model call.
  * a model / transport error -> stop (conservative), recorded as rejected.

Decision log (sổ quyết định): every decision is a structured record written by code
{id, run, unit, f_items, spec_hash, kind, case, options, choice, rationale, quotes, instructions,
 expect, model, judge_version, same_model_as_builder, status, ts_ms, ...}; status
pending -> right | wrong | unattributable, or rejected (never graded). Backend: the Store entity
"decision" (contracts.E_DECISION) when a store is given, else a JSON file
(decision_log setting, default <workroot>/decision_log.json). Decisions persist across runs.

Later-run grading (code rules, grade_after_qas):
  pending decisions of this spec (same spec_hash; any earlier run too) whose F-items are in the
  QAS report:  any F-item flaky -> not graded (stays pending, unattributable at run end);
  choice stop -> unattributable;  unit of this run not merged yet -> stays pending;
  all F-items green -> right;  any red -> wrong + rollback.
Rollback: the decision is marked wrong and fixer evidence is built (failing tests, the decision,
its quotes and the overruled findings) -> GradeResult.fixer_evidence[f_item];
attach_fixer_evidence() puts it on the fixer unit (unit.detail.judge_evidence).
accuracy(): right / (right + wrong); weighted variant gives 0.5 weight to records older than
8 weeks or of another judge version / model.

Hooks:
  on_qas_report(ctx, report) -> GradeResult
      pipeline._qas_round right after QasRunner(...).run(...) and before Fixer.handle(...);
      after Fixer.handle: attach_fixer_evidence(ctx, outs, grade). No-op unless judge_enabled.
  on_run_end(ctx, final_state) -> GradeResult
      pipeline._finish (green or escalated). No-op unless judge_enabled.

Fake LLM fixture key: role "judge", key "<unit>.<kind>.<k>" (k = 1-based decision count of that
unit and kind in the run), e.g. dry/judge/U3.drift.1.json, dry/judge/U3.dispute.1.json.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .. import contracts
from ..codes import LineError
from ..contracts import E_ACC_TEST, E_UNIT, Unit, UnitState
from ..llm import load_prompt
from . import _common as C

DRIFT_OPTIONS = ("continue", "redirect", "reset", "stop")
DISPUTE_OPTIONS = ("builder", "fix", "stop")
OPTIONS = {"drift": DRIFT_OPTIONS, "dispute": DISPUTE_OPTIONS}
PROCEED = frozenset({"continue", "builder"})
REDIRECT = frozenset({"redirect", "reset", "fix"})

EXPECT = {
    "continue": "the unit merges and every F-item of the unit is green on QAS",
    "builder": "the unit merges as built and every F-item of the unit is green on QAS",
    "redirect": "the next attempts pass verify and review, the unit merges and its F-items are green on QAS",
    "reset": "a fresh attempt passes verify and review, the unit merges and its F-items are green on QAS",
    "fix": "the next attempt resolves the findings, the unit merges and its F-items are green on QAS",
    "stop": "the unit stays stopped (no attributable outcome)",
}

PENDING, RIGHT, WRONG, UNATTRIBUTABLE, REJECTED = "pending", "right", "wrong", "unattributable", "rejected"
OLD_MS = 8 * 7 * 24 * 3600 * 1000

SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["choice", "rationale", "quotes"],
    "properties": {
        "choice": {"type": "string"},
        "rationale": {"type": "string"},
        "quotes": {"type": "array", "items": {"type": "object", "required": ["quote"],
                                              "properties": {"span_id": {"type": "string"},
                                                             "quote": {"type": "string"}}}},
        "instructions": {"type": "string"},
        "spec_gap": {"type": "boolean"},
    },
}

UNSAFE = re.compile(
    r"(?i)(unittest\.skip|\bskip\w*\s+(?:the\s+|this\s+|these\s+|a\s+)?(?:acceptance\s+)?tests?\b"
    r"|\b(?:delete|remove|edit|modify|change|rewrite|weaken|relax|disable)\w*\s+(?:the\s+|this\s+|these\s+|a\s+)?"
    r"(?:locked\s+|acceptance\s+)?(?:test|tests|test file|assertions?)\b"
    r"|\b(?:disable|bypass|loosen|relax|turn off|switch off)\w*\s+(?:the\s+)?(?:guard|guards|check|checks|verifier|review|reviewer|gate)\b"
    r"|\bcredential|\bpassword\b|--no-verify)")


# ------------------------------------------------------------------ decision log


_LOCKS: Dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(key: str) -> threading.RLock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


class DecisionLog:
    """Decision records. Store backend when the 'decision' entity is registered, else a JSON file."""

    def __init__(self, store: Any = None, path: str = ""):
        self.store = store
        self.path = "" if self.store is not None else os.path.abspath(path or os.path.join(
            tempfile.gettempdir(), "sdlc-line", "decision_log.json"))
        self._lock = _lock_for(self.path or "store")

    @classmethod
    def for_ctx(cls, ctx: C.Ctx) -> "DecisionLog":
        if ctx.decisions is None:
            path = str(C.setting(ctx.cfg, "decision_log") or "")
            if not path:
                path = os.path.join(str(getattr(ctx.cfg, "workroot", "") or tempfile.gettempdir()), "decision_log.json")
            ctx.decisions = cls(ctx.store, path)
        return ctx.decisions

    @property
    def backend(self) -> str:
        return "store" if self.store is not None else "file"

    # file backend
    def _read(self) -> Dict[str, Dict[str, Any]]:
        if not os.path.isfile(self.path):
            return {}
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        return dict(data.get("decisions") or {})

    def _write(self, rows: Mapping[str, Mapping[str, Any]]) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"decisions": rows}, fh, ensure_ascii=False, indent=1, sort_keys=True)
        os.replace(tmp, self.path)

    def put(self, rec: Mapping[str, Any]) -> Dict[str, Any]:
        rec = json.loads(json.dumps(dict(rec)))
        with self._lock:
            if self.store is not None:
                self.store.put(C.E_DECISION, rec["id"], rec, run=rec.get("run", ""))
            else:
                rows = self._read()
                rows[rec["id"]] = rec
                self._write(rows)
        return rec

    def get(self, id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if self.store is not None:
                return self.store.get(C.E_DECISION, id)
            return self._read().get(id)

    def update(self, id: str, **fields: Any) -> Dict[str, Any]:
        with self._lock:
            rec = self.get(id)
            if rec is None:
                raise LineError("NOT_FOUND", "decision/%s" % id, {"id": id})
            rec.update(fields)
            return self.put(rec)

    def all(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self.store.query(C.E_DECISION) if self.store is not None else list(self._read().values())
        return sorted(rows, key=lambda r: (int(r.get("ts_ms", 0) or 0), r.get("id", "")))

    def query(self, **eq: Any) -> List[Dict[str, Any]]:
        return [r for r in self.all() if all(r.get(k) == v for k, v in eq.items())]


# ------------------------------------------------------------------ deciding


def _locked_tests(ctx: C.Ctx) -> List[str]:
    out = []
    try:
        rows = ctx.store.query(E_ACC_TEST, run=ctx.run)
    except LineError:
        rows = []
    for r in rows:
        if r.get("locked") and r.get("path"):
            out.append(str(r["path"]).replace("\\", "/"))
    return out


def unsafe_reason(text: str, locked: Sequence[str] = ()) -> str:
    """'' when the judge's instructions are safe; else why not (code-blocked)."""
    t = (text or "").replace("\\", "/")
    for p in locked:
        if p and (p in t or os.path.basename(p) in t):
            return "touches locked test %s" % p
    m = UNSAFE.search(t)
    return "unsafe instruction %r" % m.group(0) if m else ""


def history(log: DecisionLog, kind: str, limit: int) -> List[Dict[str, Any]]:
    """Past graded decisions of this kind: structured fields only (no free text from evidence)."""
    rows = [r for r in log.all() if r.get("kind") == kind and r.get("status") in (RIGHT, WRONG)]
    rows = rows[-max(int(limit), 0):] if limit else []
    return [{"case": r.get("case", {}), "choice": r.get("choice"), "outcome": r.get("status"),
             "model": r.get("model", ""), "reason": r.get("grade_reason", "")} for r in rows]


def _count(log: DecisionLog, run: str, unit: str, kind: Optional[str] = None) -> int:
    return len([r for r in log.all() if r.get("run") == run and r.get("unit") == unit
                and (kind is None or r.get("kind") == kind)])


def decide(ctx: C.Ctx, kind: str, unit: Any, case: Mapping[str, Any], packet: str = "") -> Dict[str, Any]:
    """One judge decision on `kind` ("drift" | "dispute") for `unit`. Always returns a recorded
    decision; a rejected / capped / failed one has choice "stop"."""
    log = DecisionLog.for_ctx(ctx)
    u = C.load(ctx, unit)
    options = OPTIONS[kind]
    k = _count(log, ctx.run, u.id, kind) + 1
    model = str(C.setting(ctx.cfg, "judge_model") or getattr(ctx.cfg, "model", ""))
    spans = C.unit_spans(ctx, u)
    rec: Dict[str, Any] = {
        "id": "%s:%s:%s:%d" % (ctx.run, u.id, kind, k), "run": ctx.run, "unit": u.id,
        "f_items": list(u.f_items or []), "spec_hash": ctx.spec_hash, "kind": kind, "n": k,
        "case": json.loads(json.dumps(dict(case), default=str)), "options": list(options), "choice": "stop",
        "rationale": "", "quotes": [], "instructions": "", "spec_gap": False, "expect": EXPECT["stop"],
        "model": model, "judge_version": str(getattr(ctx.cfg, "agent_version", "") or ""),
        "same_model_as_builder": bool(u.model and u.model == model), "status": REJECTED, "reason": "",
        "quote_ok": False, "ts_ms": C.now(ctx), "usd": 0.0, "attempt": int(u.attempt or 0),
    }
    if _count(log, ctx.run, u.id) >= max(int(C.setting(ctx.cfg, "judge_max_decisions")), 1):
        rec.update(reason="max_decisions", model="code")
        return _record(ctx, log, rec)
    prompt = load_prompt(
        "judge", kind=kind, unit_id=u.id, title=u.title or u.id, f_items=", ".join(u.f_items or []) or "(none)",
        claims=", ".join(u.claims or []) or "(none)", spec=C.render_spans(spans),
        options="\n".join("- %s: %s" % (o, EXPECT[o]) for o in options),
        case=json.dumps(rec["case"], ensure_ascii=False, indent=1, sort_keys=True),
        packet=packet or "(none)",
        history="\n".join(json.dumps(h, ensure_ascii=False, sort_keys=True)
                          for h in history(log, kind, int(C.setting(ctx.cfg, "judge_history")))) or "(none yet)")
    try:
        res = ctx.llm.complete("judge", prompt, SCHEMA, key=C.fixture_key(u.id, kind, k), model=model, run=ctx.run)
    except LineError as e:
        rec.update(reason="llm_error: %s %s" % (e.code, e.message[:200]))
        return _record(ctx, log, rec)
    data = res.data if isinstance(res.data, Mapping) else {}
    rec["usd"] = float(res.usd or 0.0)
    rec["model"] = res.model or model
    choice = str(data.get("choice", "")).strip().lower()
    quotes = []
    for q in data.get("quotes") or []:
        if isinstance(q, Mapping):
            sid = C.quote_span(str(q.get("quote", "")), spans)
            if sid:
                quotes.append({"span_id": sid, "quote": str(q.get("quote", "")).strip()})
    rec.update(rationale=str(data.get("rationale", ""))[:4000], quotes=quotes, quote_ok=bool(quotes),
               instructions=str(data.get("instructions", "") or "")[:4000], spec_gap=bool(data.get("spec_gap")),
               proposed=choice)
    if choice not in options:
        rec.update(reason="choice %r not in %s" % (choice, list(options)))
    elif rec["spec_gap"]:
        rec.update(reason="spec_gap", route="spec_question")
    elif not quotes:
        rec.update(reason="no_valid_quote")
    elif unsafe_reason(rec["instructions"], _locked_tests(ctx)):
        rec.update(reason=unsafe_reason(rec["instructions"], _locked_tests(ctx)))
    else:
        rec.update(choice=choice, expect=EXPECT[choice], status=PENDING, reason="")
    return _record(ctx, log, rec)


def _record(ctx: C.Ctx, log: DecisionLog, rec: Dict[str, Any]) -> Dict[str, Any]:
    rec = log.put(rec)
    C.emit(ctx, C.KIND_JUDGE_DECISION, {"decision": rec["id"], "kind": rec["kind"], "choice": rec["choice"],
                                        "status": rec["status"], "quote_ok": rec["quote_ok"],
                                        "reason": rec.get("reason", ""), "model": rec["model"]},
           unit=rec["unit"], attempt=int(rec.get("attempt", 0) or 0), model=rec["model"])
    ctx.say("%s: judge %s on %s -> %s%s" % (ctx.run, rec["kind"], rec["unit"], rec["choice"],
                                            (" (%s)" % rec["reason"]) if rec.get("reason") else ""))
    return rec


def decide_drift(ctx: C.Ctx, unit: Any, case: Mapping[str, Any]) -> Dict[str, Any]:
    """case = drift signals of the unit (names, evidence, metrics per attempt, ladder level)."""
    return decide(ctx, "drift", unit, case)


def decide_dispute(ctx: C.Ctx, unit: Any, res: Any) -> Dict[str, Any]:
    """res = reviewer.ReviewResult that still blocks. The packet is the reviewer's own clean packet."""
    from .reviewer import build_packet
    u = C.load(ctx, unit)
    case = {"findings": [{k: f.get(k) for k in ("id", "severity", "file", "line", "issue", "spec_quote", "span_id")}
                         for f in res.blocking],
            "rounds": int(((u.detail or {}).get("review") or {}).get("rounds", 0)),
            "tests": None}
    pk = build_packet(ctx, u, res.attempt)
    case["tests"] = pk.tests
    view = pk.render(int(C.setting(ctx.cfg, "review_max_diff_chars")))
    packet = "Unit contract:\n%s\n\nTest result: %s\n\nDiff:\n%s" % (view["contract"], view["tests"], view["diff"])
    return decide(ctx, "dispute", u, case, packet)


# ------------------------------------------------------------------ grading


@dataclass
class GradeResult:
    right: List[str] = field(default_factory=list)
    wrong: List[str] = field(default_factory=list)
    unattributable: List[str] = field(default_factory=list)
    fixer_evidence: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)   # f_item -> evidence
    accuracy: Dict[str, Any] = field(default_factory=dict)


def _items(report: Any) -> Dict[str, Dict[str, Any]]:
    items = getattr(report, "items", None)
    if items is None:
        items = report or []
    out = {}
    for i in items:
        d = contracts.to_dict(i) if not isinstance(i, Mapping) else dict(i)
        out[str(d["f_item"])] = d
    return out


def _mine(ctx: C.Ctx, rec: Mapping[str, Any]) -> bool:
    if rec.get("run") == ctx.run:
        return True
    return bool(ctx.spec_hash) and rec.get("spec_hash") == ctx.spec_hash


def _grade(ctx: C.Ctx, log: DecisionLog, rec: Mapping[str, Any], status: str, reason: str,
           **extra: Any) -> Dict[str, Any]:
    out = log.update(rec["id"], status=status, grade_reason=reason, graded_ms=C.now(ctx), graded_by_run=ctx.run,
                     **extra)
    C.emit(ctx, C.KIND_DECISION_GRADED, {"decision": rec["id"], "status": status, "reason": reason,
                                         "f_items": rec.get("f_items", [])},
           unit=rec.get("unit", "") if rec.get("run") == ctx.run else "")
    return out


def rollback(ctx: C.Ctx, rec: Mapping[str, Any], item: Mapping[str, Any], log: Optional[DecisionLog] = None
             ) -> Dict[str, Any]:
    """A judged-ok unit later failed QAS on the same F-item: mark the decision wrong and build the
    fixer evidence (what was decided, on which quotes, and what QAS showed)."""
    log = log or DecisionLog.for_ctx(ctx)
    ev = {"decision": rec["id"], "kind": rec.get("kind"), "choice": rec.get("choice"), "unit": rec.get("unit"),
          "f_item": item.get("f_item"), "failing": list(item.get("failing") or []), "runs": item.get("runs", []),
          "quotes": rec.get("quotes", []), "rationale": rec.get("rationale", ""),
          "instructions": rec.get("instructions", ""),
          "overruled_findings": (rec.get("case") or {}).get("findings", []) if rec.get("choice") == "builder" else [],
          "signals": (rec.get("case") or {}).get("signals", [])}
    _grade(ctx, log, rec, WRONG, "QAS red on %s after a judged-ok %s" % (item.get("f_item"), rec.get("kind")),
           rollback=ev)
    return ev


def grade_after_qas(ctx: C.Ctx, report: Any) -> GradeResult:
    """Grade pending decisions against a QAS report (code rules in the module doc)."""
    log = DecisionLog.for_ctx(ctx)
    vmap = _items(report)
    out = GradeResult()
    for rec in log.all():
        if rec.get("status") != PENDING or not _mine(ctx, rec):
            continue
        fs = [f for f in rec.get("f_items") or [] if f in vmap]
        if not fs:
            continue
        verdicts = {f: str(vmap[f].get("verdict", "")) for f in fs}
        if any(v not in ("green", "red") for v in verdicts.values()):
            continue                                          # flaky: not attributable now
        if rec.get("choice") == "stop":
            _grade(ctx, log, rec, UNATTRIBUTABLE, "stop decisions have no measurable outcome")
            out.unattributable.append(rec["id"])
            continue
        if rec.get("run") == ctx.run:
            row = ctx.store.get(E_UNIT, rec.get("unit", "")) or {}
            if row.get("state") != UnitState.MERGED.value:
                if row.get("state") == UnitState.FAILED.value:
                    _grade(ctx, log, rec, UNATTRIBUTABLE, "unit failed before QAS")
                    out.unattributable.append(rec["id"])
                continue
        red = [f for f, v in verdicts.items() if v == "red"]
        if red:
            ev = rollback(ctx, rec, vmap[red[0]], log)
            for f in red:
                out.fixer_evidence.setdefault(f, []).append(
                    dict(ev, f_item=f, failing=list(vmap[f].get("failing") or []), runs=vmap[f].get("runs", [])))
            out.wrong.append(rec["id"])
        else:
            _grade(ctx, log, rec, RIGHT, "F-items %s green on QAS" % ",".join(fs))
            out.right.append(rec["id"])
    out.accuracy = accuracy(log, now_ms=C.now(ctx), version=str(getattr(ctx.cfg, "agent_version", "") or ""),
                            model=str(C.setting(ctx.cfg, "judge_model") or ""))
    return out


def on_qas_report(ctx: C.Ctx, report: Any) -> GradeResult:
    """Pipeline hook after the QAS runner (see module doc). No-op unless judge_enabled."""
    if not C.setting(ctx.cfg, "judge_enabled"):
        return GradeResult()
    return grade_after_qas(ctx, report)


def on_run_end(ctx: C.Ctx, final_state: str) -> GradeResult:
    """Close this run's still-pending decisions: unit failed / run escalated -> unattributable;
    run green with the unit merged -> right. No-op unless judge_enabled."""
    out = GradeResult()
    if not C.setting(ctx.cfg, "judge_enabled"):
        return out
    log = DecisionLog.for_ctx(ctx)
    for rec in log.query(run=ctx.run, status=PENDING):
        row = ctx.store.get(E_UNIT, rec.get("unit", "")) or {}
        if final_state == contracts.RunState.GREEN.value and row.get("state") == UnitState.MERGED.value \
                and rec.get("choice") != "stop":
            _grade(ctx, log, rec, RIGHT, "run green with the unit merged")
            out.right.append(rec["id"])
        else:
            _grade(ctx, log, rec, UNATTRIBUTABLE, "run ended %s before a measurable outcome" % final_state)
            out.unattributable.append(rec["id"])
    out.accuracy = accuracy(log, now_ms=C.now(ctx))
    return out


def attach_fixer_evidence(ctx: C.Ctx, outcomes: Iterable[Any], grade: GradeResult) -> List[str]:
    """Put grade.fixer_evidence on the new fixer units (unit.detail.judge_evidence). Returns unit ids."""
    done = []
    for o in outcomes or []:
        unit = getattr(o, "unit", None) if not isinstance(o, Mapping) else o.get("unit")
        f_item = getattr(o, "f_item", None) if not isinstance(o, Mapping) else o.get("f_item")
        ev = grade.fixer_evidence.get(str(f_item))
        if not unit or not ev:
            continue
        C.set_unit_detail(ctx, unit["id"], judge_evidence=ev)
        done.append(unit["id"])
    return done


def accuracy(log: DecisionLog, model: str = "", now_ms: Optional[int] = None, version: str = "") -> Dict[str, Any]:
    """Judge accuracy over graded decisions (right / wrong only). weighted: records older than
    8 weeks or of another judge version / model count 0.5."""
    rows = [r for r in log.all() if r.get("status") in (RIGHT, WRONG)]
    right = len([r for r in rows if r["status"] == RIGHT])
    wsum = wright = 0.0
    for r in rows:
        w = 1.0
        if now_ms is not None and now_ms - int(r.get("ts_ms", 0) or 0) > OLD_MS:
            w = 0.5
        if (version and r.get("judge_version") != version) or (model and r.get("model") != model):
            w = 0.5
        wsum += w
        wright += w if r["status"] == RIGHT else 0.0
    return {"graded": len(rows), "right": right, "wrong": len(rows) - right,
            "accuracy": round(right / len(rows), 4) if rows else None,
            "weighted_accuracy": round(wright / wsum, 4) if wsum else None,
            "by_kind": {k: _acc([r for r in rows if r.get("kind") == k]) for k in OPTIONS}}


def _acc(rows: List[Mapping[str, Any]]) -> Optional[float]:
    return round(len([r for r in rows if r["status"] == RIGHT]) / len(rows), 4) if rows else None
