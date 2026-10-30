"""Drift signals (tín hiệu lệch) + handling ladder (block 14, the detection part).

Signals are computed by code from what the server saw, never from what the builder says.
After every attempt, on_attempt() records the attempt's metrics on unit.detail.drift.metrics
and compares them with the earlier attempts of the unit:

  outside_claims     the diff touches files outside the unit's claims, and that count is not
                     shrinking (weight 1; 2 when it grew)
  tests_flat         acceptance tests passed did not move while the diff grew by > 20 % (1)
  repeat_failure     same failure fingerprint, or same code with the same failing tests, as one of
                     the last two attempts (2)
  cost_rising        cost per attempt rose on each of the last 3 attempts, to >= 1.5x (1)
  done_no_delta      the builder submitted ("done") but passed tests did not increase and some
                     are still red (1)
  scope_words        added non-test lines bring UI / API / feature words the unit's frozen spec
                     spans never use (popup, modal, toast, endpoint, webhook, ...) (2)
  test_files_edited  the diff edits test files outside the unit's claims (2)

score = sum of weights. Ladder (unit.detail.drift.level only goes up):
  1 note      record + event                    (any signal)
  2 nudge     unit.detail.nudge: a corrective line for the builder's next prompt (nudge_for())
  3 reviewer  force a clean-context review of the unit (reviewer.on_verified honours it)
  4 judge     strong-model judge decides against the frozen spec (judge_enabled; else -> stop)
              continue -> level back to 3; redirect -> nudge with the judge's instructions and
              the unit goes back to ready; reset -> worktree dropped, back to ready; stop -> 5
  5 stop      unit -> failed, code DRIFT_STOP
A score >= drift_threshold climbs one level; >= 2 x threshold climbs two; the judge step is never
jumped over; a lower non-zero score only records a note (level >= 1).

Hook (wire in pipeline.Pipeline._work after verify(...) returned, whatever its verdict, and
BEFORE reviewer.on_verified / _commit_unit):

    do = drift.on_attempt(ctx, unit.id, br.attempt, g, builder_outcome=br.outcome, usd=br.usd)
    self._charge(unit.id, do.usd)
    if not do.proceed:
        out.update(verified=False, gate_code=do.code); return out

and add drift.nudge_for(store, unit_id) to the builder's context. No-op unless drift_enabled.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from ..contracts import E_ATTEMPT, E_GATE, E_UNIT, TERMINAL_UNIT_STATES, Unit, UnitState
from . import _common as C

NOTE, NUDGE, REVIEWER, JUDGE, STOP = 1, 2, 3, 4, 5
LEVEL_NAMES = {0: "none", NOTE: "note", NUDGE: "nudge", REVIEWER: "reviewer", JUDGE: "judge", STOP: "stop"}

WEIGHTS = {"outside_claims": 1, "tests_flat": 1, "repeat_failure": 2, "cost_rising": 1, "done_no_delta": 1,
           "scope_words": 2, "test_files_edited": 2}

#: words that name behaviour a spec would have to state (UI, API, cross-cutting features)
SCOPE_WORDS = (
    "popup", "pop-up", "modal", "dialog", "toast", "banner", "tooltip", "snackbar", "notification", "splash",
    "carousel", "wizard", "captcha", "endpoint", "webhook", "websocket", "graphql", "cron", "scheduler",
    "telemetry", "analytics", "tracking", "metrics", "cache", "retry", "rate limit", "throttle", "feature flag",
    "admin", "dark mode", "theme", "export", "import", "upload", "email", "sms", "payment", "login", "logout",
    "signup", "password reset",
)


@dataclass
class Signal:
    name: str
    weight: int
    evidence: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DriftOutcome:
    action: str                       # skip | none | note | nudge | reviewer | judge:<choice> | stop
    proceed: bool = True              # False: the unit must not be committed / merged now
    signals: List[Signal] = field(default_factory=list)
    score: int = 0
    level: int = 0
    code: str = ""
    nudge: str = ""
    decision: Optional[Dict[str, Any]] = None
    usd: float = 0.0


# ------------------------------------------------------------------ metrics


def _claimed(path: str, claims: Sequence[str]) -> bool:
    import fnmatch
    p = path.replace("\\", "/")
    for c in claims or []:
        c = c.replace("\\", "/")
        if p == c or fnmatch.fnmatchcase(p, c) or (c.endswith("/") and p.startswith(c)):
            return True
    return False


def metrics_for(ctx: C.Ctx, u: Unit, n: int, gate: Any = None, diff: Any = None, builder_outcome: str = "",
                usd: Optional[float] = None) -> Dict[str, Any]:
    """Code-measured facts of attempt n (diff from the sandbox, tests from the verify gate)."""
    files, patch = C.diff_parts(C.get_diff(ctx, u, diff))
    fps = C.parse_patch(patch)
    added = sum(len(fp.added) for fp in fps.values())
    removed = len([l for l in patch.splitlines() if l.startswith("-") and not l.startswith("---")])
    att = ctx.store.get(E_ATTEMPT, C.attempt_key(u.id, n)) or {}
    if gate is None:
        g = (ctx.store.get(E_GATE, "%s:verify" % C.attempt_key(u.id, n)) or {}).get("gate") or {}
    else:
        g = {"ok": gate.ok, "code": gate.code, "fingerprint": gate.fingerprint, "detail": dict(gate.detail)} \
            if not isinstance(gate, Mapping) else dict(gate)
    det = g.get("detail") or {}
    failing = sorted({str(f.get("test", "")) for f in det.get("failures") or [] if isinstance(f, Mapping)})
    total = len(u.tests or [])
    passed = det.get("passed")
    if passed is None:
        passed = total if g.get("ok") else (att.get("detail") or {}).get("passed", 0)
    outside = [p for p in files if not _claimed(p, u.claims)]
    return {"n": n, "files": len(files), "outside": outside, "diff_lines": added + removed,
            "passed": int(passed or 0), "total": total, "ok": bool(g.get("ok")), "code": str(g.get("code", "") or ""),
            "fingerprint": str(g.get("fingerprint", "") or ""), "failing": failing,
            "usd": float(usd if usd is not None else att.get("usd", 0.0) or 0.0),
            "submitted": (builder_outcome or att.get("outcome", "")).upper() in ("SUBMIT", "SUBMITTED", "VERIFIED",
                                                                                 "FAILED"),
            "tests_edited": [p for p in files if C.is_test_path(p) and not _claimed(p, u.claims)],
            "added_text": "\n".join(t for path, fp in fps.items() if not C.is_test_path(path)
                                    for _, t in fp.added)[:20000]}


#: a whole import / export statement line (Python ``import x`` / ``from x import y``, JS/TS ``import`` / ``export``)
_IMPORT_LINE = re.compile(r"(?m)^[ \t]*(?:from[ \t]+[\w.]+[ \t]+import\b|import\b|export\b).*$")


def scope_words(added_text: str, spec_text: str) -> List[str]:
    """SCOPE_WORDS present in the added code but absent from the frozen spec text. Module import / export
    statements are language syntax, not behaviour: they are left out (else every Python diff says "import")."""
    code = _IMPORT_LINE.sub("", added_text).lower().replace("__import__", "")
    spec = C.norm(spec_text)
    out = []
    for w in SCOPE_WORDS:
        rx = r"(?<![a-z])" + re.escape(w).replace(r"\ ", r"[ _\-]?") + r"s?(?![a-z])"
        if re.search(rx, code) and not re.search(rx, spec):
            out.append(w)
    return out


def signals(cur: Mapping[str, Any], prev: Sequence[Mapping[str, Any]], spec_text: str) -> List[Signal]:
    """Pure: drift signals of attempt `cur` given the earlier attempts `prev` (oldest first)."""
    out: List[Signal] = []
    last = prev[-1] if prev else None
    if cur["outside"]:
        grew = last is None or len(cur["outside"]) > len(last.get("outside") or [])
        if last is None or len(cur["outside"]) >= len(last.get("outside") or []):
            out.append(Signal("outside_claims", 2 if grew and last is not None else WEIGHTS["outside_claims"],
                              {"files": list(cur["outside"])}))
    if last is not None and cur["passed"] == last.get("passed") and cur["passed"] < cur["total"] \
            and cur["diff_lines"] > 1.2 * int(last.get("diff_lines", 0)) + 10:
        out.append(Signal("tests_flat", WEIGHTS["tests_flat"],
                          {"passed": cur["passed"], "total": cur["total"],
                           "diff_lines": [last.get("diff_lines"), cur["diff_lines"]]}))
    if cur["code"]:
        for p in prev[-2:]:
            same_fp = cur["fingerprint"] and p.get("fingerprint") == cur["fingerprint"]
            same_tests = p.get("code") == cur["code"] and cur["failing"] and p.get("failing") == cur["failing"]
            if same_fp or same_tests:
                out.append(Signal("repeat_failure", WEIGHTS["repeat_failure"],
                                  {"code": cur["code"], "attempt": p.get("n"), "fingerprint": cur["fingerprint"],
                                   "failing": cur["failing"]}))
                break
    window = list(prev[-2:]) + [cur]
    costs = [float(m.get("usd", 0.0) or 0.0) for m in window]
    if len(window) == 3 and costs[0] > 0 and all(b > a for a, b in zip(costs, costs[1:])) and costs[-1] >= 1.5 * costs[0]:
        out.append(Signal("cost_rising", WEIGHTS["cost_rising"], {"usd": costs}))
    if cur["submitted"] and cur["total"] and cur["passed"] < cur["total"] \
            and (last is None and cur["passed"] == 0 or last is not None and cur["passed"] <= int(last.get("passed", 0))):
        out.append(Signal("done_no_delta", WEIGHTS["done_no_delta"],
                          {"passed": cur["passed"], "total": cur["total"],
                           "before": last.get("passed") if last else None}))
    words = scope_words(cur.get("added_text", ""), spec_text)
    if words:
        out.append(Signal("scope_words", WEIGHTS["scope_words"], {"words": words}))
    if cur.get("tests_edited"):
        out.append(Signal("test_files_edited", WEIGHTS["test_files_edited"], {"files": list(cur["tests_edited"])}))
    return out


def next_level(level: int, score: int, threshold: int) -> int:
    if score <= 0:
        return level
    t = max(int(threshold), 1)
    if score < t:
        return max(level, NOTE)
    new = min(level + (2 if score >= 2 * t else 1), STOP)
    return JUDGE if level < JUDGE < new else new          # never jump over the judge step


# ------------------------------------------------------------------ ladder


def nudge_text(sigs: Sequence[Signal]) -> str:
    parts = []
    for s in sigs:
        e = s.evidence
        if s.name == "outside_claims":
            parts.append("Only change files in your claims; revert %s." % ", ".join(e["files"]))
        elif s.name == "tests_flat":
            parts.append("Your diff grew but no more acceptance tests pass (%s/%s): stop adding code, make the "
                         "failing tests pass." % (e["passed"], e["total"]))
        elif s.name == "repeat_failure":
            parts.append("Same failure as attempt %s (%s %s): change approach instead of repeating it."
                         % (e["attempt"], e["code"], ", ".join(e["failing"]) or e["fingerprint"][:10]))
        elif s.name == "cost_rising":
            parts.append("Each attempt costs more; keep the change small and focused on the unit's tests.")
        elif s.name == "done_no_delta":
            parts.append("You reported done but acceptance tests did not improve (%s/%s pass): run them and "
                         "fix them before you SUBMIT." % (e["passed"], e["total"]))
        elif s.name == "scope_words":
            parts.append("Build only what the frozen spec states; remove %s (not in the spec)." % ", ".join(e["words"]))
        elif s.name == "test_files_edited":
            parts.append("Do not edit tests outside your claims: %s." % ", ".join(e["files"]))
    return " ".join(parts)


def nudge_for(store: Any, unit_id: str) -> str:
    """Corrective text for the builder's next prompt ("" when none). The integrator appends it to
    the builder's context."""
    row = store.get(E_UNIT, unit_id) or {}
    return str((row.get("detail") or {}).get("nudge", "") or "")


def _spec_text(ctx: C.Ctx, u: Unit) -> str:
    parts = [s.text for s in C.unit_spans(ctx, u)]
    parts += [u.title or ""]
    for f in C.f_item_titles(ctx, u):
        parts.append(f["title"])
        parts += [c["text"] for c in f["criteria"]]
    return "\n".join(parts)


def on_attempt(ctx: C.Ctx, unit_id: str, attempt: int, gate: Any = None, *, diff: Any = None,
               builder_outcome: str = "", usd: Optional[float] = None) -> DriftOutcome:
    """Pipeline hook after verify (see module doc). No-op unless drift_enabled."""
    if not C.setting(ctx.cfg, "drift_enabled"):
        return DriftOutcome("skip")
    u = C.load(ctx, unit_id)
    n = int(attempt or u.attempt or 1)
    drift = dict((u.detail or {}).get("drift") or {})
    hist = [m for m in drift.get("metrics") or [] if int(m.get("n", 0)) < n]
    cur = metrics_for(ctx, u, n, gate, diff, builder_outcome, usd)
    sigs = signals(cur, hist, _spec_text(ctx, u))
    score = sum(s.weight for s in sigs)
    level0 = int(drift.get("level", 0) or 0)
    level = next_level(level0, score, int(C.setting(ctx.cfg, "drift_threshold")))
    stored = dict(cur)
    stored.pop("added_text", None)
    drift["metrics"] = (hist + [stored])[-10:]
    drift["level"] = level
    drift.setdefault("events", []).append({"n": n, "signals": [s.name for s in sigs], "score": score,
                                           "level": level})
    drift["events"] = drift["events"][-20:]
    out = DriftOutcome("none", True, sigs, score, level)
    terminal = (ctx.store.get(E_UNIT, u.id) or {}).get("state") in TERMINAL_UNIT_STATES
    if terminal:
        drift["level"] = level = level0
        out.level, out.proceed = level0, False
    if terminal or score <= 0 or level == level0:
        if score > 0:
            out.action = "note"
        C.set_unit_detail(ctx, u.id, drift=drift)
        _event(ctx, u, n, out)
        return out
    extra: Dict[str, Any] = {}
    if level >= NUDGE:
        out.nudge = nudge_text(sigs)
        extra["nudge"] = out.nudge
    if level >= REVIEWER:
        drift["force_review"] = True
    out.action = LEVEL_NAMES[min(level, STOP)]
    C.set_unit_detail(ctx, u.id, drift=drift, **extra)
    if level == JUDGE:
        _judge(ctx, u, n, sigs, cur, drift, out)
    elif level >= STOP:
        _stop(ctx, u, sigs, out, "drift ladder reached stop")
    _event(ctx, u, n, out)
    return out


def _event(ctx: C.Ctx, u: Unit, n: int, out: DriftOutcome) -> None:
    C.emit(ctx, C.KIND_DRIFT_SIGNAL, {"signals": [{"name": s.name, "weight": s.weight, "evidence": s.evidence}
                                                  for s in out.signals],
                                      "score": out.score, "level": out.level, "action": out.action,
                                      "decision": (out.decision or {}).get("id", "")}, unit=u.id, attempt=n)


def _stop(ctx: C.Ctx, u: Unit, sigs: Sequence[Signal], out: DriftOutcome, why: str,
          detail: Optional[Mapping[str, Any]] = None) -> None:
    d = {"signals": [s.name for s in sigs]}
    d.update(dict(detail or {}))
    C.stop_unit(ctx, u.id, C.DRIFT_STOP, "unit %s: %s" % (u.id, why), d)
    out.action, out.proceed, out.code, out.level = "stop", False, C.DRIFT_STOP, STOP
    C.set_unit_detail(ctx, u.id, drift=dict((C.load(ctx, u.id).detail or {}).get("drift") or {}, level=STOP))


def _judge(ctx: C.Ctx, u: Unit, n: int, sigs: Sequence[Signal], cur: Mapping[str, Any],
           drift: Dict[str, Any], out: DriftOutcome) -> None:
    if not C.setting(ctx.cfg, "judge_enabled"):
        _stop(ctx, u, sigs, out, "drift reached the judge step and the judge is off")
        return
    from . import judge
    case = {"signals": [{"name": s.name, "evidence": s.evidence} for s in sigs], "attempt": n,
            "metrics": [{k: m.get(k) for k in ("n", "files", "outside", "diff_lines", "passed", "total", "code",
                                               "failing", "usd")} for m in drift.get("metrics") or []]}
    dec = judge.decide_drift(ctx, u, case)
    out.decision, out.usd = dec, float(dec.get("usd", 0.0) or 0.0)
    choice = dec["choice"]
    out.action = "judge:" + choice
    if choice == "stop":
        _stop(ctx, u, sigs, out, "stopped by the judge (%s)" % dec["id"],
              {"decision": dec["id"], "spec_gap": bool(dec.get("spec_gap")), "route": dec.get("route", "")})
        return
    drift = dict((C.load(ctx, u.id).detail or {}).get("drift") or {})
    drift["level"] = REVIEWER          # the judge may be asked again (up to judge_max_decisions)
    out.level = REVIEWER
    if choice == "continue":
        drift["force_review"] = False
        C.set_unit_detail(ctx, u.id, drift=drift, nudge="")
        return
    nudge = ("Judge ruling %s against the frozen spec: %s" % (dec["id"], dec.get("instructions", ""))).strip()
    out.nudge = nudge
    C.set_unit_detail(ctx, u.id, drift=drift, nudge=nudge, judge_action=choice)
    _evidence(ctx, u, n, nudge)
    if choice == "reset" and ctx.sandbox is not None:
        try:
            ctx.sandbox.cleanup(u, delete_branch=True)
        except Exception as e:  # noqa: BLE001 - a failed cleanup leaves the old worktree; the nudge still applies
            ctx.say("%s: reset of %s worktree failed: %s" % (ctx.run, u.id, e))
    row = ctx.store.get(E_UNIT, u.id) or {}
    if row.get("state") not in TERMINAL_UNIT_STATES and row.get("state") != UnitState.READY.value:
        C.send_back(ctx, u.id, C.DRIFT_REDIRECT, dec["id"], {"decision": dec["id"], "choice": choice},
                    use_ladder=False)
    out.proceed = False
    out.code = C.DRIFT_REDIRECT


def _evidence(ctx: C.Ctx, u: Unit, n: int, text: str) -> None:
    """Keep the attempt's own failure code; add the judge's ruling to its evidence."""
    row = ctx.store.get(E_ATTEMPT, C.attempt_key(u.id, n)) or {}
    old = str((row.get("detail") or {}).get("evidence", "") or "")
    code = row.get("code") or C.DRIFT_REDIRECT
    C.mark_attempt(ctx, u, n, code, (old + "\n\n" + text).strip())
