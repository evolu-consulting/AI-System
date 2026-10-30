"""Clean-context reviewer + noise filter (block 13).

The reviewer reads a verified unit the way an outsider would. Its packet holds ONLY:
  * the frozen spec spans of the unit's F-items (and their criteria),
  * the unit contract (id, title, F-items, claims, deps, contract flag, acceptance test ids),
  * the diff of the unit (patch, truncated at review_max_diff_chars),
  * the server's test result for the attempt (gate ok / code, tests passed, failing test ids).
Never the builder's conversation, final message, prompt or the evidence of earlier attempts
(build_packet() reads nothing else; tests assert it).

The model answers JSON {"findings": [{severity, file, line, issue, spec_quote, span_id?, fix?}],
"summary"}. Code then filters the noise (filter_findings):
  no_quote      spec_quote missing / shorter than 10 chars / not literally in a unit span
  bad_severity  severity not in info|minor|major|critical
  outside_diff  file not in the diff, or line not inside a changed hunk (+-3 lines)
  duplicate     same file + issue, or same file + line + quote
  over_cap      more than review_max_findings (most severe kept)
Findings at or above review_block_severity (default major) block.

Hook (wire in pipeline.Pipeline._work, right after verify(...) returned ok and BEFORE
_commit_unit / merge enqueue):

    from .review import Ctx, reviewer
    ro = reviewer.on_verified(Ctx.from_pipeline(self), unit.id, br.attempt)
    self._charge(unit.id, ro.usd)
    if not ro.proceed:
        out.update(verified=False, gate_code=ro.code); return out

on_verified() is a no-op (action "skip", proceed True) unless review_enabled is on, or the
drift ladder asked for a review of this unit (unit.detail.drift.force_review).
A block sends the unit back (verified -> ready) on the shared retry ladder with the findings
as evidence on the attempt record (the builder's next prompt shows them; Gate code REVIEW_BLOCK).
After review_max_rounds blocking rounds, or when the ladder would escalate, the dispute goes to
the judge (judge_enabled) or the unit stops (REVIEW_BLOCK).

Fake LLM fixture key: role "reviewer", key "<unit>.<attempt>" (dry/reviewer/<unit>.<attempt>.json).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import E_ATTEMPT, E_GATE, E_UNIT, Gate, Span, Unit, UnitState, to_dict
from ..llm import load_prompt
from . import _common as C

SEVERITIES = ("info", "minor", "major", "critical")
RANK = {s: i for i, s in enumerate(SEVERITIES)}

SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["findings"],
    "properties": {
        "findings": {"type": "array", "items": {
            "type": "object",
            "required": ["severity", "file", "line", "issue", "spec_quote"],
            "properties": {
                "severity": {"type": "string"},
                "file": {"type": "string"},
                "line": {"type": ["integer", "string"]},
                "issue": {"type": "string"},
                "spec_quote": {"type": "string"},
                "span_id": {"type": "string"},
                "fix": {"type": "string"},
            }}},
        "summary": {"type": "string"},
    },
}

#: attempt / unit fields the packet must never carry (the builder's conversation and history)
FORBIDDEN_SOURCES = ("final", "transcript", "prompt", "messages", "evidence", "blocked_reason", "nudge")


# ------------------------------------------------------------------ packet


@dataclass
class ReviewPacket:
    unit: str
    attempt: int
    spans: List[Span]
    contract: Dict[str, Any]
    files: List[str]
    patch: str
    tests: Dict[str, Any]

    def render(self, max_diff_chars: int = 40000) -> Dict[str, str]:
        patch = self.patch
        if len(patch) > max_diff_chars:
            patch = patch[:max_diff_chars] + "\n... (diff truncated at %d chars)" % max_diff_chars
        c = self.contract
        contract = "\n".join([
            "unit: %s - %s" % (c.get("id", ""), c.get("title", "")),
            "contract unit: %s" % ("yes" if c.get("contract") else "no"),
            "F-items: %s" % (", ".join(c.get("f_items") or []) or "(none)"),
            "claims (files it may write): %s" % (", ".join(c.get("claims") or []) or "(none)"),
            "depends on: %s" % (", ".join(c.get("deps") or []) or "(none)"),
            "acceptance tests: %s" % (", ".join(c.get("tests") or []) or "(none)"),
        ] + ["criterion %s: %s" % (k["id"], k["text"]) for f in c.get("criteria_of") or [] for k in f["criteria"]])
        t = self.tests
        tests = "verifier: %s%s; acceptance tests passed: %s of %s%s" % (
            "ok" if t.get("ok") else "failed", (" (%s)" % t["code"]) if t.get("code") else "",
            t.get("passed", "?"), t.get("total", "?"),
            ("; failing: " + ", ".join(t["failing"])) if t.get("failing") else "")
        return {"unit_id": self.unit, "attempt": str(self.attempt), "spec": C.render_spans(self.spans),
                "contract": contract, "files": ", ".join(self.files) or "(none)", "diff": patch or "(empty diff)",
                "tests": tests}


def _test_result(ctx: C.Ctx, unit: Unit, n: int, tests: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if tests is not None:
        return dict(tests)
    row = ctx.store.get(E_GATE, "%s:verify" % C.attempt_key(unit.id, n)) or {}
    g = row.get("gate") or {}
    det = g.get("detail") or {}
    att = ctx.store.get(E_ATTEMPT, C.attempt_key(unit.id, n)) or {}
    passed = det.get("passed", (att.get("detail") or {}).get("passed"))
    failing = [f.get("test", "") for f in det.get("failures") or [] if isinstance(f, Mapping)]
    return {"ok": bool(g.get("ok", att.get("outcome") == "verified")), "code": g.get("code", att.get("code", "")),
            "passed": passed if passed is not None else "?", "total": len(unit.tests or []), "failing": failing}


def build_packet(ctx: C.Ctx, unit: Any, attempt: int, diff: Any = None,
                 tests: Optional[Mapping[str, Any]] = None) -> ReviewPacket:
    """The reviewer's whole world. Reads: unit contract fields, frozen spec spans, the diff and the
    server's test result. Nothing from the builder's attempt detail (final message, evidence ...)."""
    u = C.load(ctx, unit)
    files, patch = C.diff_parts(C.get_diff(ctx, u, diff))
    contract = {"id": u.id, "title": u.title, "contract": bool(u.contract), "f_items": list(u.f_items or []),
                "claims": list(u.claims or []), "deps": list(u.deps or []), "tests": list(u.tests or []),
                "criteria_of": C.f_item_titles(ctx, u)}
    return ReviewPacket(u.id, int(attempt or u.attempt or 1), C.unit_spans(ctx, u), contract, files, patch,
                        _test_result(ctx, u, int(attempt or u.attempt or 1), tests))


# ------------------------------------------------------------------ noise filter


def _line(v: Any) -> int:
    try:
        return int(str(v).strip().split("-")[0].split(":")[0])
    except (TypeError, ValueError):
        return -1


def _path(p: Any) -> str:
    s = str(p or "").strip().replace("\\", "/")
    for pre in ("a/", "b/", "./"):
        if s.startswith(pre):
            s = s[len(pre):]
    return s


def finding_id(f: Mapping[str, Any]) -> str:
    return C.sha(f.get("file", ""), C.norm(f.get("spec_quote", "")), C.norm(f.get("issue", ""))[:80])


def filter_findings(raw: Sequence[Mapping[str, Any]], spans: Sequence[Span], patch: str, files: Sequence[str] = (),
                    max_findings: int = 10) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(kept, dropped). kept findings are normalised {id, severity, file, line, issue, spec_quote,
    span_id, fix}, most severe first; dropped carry "reason"."""
    fps = C.parse_patch(patch)
    known = set(_path(p) for p in files) | set(fps)
    kept: List[Dict[str, Any]] = []
    dropped: List[Dict[str, Any]] = []
    for r in raw or []:
        if not isinstance(r, Mapping):
            dropped.append({"reason": "malformed", "finding": str(r)[:200]})
            continue
        f = {"severity": str(r.get("severity", "")).strip().lower(), "file": _path(r.get("file")),
             "line": _line(r.get("line")), "issue": str(r.get("issue", "")).strip(),
             "spec_quote": str(r.get("spec_quote", "")).strip(), "fix": str(r.get("fix", "") or "").strip()}
        if f["severity"] not in RANK:
            dropped.append(dict(f, reason="bad_severity"))
            continue
        sid = C.quote_span(f["spec_quote"], spans)
        if not sid:
            dropped.append(dict(f, reason="no_quote"))
            continue
        f["span_id"] = sid
        fp = fps.get(f["file"])
        if f["file"] not in known or fp is None or f["line"] < 1 or not fp.touches(f["line"]):
            dropped.append(dict(f, reason="outside_diff"))
            continue
        f["id"] = finding_id(f)
        kept.append(f)
    kept.sort(key=lambda f: (-RANK[f["severity"]], f["file"], f["line"]))
    out: List[Dict[str, Any]] = []
    seen = set()
    for f in kept:
        keys = {("i", f["file"], C.norm(f["issue"])), ("q", f["file"], f["line"], C.norm(f["spec_quote"]))}
        if keys & seen:
            dropped.append(dict(f, reason="duplicate"))
            continue
        seen |= keys
        if len(out) >= max(int(max_findings), 0):
            dropped.append(dict(f, reason="over_cap"))
            continue
        out.append(f)
    return out, dropped


# ------------------------------------------------------------------ review


@dataclass
class ReviewResult:
    unit: str
    attempt: int
    gate: Gate
    findings: List[Dict[str, Any]] = field(default_factory=list)   # kept (after the noise filter)
    blocking: List[Dict[str, Any]] = field(default_factory=list)
    dropped: List[Dict[str, Any]] = field(default_factory=list)
    raw: int = 0
    summary: str = ""
    model: str = ""
    usd: float = 0.0
    error: str = ""

    @property
    def ok(self) -> bool:
        return self.gate.ok


def review_model(ctx: C.Ctx, unit: Unit) -> str:
    """review_model, else a model other than the one that built the unit."""
    m = str(C.setting(ctx.cfg, "review_model") or "")
    if m:
        return m
    main, alt = str(getattr(ctx.cfg, "model", "") or ""), str(getattr(ctx.cfg, "model_alt", "") or "")
    built = unit.model or main
    return alt if built == main and alt else main


def evidence_text(findings: Sequence[Mapping[str, Any]]) -> str:
    lines = ["Clean-context review blocked this attempt (%s). Fix every finding below; each one quotes the "
             "frozen spec it is held to." % C.REVIEW_BLOCK]
    for f in findings:
        lines.append("- [%s] %s:%s %s\n  spec (%s): \"%s\"%s" % (
            f["severity"], f["file"], f["line"], f["issue"], f.get("span_id", ""), f["spec_quote"],
            ("\n  suggested fix: " + f["fix"]) if f.get("fix") else ""))
    return "\n".join(lines)


def review(ctx: C.Ctx, unit: Any, attempt: int, diff: Any = None, tests: Optional[Mapping[str, Any]] = None,
           model: Optional[str] = None) -> ReviewResult:
    """One clean-context review: packet -> model -> noise filter -> gate record. No unit move."""
    cfg = ctx.cfg
    u = C.load(ctx, unit)
    packet = build_packet(ctx, u, attempt, diff, tests)
    n = packet.attempt
    m = model or review_model(ctx, u)
    vars_ = packet.render(int(C.setting(cfg, "review_max_diff_chars")))
    vars_["block_severity"] = str(C.setting(cfg, "review_block_severity"))
    prompt = load_prompt("reviewer", **vars_)
    res = None
    err = ""
    try:
        res = ctx.llm.complete("reviewer", prompt, SCHEMA, key=C.fixture_key(u.id, n), model=m, run=ctx.run)
    except LineError as e:
        err = "%s: %s" % (e.code, e.message)
    data = (res.data if res is not None else None) or {}
    raw = list(data.get("findings") or []) if isinstance(data, Mapping) else []
    kept, dropped = filter_findings(raw, packet.spans, packet.patch, packet.files,
                                    int(C.setting(cfg, "review_max_findings")))
    block_rank = RANK.get(str(C.setting(cfg, "review_block_severity")).lower(), RANK["major"])
    blocking = [f for f in kept if RANK[f["severity"]] >= block_rank]
    from ..build.verifier import combine
    fp = combine(f["id"] for f in blocking)
    if blocking:
        # Gate.fail() refuses codes not yet in codes.ALL_CODES; build the Gate directly
        gate = Gate(False, C.REVIEW_BLOCK, fp, {"findings": blocking, "evidence": evidence_text(blocking)})
    else:
        gate = Gate.passed(findings=len(kept))
    out = ReviewResult(u.id, n, gate, kept, blocking, dropped, len(raw),
                       str(data.get("summary", "") if isinstance(data, Mapping) else ""),
                       (res.model if res is not None else "") or m, float(res.usd if res is not None else 0.0), err)
    ctx.store.put(E_GATE, "%s:review" % C.attempt_key(u.id, n),
                  {"gate": to_dict(gate), "unit": u.id, "attempt": n, "name": "review", "run": u.run,
                   "model": out.model, "raw": out.raw, "kept": kept, "dropped": dropped, "error": err,
                   "usd": out.usd}, run=u.run)
    C.emit(ctx, C.KIND_REVIEW_DONE, {"ok": gate.ok, "raw": out.raw, "kept": len(kept), "dropped": len(dropped),
                                     "blocking": len(blocking), "fingerprint": fp, "error": err},
           unit=u.id, attempt=n, model=out.model)
    return out


# ------------------------------------------------------------------ hook


@dataclass
class ReviewOutcome:
    action: str                      # skip | pass | sent_back | stopped | judged_pass | judged_fix | judged_stop
    proceed: bool                    # True: the unit may be committed / merged
    code: str = ""
    result: Optional[ReviewResult] = None
    decision: Optional[Dict[str, Any]] = None
    usd: float = 0.0


def _forced(row: Mapping[str, Any]) -> bool:
    return bool(((row.get("detail") or {}).get("drift") or {}).get("force_review"))


def on_verified(ctx: C.Ctx, unit_id: str, attempt: int, diff: Any = None,
                tests: Optional[Mapping[str, Any]] = None) -> ReviewOutcome:
    """Pipeline hook after a passed verify (see module doc). Disabled unless review_enabled or forced
    by the drift ladder."""
    row = ctx.store.get(E_UNIT, unit_id) or {}
    if not row or not (C.setting(ctx.cfg, "review_enabled") or _forced(row)):
        return ReviewOutcome("skip", True)
    res = review(ctx, unit_id, attempt, diff, tests)
    if _forced(row):
        drift = dict((row.get("detail") or {}).get("drift") or {})
        drift["force_review"] = False
        C.set_unit_detail(ctx, unit_id, drift=drift)
    if res.ok:
        if res.error:
            ctx.say("%s: review of %s failed to run (%s); unit proceeds" % (ctx.run, unit_id, res.error))
        return ReviewOutcome("pass", True, result=res, usd=res.usd)
    return _block(ctx, unit_id, res)


def _block(ctx: C.Ctx, unit_id: str, res: ReviewResult) -> ReviewOutcome:
    u = C.load(ctx, unit_id)
    rv = dict((u.detail or {}).get("review") or {})
    rounds = int(rv.get("rounds", 0)) + 1
    rv.update({"rounds": rounds, "last": res.gate.fingerprint, "attempt": res.attempt})
    evidence = res.gate.detail.get("evidence", "")
    C.mark_attempt(ctx, u, res.attempt, C.REVIEW_BLOCK, evidence, review_findings=res.blocking)
    max_rounds = max(int(C.setting(ctx.cfg, "review_max_rounds")), 1)
    from ..watchdog import plan_failure
    ladder = plan_failure(ctx.store.get(E_UNIT, unit_id) or {}, C.REVIEW_BLOCK, res.gate.fingerprint,
                          int(getattr(ctx.cfg, "retry_n", 3) or 3))
    if rounds >= max_rounds or ladder.action == "escalate":
        C.set_unit_detail(ctx, unit_id, review=rv)
        return _dispute(ctx, u, res, rounds)
    action, _ = C.send_back(ctx, unit_id, C.REVIEW_BLOCK, res.gate.fingerprint,
                            {"findings": [f["id"] for f in res.blocking]}, unit_detail={"review": rv})
    ctx.say("%s: review blocked %s (%d finding(s)) -> %s" % (ctx.run, unit_id, len(res.blocking), action))
    return ReviewOutcome("sent_back" if action != "escalate" else "stopped", False, C.REVIEW_BLOCK, res, usd=res.usd)


def _dispute(ctx: C.Ctx, u: Unit, res: ReviewResult, rounds: int) -> ReviewOutcome:
    """Reviewer still blocks after the allowed rounds: the judge settles it against the frozen spec,
    or (judge off) the unit stops."""
    if not C.setting(ctx.cfg, "judge_enabled"):
        C.stop_unit(ctx, u.id, C.REVIEW_BLOCK, "unit %s: review still blocking after %d round(s)" % (u.id, rounds),
                    {"findings": [f["id"] for f in res.blocking], "rounds": rounds})
        return ReviewOutcome("stopped", False, C.REVIEW_BLOCK, res, usd=res.usd)
    from . import judge
    dec = judge.decide_dispute(ctx, u, res)
    usd = res.usd + float(dec.get("usd", 0.0) or 0.0)
    choice = dec["choice"]
    if choice == "builder":
        rv = dict((C.load(ctx, u.id).detail or {}).get("review") or {})
        rv["overruled_by"] = dec["id"]
        C.set_unit_detail(ctx, u.id, review=rv)
        return ReviewOutcome("judged_pass", True, result=res, decision=dec, usd=usd)
    if choice == "fix":
        ev = res.gate.detail.get("evidence", "") + "\n\nJudge ruling (%s): %s" % (dec["id"], dec.get("instructions", ""))
        C.mark_attempt(ctx, u, res.attempt, C.REVIEW_BLOCK, ev, review_findings=res.blocking, decision=dec["id"])
        action, _ = C.send_back(ctx, u.id, C.REVIEW_BLOCK, res.gate.fingerprint + ":" + dec["id"],
                                {"decision": dec["id"]}, use_ladder=False)
        return ReviewOutcome("judged_fix", False, C.REVIEW_BLOCK, res, dec, usd)
    C.stop_unit(ctx, u.id, C.REVIEW_BLOCK, "unit %s stopped by the judge (%s)" % (u.id, dec["id"]),
                {"decision": dec["id"], "spec_gap": bool(dec.get("spec_gap"))})
    return ReviewOutcome("judged_stop", False, C.REVIEW_BLOCK, res, dec, usd)


# ------------------------------------------------------------------ noise metric (G11)


def noise_stats(store: Any, run: Optional[str] = None) -> Dict[str, Any]:
    """Reviewer noise: share of raw findings dropped by the filter, and share of blocking findings
    that the next attempt fixed (the finding id is not raised again)."""
    rows = [r for r in store.query(E_GATE, run=run) if r.get("name") == "review"]
    raw = sum(int(r.get("raw", 0) or 0) for r in rows)
    kept = sum(len(r.get("kept") or []) for r in rows)
    by_unit: Dict[str, List[Mapping[str, Any]]] = {}
    for r in rows:
        by_unit.setdefault(str(r.get("unit")), []).append(r)
    raised = fixed = 0
    for rs in by_unit.values():
        rs = sorted(rs, key=lambda r: int(r.get("attempt", 0)))
        for a, b in zip(rs, rs[1:]):
            blk = [f["id"] for f in (a.get("gate") or {}).get("detail", {}).get("findings", [])]
            later = {f["id"] for f in b.get("kept") or []}
            raised += len(blk)
            fixed += len([i for i in blk if i not in later])
    return {"reviews": len(rows), "raw": raw, "kept": kept,
            "noise_ratio": round(1.0 - kept / raw, 4) if raw else 0.0,
            "blocking_followed_up": raised, "fixed": fixed,
            "fixed_ratio": round(fixed / raised, 4) if raised else None}
