"""Shared pieces of the review slice (blocks 13 and 14): context, settings, new kinds / codes,
event emission, unit spec spans, quote check, patch parsing and unit moves (send back / stop).

Nothing here is wired into pipeline.drive; the hook functions in reviewer.py, drift.py and
judge.py are, and every one of them is a no-op while its config flag is off (the default).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..contracts import (
    E_ATTEMPT, E_ESCALATION, E_UNIT, TERMINAL_UNIT_STATES, Envelope, Span, Unit, UnitState, from_dict,
)
from ..statemachine import StateMachine, update_row

# ------------------------------------------------------------------ new kinds / codes / entity
# Registered centrally in codes.py (W4_KINDS, W4_GATE_CODES) and contracts.ENTITIES (E_DECISION).

KIND_REVIEW_DONE = "review.done"          # body: {attempt, ok, kept, raw, dropped, blocking, fingerprint}
KIND_DRIFT_SIGNAL = "drift.signal"        # body: {attempt, signals:[names], score, level, action}
KIND_JUDGE_DECISION = "judge.decision"    # body: {decision, kind, choice, quote_ok, model}
KIND_DECISION_GRADED = "decision.graded"  # body: {decision, status, reason, f_items}
NEW_EVENT_KINDS = (KIND_REVIEW_DONE, KIND_DRIFT_SIGNAL, KIND_JUDGE_DECISION, KIND_DECISION_GRADED)

REVIEW_BLOCK = "REVIEW_BLOCK"   # clean-context reviewer found >= block severity findings
DRIFT_STOP = "DRIFT_STOP"       # drift ladder (or the judge) stopped the unit
DRIFT_REDIRECT = "DRIFT_REDIRECT"  # the judge sent a drifting unit back (redirect / reset) with instructions
NEW_GATE_CODES = (REVIEW_BLOCK, DRIFT_STOP, DRIFT_REDIRECT)

E_DECISION = "decision"         # decision log record (judge), id "<run>:<unit>:<kind>:<n>"

# ------------------------------------------------------------------ settings
#: Config keys this slice reads with getattr(cfg, key, default). Env names for config.ENV_MAP.
DEFAULTS: Dict[str, Any] = {
    "review_enabled": False,          # LINE_REVIEW            run the reviewer on every verified unit
    "review_model": "",               # LINE_REVIEW_MODEL      "" = a model other than the unit's builder model
    "review_block_severity": "major",  # LINE_REVIEW_BLOCK     findings at/above this severity block
    "review_max_findings": 10,        # LINE_REVIEW_MAX_FINDINGS  cap after the noise filter
    "review_max_rounds": 2,           # LINE_REVIEW_MAX_ROUNDS blocking rounds before the judge settles it
    "review_max_diff_chars": 40000,   # LINE_REVIEW_MAX_DIFF_CHARS
    "drift_enabled": False,           # LINE_DRIFT             compute drift signals after every attempt
    "drift_threshold": 2,             # LINE_DRIFT_THRESHOLD   score that climbs one ladder step
    "judge_enabled": False,           # LINE_JUDGE             strong-model judge (else the ladder stops the unit)
    "judge_model": "claude-opus-5-5",  # LINE_JUDGE_MODEL
    "judge_max_decisions": 3,         # LINE_JUDGE_MAX_DECISIONS  per unit per run; then stop
    "judge_history": 8,               # LINE_JUDGE_HISTORY     past graded decisions shown to the judge
    "decision_log": "",               # LINE_DECISION_LOG      file backend path ("" = <workroot>/decision_log.json)
}

ENV_NAMES: Dict[str, str] = {
    "LINE_REVIEW": "review_enabled", "LINE_REVIEW_MODEL": "review_model",
    "LINE_REVIEW_BLOCK": "review_block_severity", "LINE_REVIEW_MAX_FINDINGS": "review_max_findings",
    "LINE_REVIEW_MAX_ROUNDS": "review_max_rounds", "LINE_REVIEW_MAX_DIFF_CHARS": "review_max_diff_chars",
    "LINE_DRIFT": "drift_enabled", "LINE_DRIFT_THRESHOLD": "drift_threshold", "LINE_JUDGE": "judge_enabled",
    "LINE_JUDGE_MODEL": "judge_model", "LINE_JUDGE_MAX_DECISIONS": "judge_max_decisions",
    "LINE_JUDGE_HISTORY": "judge_history", "LINE_DECISION_LOG": "decision_log",
}


def setting(cfg: Any, name: str) -> Any:
    v = getattr(cfg, name, None) if cfg is not None else None
    return DEFAULTS[name] if v is None else v


# ------------------------------------------------------------------ context


@dataclass
class Ctx:
    """What the hooks need. store is the run's (scoped) store the verifier uses; pv / digest are
    the frozen PackVersion and the reconciled Digest; sandbox gives diffs; decisions is a
    judge.DecisionLog (made lazily from cfg when None)."""
    store: Any
    cfg: Any
    llm: Any
    run: str
    pv: Any = None
    digest: Any = None
    sandbox: Any = None
    log: Optional[Callable[[str], None]] = None
    decisions: Any = None

    @classmethod
    def from_pipeline(cls, p: Any) -> "Ctx":
        """Context from a pipeline.Pipeline (attributes wstore/store, cfg, llm, run, pv, digest, sandbox, log)."""
        return cls(store=getattr(p, "wstore", None) or p.store, cfg=p.cfg, llm=p.llm, run=p.run,
                   pv=getattr(p, "pv", None), digest=getattr(p, "digest", None),
                   sandbox=getattr(p, "sandbox", None), log=getattr(p, "log", None))

    def say(self, msg: str) -> None:
        if self.log is not None:
            try:
                self.log(msg)
            except Exception:  # noqa: BLE001 - logging never breaks a hook
                pass

    @property
    def spec_hash(self) -> str:
        return str(getattr(self.pv, "version", "") or "")


def envelope(ctx: Ctx, unit: str = "", attempt: int = 0, model: str = "") -> Envelope:
    return Envelope(run=ctx.run, unit=unit, attempt=int(attempt or 0), epoch=0,
                    agent_version=str(getattr(ctx.cfg, "agent_version", "") or ""), model=model or "",
                    spec_hash=ctx.spec_hash)


def emit(ctx: Ctx, kind: str, body: Mapping[str, Any], unit: str = "", attempt: int = 0, model: str = "") -> int:
    """Emit one review event on the run (kinds are registered in codes.W4_KINDS)."""
    return ctx.store.emit(kind, envelope(ctx, unit, attempt, model), dict(body))


def now(ctx: Ctx) -> int:
    clk = getattr(ctx.store, "clock", None)
    if clk is not None and hasattr(clk, "now_ms"):
        return int(clk.now_ms())
    from ..contracts import now_ms
    return now_ms()


def sha(*parts: str, n: int = 12) -> str:
    return hashlib.sha1("\x1f".join(parts).encode("utf-8", "replace")).hexdigest()[:n]


_KEY_BAD = re.compile(r"[^A-Za-z0-9_.\-]+")


def fixture_key(*parts: Any) -> str:
    """Fake-LLM fixture key: parts joined by '.', unsafe characters -> '_'."""
    return ".".join(_KEY_BAD.sub("_", str(p)) for p in parts if str(p) != "")


# ------------------------------------------------------------------ unit / spec


def load(ctx: Ctx, unit: Any) -> Unit:
    uid = unit.id if isinstance(unit, Unit) else (unit["id"] if isinstance(unit, Mapping) else str(unit))
    row = ctx.store.get(E_UNIT, uid)
    if row is None:
        if isinstance(unit, Unit):
            return unit
        if isinstance(unit, Mapping):
            return from_dict(Unit, unit)
        raise codes.LineError(codes.NOT_FOUND, "unit/%s" % uid, {"entity": E_UNIT, "id": uid})
    return from_dict(Unit, row)


def unit_spans(ctx: Ctx, unit: Unit) -> List[Span]:
    """The frozen spec spans of the unit's F-items (span_ids + criteria spans), in pack order.
    A unit without F-items gets the spans of every F-item."""
    pv, digest = ctx.pv, ctx.digest
    if pv is None:
        return []
    fitems = list(getattr(digest, "f_items", None) or [])
    mine = [f for f in fitems if f.id in set(unit.f_items or [])] or fitems
    want = {s for f in mine for s in (f.span_ids or [])} | {c.span_id for f in mine for c in (f.criteria or [])}
    return [s for s in pv.spans if s.id in want]


def f_item_titles(ctx: Ctx, unit: Unit) -> List[Dict[str, Any]]:
    out = []
    for f in list(getattr(ctx.digest, "f_items", None) or []):
        if f.id in set(unit.f_items or []):
            out.append({"id": f.id, "title": f.title,
                        "criteria": [{"id": c.id, "text": c.text, "then": c.then} for c in (f.criteria or [])]})
    return out


def render_spans(spans: Sequence[Span]) -> str:
    return "\n\n".join("=== SPAN %s | %s ===\n%s" % (s.id, s.heading, (s.text or "").strip()) for s in spans) \
        or "(no spec spans)"


_WS = re.compile(r"\s+")


def norm(text: str) -> str:
    return _WS.sub(" ", (text or "").replace(" ", " ")).strip().lower()


QUOTE_MIN_CHARS = 10


def quote_span(quote: str, spans: Sequence[Span]) -> str:
    """Span id whose text contains `quote` literally (whitespace / case normalised), else ""."""
    q = norm(quote).strip(" .\"'`")
    if len(q) < QUOTE_MIN_CHARS:
        return ""
    for s in spans:
        if q in norm(s.text):
            return s.id
    return ""


# ------------------------------------------------------------------ patch parsing

_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class FilePatch:
    path: str
    added: List[Tuple[int, str]]          # (new line number, text) of '+' lines
    hunks: List[Tuple[int, int]]          # new-side (first, last) line ranges
    deleted: bool = False

    def touches(self, line: int, slack: int = 3) -> bool:
        if self.deleted:
            return True
        return any(a - slack <= line <= b + slack for a, b in self.hunks)


def parse_patch(patch: str) -> Dict[str, FilePatch]:
    """Unified diff -> {path: FilePatch} (new-side line numbers)."""
    out: Dict[str, FilePatch] = {}
    cur: Optional[FilePatch] = None
    old_path = ""
    new_line = 0
    for raw in (patch or "").splitlines():
        if raw.startswith("diff --git "):
            cur = None
            old_path = ""
            continue
        if raw.startswith("--- "):
            p = raw[4:].strip()
            old_path = p[2:] if p.startswith("a/") else ("" if p == "/dev/null" else p)
            continue
        if raw.startswith("+++ "):
            p = raw[4:].strip()
            if p == "/dev/null":
                cur = FilePatch(old_path, [], [], deleted=True)
            else:
                cur = FilePatch(p[2:] if p.startswith("b/") else p, [], [])
            out[cur.path] = cur
            continue
        m = _HUNK.match(raw)
        if m and cur is not None:
            start = int(m.group(3))
            count = int(m.group(4)) if m.group(4) is not None else 1
            cur.hunks.append((start, start + max(count, 1) - 1))
            new_line = start
            continue
        if cur is None or not cur.hunks:
            continue
        if raw.startswith("+"):
            cur.added.append((new_line, raw[1:]))
            new_line += 1
        elif raw.startswith(" "):
            new_line += 1
        # '-' lines and '\ No newline' do not move the new side
    return out


def diff_parts(diff: Any) -> Tuple[List[str], str]:
    """(paths, patch) of a sandbox.Diff, a mapping {"files"/"paths", "patch"} or None."""
    if diff is None:
        return [], ""
    if isinstance(diff, Mapping):
        files = diff.get("paths") or [p for _, p in diff.get("files", [])] or []
        return [str(p) for p in files], str(diff.get("patch", ""))
    paths = list(getattr(diff, "paths", []) or [])
    return [str(p) for p in paths], str(getattr(diff, "patch", "") or "")


def get_diff(ctx: Ctx, unit: Unit, diff: Any = None) -> Any:
    if diff is not None or ctx.sandbox is None:
        return diff
    try:
        return ctx.sandbox.diff(unit)
    except codes.LineError:
        return None


# ------------------------------------------------------------------ unit moves


def _sm(ctx: Ctx) -> StateMachine:
    return StateMachine(ctx.store, str(getattr(ctx.cfg, "agent_version", "line-0.1") or "line-0.1"))


def attempt_key(unit_id: str, n: int) -> str:
    return "%s#%d" % (unit_id, n)


def mark_attempt(ctx: Ctx, unit: Unit, n: int, code: str, evidence: str, **detail: Any) -> None:
    """Put the failure on the attempt record: the builder's next prompt reads detail.evidence."""
    aid = attempt_key(unit.id, n)
    row = ctx.store.get(E_ATTEMPT, aid) or {"unit": unit.id, "n": n, "run": unit.run, "detail": {}}
    d = dict(row.get("detail") or {})
    d.update(detail)
    d["evidence"] = evidence
    row.update({"code": code, "outcome": "failed", "detail": d, "run": unit.run})
    ctx.store.put(E_ATTEMPT, aid, row, run=unit.run)


def stop_unit(ctx: Ctx, unit_id: str, code: str, message: str, detail: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Unit -> failed with an escalation record (no-op on a terminal unit). Returns the unit row."""
    row = ctx.store.get(E_UNIT, unit_id) or {}
    state = row.get("state", "")
    if not row or state in TERMINAL_UNIT_STATES:
        return row
    body = {"code": code, "message": message}
    body.update(dict(detail or {}))
    out = _sm(ctx).advance_unit(unit_id, UnitState.FAILED, state, code=code, extra=[(codes.ESCALATED, body)])
    ctx.store.put(E_ESCALATION, "%s:%s" % (row.get("run", ctx.run), unit_id),
                  {"code": code, "message": message, "detail": body, "unit": unit_id, "run": row.get("run", ctx.run)},
                  run=row.get("run", ctx.run))
    return out


SEND_BACK_FROM = (UnitState.VERIFIED.value, UnitState.SUBMITTED.value, UnitState.LEASED.value,
                  UnitState.WAITING.value)


def send_back(ctx: Ctx, unit_id: str, code: str, fingerprint: str, detail: Optional[Mapping[str, Any]] = None,
              unit_detail: Optional[Mapping[str, Any]] = None, use_ladder: bool = True) -> Tuple[str, Dict[str, Any]]:
    """Back to ready on the shared retry ladder (watchdog.plan_failure: one failure history per unit).
    Returns (action, row): action "retry" | "switch_model" | "escalate" (unit failed) | "noop"."""
    from ..watchdog import LADDER_LOCK, plan_failure
    with LADDER_LOCK:
        row = ctx.store.get(E_UNIT, unit_id) or {}
        state = row.get("state", "")
        if not row or state in TERMINAL_UNIT_STATES:
            return "noop", row
        cfg = ctx.cfg
        d = plan_failure(row, code, fingerprint, int(getattr(cfg, "retry_n", 3) or 3),
                         str(getattr(cfg, "model", "") or ""), str(getattr(cfg, "model_alt", "") or ""), detail)
        if use_ladder and d.action == "escalate":
            udetail = dict(row.get("detail") or {})
            udetail.update(dict(unit_detail or {}))
            udetail["failures"] = list(d.failures)
            update_row(ctx.store, E_UNIT, unit_id, {"detail": udetail})
            out = stop_unit(ctx, unit_id, code, "unit %s stopped: %s (%s)" % (unit_id, code, d.reason),
                            {"reason": d.reason, "fingerprint": fingerprint})
            return "escalate", out
        udetail = dict(row.get("detail") or {})
        udetail.update(dict(unit_detail or {}))
        udetail["failures"] = list(d.failures)
        rung, model = (d.rung, d.model) if use_ladder else (int(row.get("rung", 0) or 0), row.get("model", ""))
        updates = {"rung": rung, "model": model, "detail": udetail}
        if state in SEND_BACK_FROM:
            out = _sm(ctx).advance_unit(unit_id, UnitState.READY, state, code=code, updates=updates,
                                        extra=[(codes.UNIT_REQUEUED, {"code": code, "from": state, "rung": rung,
                                                                     "model": model, "reason": d.reason,
                                                                     "fingerprint": fingerprint})])
        else:
            out = update_row(ctx.store, E_UNIT, unit_id, updates)
        return (d.action if use_ladder else "retry"), out


def set_unit_detail(ctx: Ctx, unit_id: str, **kv: Any) -> Dict[str, Any]:
    row = ctx.store.get(E_UNIT, unit_id) or {}
    d = dict(row.get("detail") or {})
    d.update(kv)
    return update_row(ctx.store, E_UNIT, unit_id, {"detail": d})


def is_test_path(path: str) -> bool:
    p = path.replace("\\", "/").lower()
    name = p.rsplit("/", 1)[-1]
    return p.startswith("tests/") or "/tests/" in p or name.startswith("test_") or name.endswith("_test.py")


def first(items: Iterable[Any], default: Any = None) -> Any:
    for x in items:
        return x
    return default
