"""Phase 5: change proposals, runtime parameter overrides, poisoning checks, shadow mode, automatic fallback
(roadmap E-5 slice S14; docs/roadmap-e-to-5-design.md section 7, decisions F3 and F4).

Default off: ``KH_CAP_IMPROVE=on`` attaches it, and it acts only while the ``kh_people`` namespace is active
(``KH_CAP_PEOPLE=on``). ``KH_IMPROVE_MODE`` (default ``off``):

  off     /improve/propose answers 409; ``param()`` returns the caller's default; nothing is recorded
  shadow  the whole loop runs (poisoning checks, bench hook) and KH's verdict is recorded as a RECOMMENDATION
          (``improve.decision`` with ``applied: false``) next to fen's own decision (POST /improve/decide);
          nothing is applied and stored overrides are not read
  on      as shadow, and KH applies ``param`` decisions (a runtime override row) and hands ``item`` decisions to
          the learning loop (app/caps/learn.py: D's checks, the offline gate and the randomized trial).
          ``policy_proposal`` is NEVER applied (roadmap: policies are only proposed; always fen)

KINDS (design 7.2):
  item             target {project, action?, context?, supersedes?}, change {text, title?}.
                   Measured by the 5.3 gate + 5.4 trial (learn.propose). A ``supersedes`` target never goes
                   automatic (no automatic supersede of a human-approved item): verdict ``fen``.
  param            target = a name of the ALLOWLIST (``settings.improve.param_allowlist``), change {value}.
                   Numbers: absolute bounds (``BOUNDS``) refuse, a step beyond +-``param_step_max`` (20%) of the
                   current value is CLAMPED to the boundary. ``signal_words``: change {add[], remove[]}, at most
                   max(1, 20% of the current word count) per step (the rest is clamped away), every word leak- and
                   injection-checked. Measured by the ``BENCH[0]`` hook (tier-1 + p1bench with the override set
                   per request, ``request_overrides``); no hook = verdict ``hold`` (bench pending).
  policy_proposal  target {text-ish}, change {text}. Checks run; verdict ``fen`` always; never applied.

POISONING CHECKS (before any measurement; each failure is a reason code, the verdict is ``reject``):
  size        the proposal JSON <= PROPOSAL_MAX chars, change text <= TEXT_MAX
  injection   agent text is data: instruction-shaped text ("ignore ... instructions", "system prompt", role
              tags, tool names, shell, encoded blobs, URLs outside ``settings.improve.url_allowlist``); the text
              is NFKC-normalised and zero-width characters are stripped first
  leak        app/distill._leak (strict: e-mail, assigned secrets, key/JWT shapes, hosts, IPs) and the
              kh-default redaction pack
  canary      KH canary format ``khc-<16 hex>`` and every registered vault canary scanner (each namespace with
              a vault, plus kh_people)
  evidence    ``evidence {serve_ids[], outcome_ids[]}`` must name REAL ``kh.served`` / ``step.outcome`` events of
              kh_people; an outcome must belong to one of the named serves; >= ``evidence_sessions_min`` (2)
              distinct sessions with 2 callers or 2 projects (the learn rule)
  allowlist / range / type / no_change   (param)
  lint        (item) the items lint (imperative, <= 400 chars, no hedges)
  rate        <= ``proposals_per_principal_day`` (20) per proposer per 24 h: the 21st answers 429 ``quota``
              and is not recorded (a flood cannot fill the event store)
The red-team set ``tools/kh_bench/redteam_p5.json`` plants >= 20 poisonings; tests/caps/test_improve.py
requires 100% of them caught (gate off -> shadow, design 7.3).

STORAGE. No new table. Decisions are ``improve.decision`` events in kh_people (event id ``ik_<pid>`` = KH's
verdict, ``if_<pid>`` = fen's decision, ``iv_*`` = a revert, ``ib_*`` = a fallback or its clear); ``run_id`` is the
proposal id and ``unit_id`` a sha12 of the proposer (the rate limit), never the proposer's e-mail. A REJECTED
proposal's text is never stored (only its sha and the reason codes), so a planted secret never lands anywhere.
Overrides and the fallback state live in ``kh_ns.config_json.improve`` of kh_people, read through the 5 s
namespace cache (no deploy; revert = delete the row): ``{overrides: {name: {value, proposal, set_ms, by}},
fallback: {active, since_ms, reason}, cleared_ms}``. ``registry.apply_manifest`` keeps unknown config keys, so a
manifest re-apply never drops them.

READ PATH. ``param(name, default)`` - what a parameter's consumer calls: a per-request override first
(``request_overrides``, the bench), then the stored override while the effective mode is ``on``, else
``default``. It never raises. Consumers: app/step.py (KH_STEP_FLOOR, KH_STEP_KNOW_ENOUGH, and the maintainer
request field ``overrides`` of POST /context/step), app/caps/retrieval.py (KH_STEP_FLOOR), app/turn.py
(KH_TURN_LESSON_FLOOR), app/distill.py (KH_DISTILL_CONFIRM, KH_DISTILL_SAMPLE_PCT, signal_words). The bench hook
behind ``BENCH[0]`` is app/caps/benchhook.py (opt-in, ``KH_BENCH_HOOK=1``).

FALLBACK (F4). While ``KH_IMPROVE_MODE=on``, KH falls back to ``shadow`` automatically - persisted in the state
row, so every instance and every restart sees it, and announced by ``improve.decision`` (``ib_*``) plus
``kh.improve_fallback`` - on ANY leak hit (a proposal caught by the leak or canary check while on, or a
``kh.canary_hit`` in kh_people) or on ``fallback_rollbacks`` (2) rollbacks within ``fallback_days`` (7 days)
(``kh.item_rollback`` in kh_people, plus overrides reverted for harm). Only a maintainer clears it
(POST /improve/fallback); the window then restarts at the clear. Cron ``improve_fallback`` every 15 min.

PHASE 4. A global stop (``agents:stop``: some namespace carries ``config.stopped_from``) makes KH apply nothing
(the verdict is recorded with ``mode: shadow``, reason ``global_stop``), and agent tokens of a suspended
namespace are refused at the door. The phase 4 approval gate (428) is about effect keys of agent namespaces;
improve's only side effects are revertible runtime overrides and learn trials, so it is not used here.

ROUTES (rules in app/auth_rules.json):
  POST /improve/propose     maintainers, the kh_people worker token, and active agent principals of the
                            namespaces in ``settings.improve.agent_namespaces`` (default ``kh_ops``, ``ops_pilot``) - the rule
                            carries ``"agents": true``; ordinary people are refused
  GET  /improve/proposals   maintainers: proposals with KH's verdict and fen's decision
  GET  /improve/state       maintainers: modes, fallback, overrides, agreement with fen
  POST /improve/decide      maintainers: fen's decision {id, decision accept|reject, reason?}
  POST /improve/revert      maintainers: delete an override row {param, harm?}
  POST /improve/fallback    maintainers: clear the automatic fallback
"""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import hashlib
import json
import logging
import math
import re
import time
import unicodedata
from typing import Any, Callable

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import auth, config, sqldb
from app.caps import core
from app.caps.core import CapError

logger = logging.getLogger(__name__)

NAME = "improve"
VERSION = "1.0.0"
STATUS = "beta"
DEFAULT_ON = False                       # KH_CAP_IMPROVE=on attaches it (design 7, F5)

DECISION = "improve.decision"
KINDS = ("item", "param", "policy_proposal")
MODES = ("off", "shadow", "on")
VERDICTS = ("accept", "reject", "fen", "hold")
DAY_MS = 86_400_000
PROPOSAL_MAX = 8000
TEXT_MAX = 2000
IDS_MAX = 200
SCAN_MAX = 20_000
LIST_MAX = 500
FALLBACK_INTERVAL_S = 900
LIMITS = {"proposal_chars": PROPOSAL_MAX, "text_chars": TEXT_MAX, "evidence_ids": IDS_MAX, "list_max": LIST_MAX}

DEFAULTS: dict[str, Any] = {
    "min_decided": 30, "agreement_min": 0.90, "rollback_rate_max": 0.10, "fallback_rollbacks": 2,
    "fallback_days": 7, "proposals_per_principal_day": 20, "param_step_max": 0.20, "tier2_per_month": 4,
    "redteam_required": 20, "evidence_sessions_min": 2,
    "param_allowlist": ["KH_STEP_FLOOR", "KH_STEP_KNOW_ENOUGH", "KH_TURN_LESSON_FLOOR", "KH_DISTILL_CONFIRM",
                        "KH_DISTILL_SAMPLE_PCT", "signal_words"],
    # ops_pilot: the phase 4 pilot namespace (tools/kh_agents). PUT /v1/admin/ns reserves every kh* name, so the
    # design's kh_ops can never be attached through the API; without ops_pilot here no pilot agent could propose.
    "agent_namespaces": ["kh_ops", "ops_pilot"], "url_allowlist": [],
}

#: Numeric parameters: (lower, upper, integer?) and where today's value comes from.
BOUNDS: dict[str, tuple[float, float, bool]] = {
    "KH_STEP_FLOOR": (0.0, 1.0, False), "KH_STEP_KNOW_ENOUGH": (0.0, 1.0, False),
    "KH_TURN_LESSON_FLOOR": (0.0, 1.0, False), "KH_DISTILL_CONFIRM": (0.0, 1.0, False),
    "KH_DISTILL_SAMPLE_PCT": (0.0, 100.0, True),
}
_CONFIG_ATTR = {"KH_STEP_FLOOR": "STEP_FLOOR", "KH_STEP_KNOW_ENOUGH": "STEP_KNOW_ENOUGH",
                "KH_TURN_LESSON_FLOOR": "TURN_LESSON_FLOOR", "KH_DISTILL_CONFIRM": "DISTILL_CONFIRM",
                "KH_DISTILL_SAMPLE_PCT": "DISTILL_SAMPLE_PCT"}
LIST_PARAMS = ("signal_words",)

#: The bench hook for param proposals: ``fn(proposal: dict) -> {"ok": bool, ...}``. None = pending (``hold``).
BENCH: list[Callable[[dict], dict] | None] = [None]

ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
CANARY_RE = re.compile(r"khc-[0-9a-f]{16}")
_ZERO_WIDTH = re.compile("[­᠎​-‏‪-‮⁠-⁤﻿]")
_URL = re.compile(r"(?i)\b(?:https?|ftp|file|data|javascript|vbscript)\s*:\s*/*\S+")
INJECTION: list[tuple[str, re.Pattern]] = [
    ("override_instructions", re.compile(
        r"(?i)\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,60}?\b(?:instructions?|prompts?|rules?|"
        r"previous|above|prior|polic(?:y|ies)|guard(?:rail)?s?|checks?|safety|filters?|gates?)\b")),
    ("system_prompt", re.compile(r"(?i)\bsystem[\s_-]*prompt\b|\bdeveloper\s+(?:message|mode)\b|\bjailbreak\b")),
    ("role_play", re.compile(r"(?i)\byou\s+are\s+now\b|\bact\s+as\s+(?:an?\s+)?(?:admin|maintainer|system|root)\b|"
                             r"\bnew\s+instructions?\b|\bfrom\s+now\s+on\b")),
    ("role_tag", re.compile(r"(?im)</?\s*(?:system|assistant|user|instructions?|tool_use|tool_result|"
                            r"function_calls?|invoke|antml:[a-z_]+)\b[^>]{0,40}>|<\|[a-z_]{2,30}\|>|"
                            r"^\s*(?:system|assistant|human|user)\s*:")),
    ("tool_name", re.compile(r"\b(?:kh_call|kh_message|kh_members|kh_context|kh_help|kh_me|kh_status|"
                             r"Bash|PowerShell|WebFetch|WebSearch|NotebookEdit|TodoWrite|mcp__[A-Za-z0-9_]+)\b")),
    ("shell", re.compile(r"(?i)\b(?:curl|wget|sudo|chmod|chown|rm\s+-rf|eval|exec|powershell\s+-|"
                         r"invoke-webrequest|iex)\b|\$\([^)]*\)")),
    ("encoded", re.compile(r"[A-Za-z0-9+/]{60,}={0,2}|(?:\\x[0-9a-fA-F]{2}){8,}|(?:%[0-9a-fA-F]{2}){8,}")),
]

_req: contextvars.ContextVar[dict | None] = contextvars.ContextVar("kh_improve_overrides", default=None)


def init(c) -> None:                     # noqa: ARG001 - no tables: kh_people events and kh_ns config only
    sqldb.migrate(c, NAME, [])


# ── mode and settings ────────────────────────────────────────────────────────

def mode() -> str:
    """``KH_IMPROVE_MODE`` = off | shadow | on (unknown = off)."""
    raw = (config._env("KH_IMPROVE_MODE", "off") or "off").strip().lower()
    return raw if raw in MODES else "off"


def enabled() -> bool:
    """Attached and kh_people active."""
    from app import caps
    from app.caps import people
    try:
        return caps.is_loaded(NAME) and people.active()
    except Exception:  # noqa: BLE001 - a read never fails on the improvement loop
        return False


def conf() -> dict:
    from app.caps import people
    out = {k: (list(v) if isinstance(v, list) else v) for k, v in DEFAULTS.items()}
    try:
        s = people.settings("improve")
    except Exception:  # noqa: BLE001
        s = {}
    for k, v in s.items():
        if k not in DEFAULTS:
            continue
        if isinstance(DEFAULTS[k], list) and isinstance(v, list) and all(isinstance(x, str) for x in v):
            out[k] = list(v)
        elif isinstance(DEFAULTS[k], (int, float)) and isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = v
    return out


def _state() -> dict:
    """``kh_ns.config_json.improve`` of kh_people (5 s namespace cache)."""
    from app.caps import people
    row = people.ns_row() or {}
    st = (row.get("config") or {}).get("improve")
    return st if isinstance(st, dict) else {}


def _fresh_state(c) -> tuple[dict, dict, int]:
    from app.caps import people
    r = c.execute("SELECT config_json, rev FROM kh_ns WHERE ns=?", [people.NS]).fetchone()
    if r is None:
        raise CapError("ns_not_active", "kh_people is not attached (KH_CAP_PEOPLE=on)", status=503)
    cfg = json.loads(r["config_json"] or "{}")
    st = cfg.get("improve") if isinstance(cfg.get("improve"), dict) else {}
    return cfg, st, int(r["rev"])


def _update_state(fn: Callable[[dict], dict | None]) -> dict:
    """Read-modify-write of the state row, conditional on kh_ns.rev (retried on a concurrent change)."""
    from app.caps import people, registry
    for _ in range(8):
        with sqldb.connect() as c:
            cfg, st, rev = _fresh_state(c)
            new = fn(json.loads(json.dumps(st)))
            if new is None:
                return st
            cfg["improve"] = new
            if sqldb.update(c, "UPDATE kh_ns SET config_json=?, rev=rev+1 WHERE ns=? AND rev=?",
                            [core.jdump(cfg), people.NS, rev]):
                registry.invalidate(people.NS)
                return new
    raise CapError("write_conflict", "the improve state kept changing; try again")


def fallback_active() -> bool:
    try:
        return bool((_state().get("fallback") or {}).get("active"))
    except Exception:  # noqa: BLE001
        return False


def global_stop() -> bool:
    """True while a phase 4 ``agents:stop`` is in force (a namespace carries ``config.stopped_from``)."""
    try:
        with sqldb.connect() as c:
            rows = c.execute("SELECT config_json FROM kh_ns WHERE state='suspended'").fetchall()
        return any("stopped_from" in json.loads(r["config_json"] or "{}") for r in rows)
    except Exception:  # noqa: BLE001
        return False


def effective_mode() -> str:
    """``on`` falls back to ``shadow`` while the persisted F4 fallback is active."""
    m = mode()
    if m == "on" and fallback_active():
        return "shadow"
    return m


# ── the read path ────────────────────────────────────────────────────────────

def current_default(name: str):
    """Today's value of an allowlisted parameter (process config, or the signal word table)."""
    if name in _CONFIG_ATTR:
        return getattr(config, _CONFIG_ATTR[name])
    if name == "signal_words":
        from app import distill
        return [w["word"] for w in distill.signal_words()]
    raise KeyError(name)


def _valued(name: str, stored, default):
    if name in LIST_PARAMS:
        if not isinstance(stored, dict) or not isinstance(default, (list, tuple)):
            return default
        rm = set(stored.get("remove") or [])
        out = [w for w in default if w not in rm]
        return out + [w for w in stored.get("add") or [] if w not in out]
    if isinstance(stored, (int, float)) and not isinstance(stored, bool) and math.isfinite(stored):
        lo, hi, integer = BOUNDS.get(name, (-math.inf, math.inf, False))
        if lo <= stored <= hi:
            return int(stored) if integer else float(stored)
    return default


def param(name: str, default):
    """THE read function for a tunable parameter's consumer. Never raises; the default whenever in doubt."""
    try:
        req = _req.get()
        if req and name in req:
            return _valued(name, req[name], default)
        from app import caps
        if not caps.is_loaded(NAME) or effective_mode() != "on":
            return default
        row = (_state().get("overrides") or {}).get(name)
        return default if not isinstance(row, dict) else _valued(name, row.get("value"), default)
    except Exception:  # noqa: BLE001 - a tuning read must never break a request
        return default


@contextlib.contextmanager
def request_overrides(values: dict):
    """Per-request overrides for the bench (maintainer param ``overrides``): allowlist and bounds apply."""
    c = conf()
    clean = {}
    for k, v in (values or {}).items():
        if k not in c["param_allowlist"]:
            raise CapError("invalid", f"{k} is not an allowlisted parameter")
        if k in BOUNDS:
            lo, hi, _ = BOUNDS[k]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
                raise CapError("invalid", f"{k} must be a number in [{lo}, {hi}]")
        elif not isinstance(v, dict):
            raise CapError("invalid", f"{k} must be {{add[], remove[]}}")
        clean[k] = v
    tok = _req.set(clean)
    try:
        yield clean
    finally:
        _req.reset(tok)


def overrides() -> dict:
    return dict(_state().get("overrides") or {})


# ── poisoning checks ─────────────────────────────────────────────────────────

def _norm(text: str) -> str:
    return _ZERO_WIDTH.sub("", unicodedata.normalize("NFKC", text or ""))


def _strings(v, out: list[str]) -> list[str]:
    if isinstance(v, str):
        out.append(v)
    elif isinstance(v, dict):
        for k, x in v.items():
            _strings(str(k), out)
            _strings(x, out)
    elif isinstance(v, (list, tuple)):
        for x in v:
            _strings(x, out)
    return out


def _url_ok(url: str, allow: list[str]) -> bool:
    u = url.lower()
    return any(u.startswith(a.lower()) for a in allow if a)


def injection_hits(text: str, allow_urls: list[str] | None = None) -> list[str]:
    """Names of the instruction-shaped patterns in ``text`` (agent text is data)."""
    t = _norm(text)
    hits = [name for name, rx in INJECTION if rx.search(t)]
    if any(not _url_ok(m.group(0), allow_urls or []) for m in _URL.finditer(t)):
        hits.append("url")
    return hits


def leak_hit(text: str, allow_urls: list[str] | None = None) -> bool:
    from app import distill
    t = _norm(text)
    for a in allow_urls or []:
        t = t.replace(a, " ")
    return distill._leak(t, frozenset(), strict=True) is not None


def canary_hit(text: str) -> bool:
    t = _norm(text)
    if CANARY_RE.search(t):
        return True
    from app.caps import people, redact
    if not redact.CANARY_SCANNERS:
        return False
    try:
        with sqldb.connect() as c:
            nss = [r[0] for r in c.execute("SELECT DISTINCT ns FROM kh_vault_canary").fetchall()][:50]
    except Exception:  # noqa: BLE001 - no vault capability
        nss = []
    return any(redact._canaries(ns, t) for ns in dict.fromkeys(nss + [people.NS]))


def _rows(c, kind: str, ids: list[str]) -> list:
    from app.caps import people
    out = []
    for k in range(0, len(ids), 200):
        part = ids[k:k + 200]
        out += c.execute(f"SELECT id, session_id, project, body_json FROM kh_event WHERE ns=? AND kind=? AND id IN "
                         f"({','.join('?' for _ in part)})", [people.NS, kind] + part).fetchall()
    return out


def check_evidence(ev: Any, need: int) -> tuple[list[str], dict]:
    """Reason codes (empty = ok) and the counts. Ids must be real kh.served / step.outcome events."""
    from app.caps import outcomes
    if not isinstance(ev, dict):
        return ["evidence_missing"], {}
    serve_ids, outcome_ids = ev.get("serve_ids") or [], ev.get("outcome_ids") or []
    if not isinstance(serve_ids, list) or not isinstance(outcome_ids, list) \
            or len(serve_ids) > IDS_MAX or len(outcome_ids) > IDS_MAX:
        return ["evidence_invalid"], {}
    if not all(isinstance(x, str) and ID_RE.match(x) for x in serve_ids + outcome_ids):
        return ["evidence_invalid"], {}
    serve_ids, outcome_ids = list(dict.fromkeys(serve_ids)), list(dict.fromkeys(outcome_ids))
    if not serve_ids:
        return ["evidence_missing"], {}
    with sqldb.connect() as c:
        served = {r["id"]: r for r in _rows(c, outcomes.SERVED, serve_ids)}
        outs = {r["id"]: r for r in _rows(c, outcomes.OUTCOME, outcome_ids)}
    codes = []
    if len(served) < len(serve_ids) or len(outs) < len(outcome_ids):
        codes.append("evidence_fake")
    for oid, r in outs.items():
        if outcomes.serve_id_of(oid, json.loads(r["body_json"] or "{}")) not in served:
            codes.append("evidence_unlinked")
            break
    bodies = [json.loads(r["body_json"] or "{}") for r in served.values()]
    sessions = {r["session_id"] for r in served.values() if r["session_id"]}
    callers = {b.get("caller") for b in bodies if b.get("caller")}
    projects = {b.get("project") or r["project"] for b, r in zip(bodies, served.values()) if b.get("project") or
                r["project"]}
    counts = {"serves": len(served), "outcomes": len(outs), "sessions": len(sessions), "callers": len(callers),
              "projects": len(projects)}
    if not codes and not (len(sessions) >= need and (len(callers) >= 2 or len(projects) >= 2)):
        codes.append("evidence_thin")
    return codes, counts


def _check_param(target: str, change: dict, c: dict) -> tuple[list[str], dict]:
    """(codes, {value, base, clamped}) for one parameter proposal."""
    if target not in c["param_allowlist"] or (target not in BOUNDS and target not in LIST_PARAMS):
        return ["allowlist"], {}
    step = float(c["param_step_max"])
    cur_row = (overrides().get(target) or {}).get("value")
    if target in LIST_PARAMS:
        base = current_default(target)
        base_now = _valued(target, cur_row, base) if cur_row is not None else base
        add, rm = change.get("add") or [], change.get("remove") or []
        if not isinstance(add, list) or not isinstance(rm, list) or not all(isinstance(w, str) for w in add + rm):
            return ["type"], {}
        from app import distill
        add = [distill.fold(w) for w in add]
        rm = [distill.fold(w) for w in rm]
        add = [w for w in dict.fromkeys(add) if w and w not in base_now]
        rm = [w for w in dict.fromkeys(rm) if w in base_now]
        lo, hi = config.DISTILL_SIGNAL_MIN_CHARS, config.DISTILL_SIGNAL_MAX_CHARS
        if any(not lo <= len(w) <= hi for w in add):
            return ["range"], {}
        if not add and not rm:
            return ["no_change"], {}
        limit = max(1, int(len(base_now) * step))
        clamped = len(add) + len(rm) > limit
        rm = rm[:limit]
        add = add[:max(0, limit - len(rm))]
        prev = cur_row if isinstance(cur_row, dict) else {"add": [], "remove": []}
        value = {"add": [w for w in prev.get("add", []) if w not in rm] + add,
                 "remove": [w for w in prev.get("remove", []) if w not in add] + rm}
        return [], {"value": value, "step": {"add": add, "remove": rm}, "clamped": clamped, "limit": limit}
    lo, hi, integer = BOUNDS[target]
    v = change.get("value")
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(float(v)):
        return ["type"], {}
    if not lo <= v <= hi:
        return ["range"], {}
    base = _valued(target, cur_row, current_default(target)) if cur_row is not None else current_default(target)
    base = float(base)
    limit = step * abs(base) if base else step * (hi - lo)
    new = float(v)
    clamped = abs(new - base) > limit + 1e-12
    if clamped:
        new = base + math.copysign(limit, new - base)
    if integer:
        new = float(math.floor(new) if new > base else math.ceil(new))
    new = min(hi, max(lo, new))
    if abs(new - base) < 1e-12:
        return ["no_change"], {}
    return [], {"value": int(new) if integer else round(new, 6), "base": base, "clamped": clamped,
                "limit": round(limit, 6)}


def check(proposal: dict) -> dict:
    """Every poisoning check on one proposal. ``{ok, codes, param?, evidence}``. Pure apart from reads."""
    c = conf()
    codes: list[str] = []
    kind, target, change = proposal.get("kind"), proposal.get("target"), proposal.get("change")
    out: dict[str, Any] = {}
    if kind not in KINDS:
        return {"ok": False, "codes": ["kind"]}
    try:
        raw = core.jdump({k: proposal.get(k) for k in ("kind", "target", "change", "evidence")})
    except (TypeError, ValueError):
        return {"ok": False, "codes": ["invalid"]}
    if len(raw) > PROPOSAL_MAX:
        return {"ok": False, "codes": ["size"]}
    if not isinstance(change, dict):
        return {"ok": False, "codes": ["invalid"]}
    texts = _strings(target, []) + _strings(change, [])
    blob = "\n".join(texts)
    if any(len(t) > TEXT_MAX for t in texts):
        codes.append("size")
    inj = injection_hits(blob, c["url_allowlist"])
    if inj:
        codes.append("injection")
        out["injection"] = inj
    if leak_hit(blob, c["url_allowlist"]):
        codes.append("leak")
    if canary_hit(blob):
        codes.append("canary")
    ev_codes, counts = check_evidence(proposal.get("evidence"), int(c["evidence_sessions_min"]))
    codes += ev_codes
    out["evidence"] = counts
    if kind == "param":
        if not isinstance(target, str):
            codes.append("allowlist")
        else:
            p_codes, p = _check_param(target, change, c)
            codes += p_codes
            if p:
                out["param"] = p
    elif kind == "item":
        text = change.get("text")
        if not isinstance(target, dict) or not isinstance(target.get("project"), str) or not target["project"]:
            codes.append("invalid")
        if not isinstance(text, str) or not text.strip():
            codes.append("invalid")
        elif not codes:
            from app.caps import items, people
            with sqldb.connect() as conn:
                lint = items.lint(conn, people.ns_row() or {}, text, [])
            if lint:
                codes.append("lint")
                out["lint"] = lint
    else:
        if not isinstance(change.get("text"), str) or not change["text"].strip():
            codes.append("invalid")
    out["codes"] = list(dict.fromkeys(codes))
    out["ok"] = not out["codes"]
    return out


# ── proposals and decisions ──────────────────────────────────────────────────

def _sha(s: str, n: int = 16) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:n]


def proposal_id(proposer: str, proposal: dict) -> str:
    body = {k: proposal.get(k) for k in ("kind", "target", "change", "evidence")}
    try:
        raw = core.jdump(body)
    except (TypeError, ValueError):
        raw = repr(body)
    return "imp_" + _sha(f"{proposer}\n{raw}")


def _event(eid: str) -> dict | None:
    from app.caps import people
    with sqldb.connect() as c:
        r = c.execute("SELECT id, ts_ms, run_id, unit_id, body_json FROM kh_event WHERE ns=? AND kind=? AND id=?",
                      [people.NS, DECISION, eid]).fetchone()
    return None if r is None else {"id": r["id"], "ts_ms": int(r["ts_ms"]), "run_id": r["run_id"],
                                   "unit_id": r["unit_id"], "body": json.loads(r["body_json"] or "{}")}


def _record(eid: str, body: dict, pid: str | None = None, unit: str | None = None,
            now_ms: int | None = None) -> None:
    from app.caps import people
    ev = {"id": eid[:64], "kind": DECISION, "body": body}
    if pid:
        ev["run_id"] = pid
    if unit:
        ev["unit_id"] = unit
    if now_ms is not None:
        ev["ts_ms"] = int(now_ms)
    people.append_events([ev])


def _recent_by(unit: str, now_ms: int) -> int:
    from app.caps import people
    with sqldb.connect() as c:
        # only KH's verdicts (ik_*) carry a unit_id: fen's decisions, reverts and fallbacks never do
        return int(c.execute("SELECT COUNT(*) FROM kh_event WHERE ns=? AND kind=? AND unit_id=? AND ts_ms>=?",
                             [people.NS, DECISION, unit, now_ms - DAY_MS]).fetchone()[0])


def _safe_target(kind: str, target, result: dict):
    """What of the target may be stored: nothing for a rejected proposal (it may carry the poison)."""
    if not result["ok"]:
        return target if kind == "param" and target in conf()["param_allowlist"] else None
    return target


def propose(proposal: dict, proposer: str, encode=None, now_ms: int | None = None) -> dict:
    """Check, measure and (mode on) apply one proposal. Writes exactly one ``improve.decision`` (ik_<pid>)."""
    m = mode()
    if m == "off":
        raise CapError("improve_off", "KH_IMPROVE_MODE is off")
    if not enabled():
        raise CapError("ns_not_active", "kh_people is not active (KH_CAP_PEOPLE=on)", status=503)
    now_ms = int(now_ms or time.time() * 1000)
    pid = proposal_id(proposer, proposal)
    old = _event(f"ik_{pid}")
    if old is not None:
        return {"id": pid, "duplicate": True, **{k: old["body"].get(k) for k in ("decision", "reason", "applied")}}
    unit = _sha(f"proposer:{proposer}", 12)
    c = conf()
    if _recent_by(unit, now_ms) >= int(c["proposals_per_principal_day"]):
        raise CapError("quota", f"at most {c['proposals_per_principal_day']} proposals per proposer per day")
    kind = proposal.get("kind")
    res = check(proposal)
    eff = effective_mode()
    stopped = global_stop()
    applying = eff == "on" and not stopped
    decision, reason, applied, extra = "reject", ",".join(res["codes"]), False, {}
    if res["ok"]:
        if kind == "policy_proposal":
            decision, reason = "fen", "policy_is_human"
        elif kind == "item" and (proposal.get("target") or {}).get("supersedes"):
            decision, reason = "fen", "no_auto_supersede"
        elif kind == "param":
            bench = BENCH[0]
            if bench is None:
                decision, reason = "hold", "bench_pending"
            else:
                try:
                    got = bench({**proposal, "value": res["param"]["value"]}) or {}
                    extra["bench"] = {k: v for k, v in got.items() if isinstance(v, (int, float, str, bool, list))}
                    decision, reason = ("accept", "bench_ok") if got.get("ok") else ("reject", "bench_regression")
                except Exception as exc:  # noqa: BLE001 - a broken bench never passes a proposal
                    decision, reason = "reject", "bench_error"
                    extra["bench"] = {"error": str(exc)[:200]}
            if decision == "accept" and res["param"].get("clamped"):
                reason += ",clamped"
        else:
            decision, reason = "accept", "checks_ok"
    if stopped and decision == "accept":
        reason += ",global_stop"
    body: dict[str, Any] = {"id": pid, "decision": decision, "mode": eff if not stopped else "shadow",
                            "reason": reason or "checks_failed", "by": "kh", "kind": kind if kind in KINDS else "?",
                            "codes": res["codes"], "sha": _sha(core.jdump({k: proposal.get(k) for k in
                                                                           ("kind", "target", "change")}), 16)}
    tgt = _safe_target(kind, proposal.get("target"), res)
    if tgt is not None:
        body["target"] = tgt
    if res["ok"]:
        body["change"] = proposal.get("change")
        if res.get("param"):
            body["value"] = res["param"]["value"]
            body["clamped"] = bool(res["param"].get("clamped"))
    if res.get("injection"):
        body["injection"] = res["injection"]
    if res.get("evidence"):
        body["evidence"] = res["evidence"]
    body.update(extra)
    if applying and decision == "accept":
        try:
            if kind == "param":
                set_override(proposal["target"], res["param"]["value"], pid, "kh", now_ms)
                applied = True
            elif kind == "item":
                extra_item = _to_learn(proposal, proposer, encode)
                body["learn"] = extra_item
                applied = extra_item.get("enrolled", False)
                if not applied:
                    body["decision"], body["reason"] = ("reject" if extra_item.get("result") == "rejected"
                                                        else "hold"), f"learn:{extra_item.get('reason')}"
        except CapError as exc:
            body["decision"], body["reason"] = "hold", f"apply_failed:{exc.code}"
    body["applied"] = applied
    _record(f"ik_{pid}", body, pid, unit, now_ms)
    if m == "on" and not fallback_active() and {"leak", "canary"} & set(res["codes"]):
        fall_back("leak", now_ms, {"proposal": pid, "codes": [x for x in res["codes"] if x in ("leak", "canary")]})
    return {"id": pid, "decision": body["decision"], "reason": body["reason"], "applied": applied,
            "mode": body["mode"], "codes": res["codes"], **({"value": body["value"], "clamped": body["clamped"]}
                                                             if "value" in body else {})}


def _to_learn(proposal: dict, proposer: str, encode) -> dict:
    """Hand an item to the learning loop (same code path as /learn/propose), the trial's source ``improve``."""
    from app import caps
    from app.caps import learn
    if not caps.is_loaded("learn") or learn.mode() == "off":
        return {"enrolled": False, "reason": "learn_off"}
    if encode is None:
        return {"enrolled": False, "reason": "no_encoder"}
    t, ch = proposal.get("target") or {}, proposal.get("change") or {}
    body = {"project": t.get("project"), "action": t.get("action"), "context": t.get("context"),
            "title": ch.get("title"), "text": ch.get("text"), "evidence": proposal.get("evidence") or {}}
    got = learn.propose(body, f"improve:{proposer}", encode, source="improve")
    res = got.get("result") or {}
    trial = got.get("trial")
    if not trial:
        return {"enrolled": False, "result": res.get("result"), "reason": res.get("reason") or res.get("result")}
    return {"enrolled": True, "item_id": trial["item_id"], "result": res.get("result")}


def set_override(name: str, value, pid: str, by: str, now_ms: int | None = None) -> dict:
    now_ms = int(now_ms or time.time() * 1000)

    def fn(st):
        ov = dict(st.get("overrides") or {})
        ov[name] = {"value": value, "proposal": pid, "set_ms": now_ms, "by": by}
        return {**st, "overrides": ov}
    return _update_state(fn)


def revert(name: str, by: str, harm: bool = False, now_ms: int | None = None) -> dict:
    """Delete an override row (back to the process default) and record it. ``harm`` counts toward F4."""
    now_ms = int(now_ms or time.time() * 1000)
    gone: list = []

    def fn(st):
        ov = dict(st.get("overrides") or {})
        if name not in ov:
            return None
        gone.append(ov.pop(name))
        return {**st, "overrides": ov}
    _update_state(fn)
    if not gone:
        raise CapError("not_found", f"no override for {name}")
    _record(f"iv_{_sha(name, 8)}_{now_ms}", {"id": gone[0].get("proposal") or name, "decision": "revert",
                                            "mode": mode(), "reason": "harm" if harm else "maintainer",
                                            "harm": bool(harm), "target": name, "by": by}, now_ms=now_ms)
    out = {"param": name, "reverted": True, "harm": bool(harm)}
    if harm:
        out["fallback"] = check_fallback(now_ms)
    return out


def decide(pid: str, decision: str, by: str, reason: str | None = None, encode=None,
           now_ms: int | None = None) -> dict:
    """fen's own decision next to KH's verdict (the shadow agreement). In mode on, fen's accept of a param that
    KH did not apply (hold / fen) applies it - a human decision, still clamped."""
    if mode() == "off":
        raise CapError("improve_off", "KH_IMPROVE_MODE is off")
    if decision not in ("accept", "reject"):
        raise CapError("invalid", "decision must be accept or reject")
    kh = _event(f"ik_{pid}")
    if kh is None:
        raise CapError("not_found", f"no proposal {pid}")
    if _event(f"if_{pid}") is not None:
        raise CapError("duplicate", f"proposal {pid} is already decided by a maintainer")
    now_ms = int(now_ms or time.time() * 1000)
    kb = kh["body"]
    applied = False
    if decision == "accept" and kb.get("kind") == "param" and not kb.get("applied") and kb.get("codes") == [] \
            and effective_mode() == "on" and not global_stop() and "value" in kb:
        set_override(kb["target"], kb["value"], pid, by, now_ms)
        applied = True
    body = {"id": pid, "decision": decision, "mode": effective_mode(), "reason": (reason or "maintainer")[:64],
            "by": "maintainer", "kh_decision": kb.get("decision"), "agree": _agrees(kb.get("decision"), decision),
            "applied": applied, "kind": kb.get("kind")}
    _record(f"if_{pid}", body, pid, now_ms=now_ms)
    return body


def _agrees(kh: str | None, fen: str) -> bool | None:
    if kh in ("accept", "reject"):
        return kh == fen
    return None                                   # hold / fen: KH gave no verdict to compare


def fall_back(reason: str, now_ms: int | None = None, detail: dict | None = None) -> dict:
    """Persist the automatic fallback to shadow (F4) and announce it."""
    from app.caps import people
    now_ms = int(now_ms or time.time() * 1000)
    done: list = []

    def fn(st):
        if (st.get("fallback") or {}).get("active"):
            return None
        done.append(1)
        return {**st, "fallback": {"active": True, "since_ms": now_ms, "reason": reason}}
    _update_state(fn)
    if not done:
        return {"fallback": "already_active"}
    body = {"id": "fallback", "decision": "fallback_shadow", "mode": "shadow", "reason": reason, "by": "kh",
            **({"detail": detail} if detail else {})}
    try:
        _record(f"ib_{now_ms}_{_sha(reason, 6)}", body, now_ms=now_ms)
        people.emit("kh.improve_fallback", {"reason": reason, "since_ms": now_ms, **(detail or {})})
    except Exception:  # noqa: BLE001 - the persisted state is what counts
        logger.exception("improve: could not announce the fallback")
    logger.warning("improve: automatic fallback to shadow (%s)", reason)
    return {"fallback": "activated", "reason": reason, "since_ms": now_ms}


def clear_fallback(by: str, now_ms: int | None = None) -> dict:
    now_ms = int(now_ms or time.time() * 1000)

    def fn(st):
        return {**st, "fallback": {"active": False, "cleared_by": by}, "cleared_ms": now_ms}
    _update_state(fn)
    _record(f"ib_{now_ms}_clear", {"id": "fallback", "decision": "fallback_clear", "mode": mode(),
                                   "reason": "maintainer", "by": by}, now_ms=now_ms)
    return {"fallback": "cleared", "cleared_ms": now_ms}


def check_fallback(now_ms: int | None = None) -> dict:
    """F4: any leak hit, or >= fallback_rollbacks rollbacks within fallback_days, while mode on -> shadow."""
    from app.caps import people
    if mode() != "on" or fallback_active():
        return {"checked": False}
    now_ms = int(now_ms or time.time() * 1000)
    c = conf()
    st = _state()
    since = max(int(st.get("cleared_ms") or 0), now_ms - int(c["fallback_days"]) * DAY_MS)
    with sqldb.connect() as conn:
        canary = int(conn.execute("SELECT COUNT(*) FROM kh_event WHERE ns=? AND kind='kh.canary_hit' AND ts_ms>=? "
                                  "AND ts_ms<=?", [people.NS, since, now_ms]).fetchone()[0])
        rollbacks = int(conn.execute("SELECT COUNT(*) FROM kh_event WHERE ns=? AND kind='kh.item_rollback' AND "
                                     "ts_ms>=? AND ts_ms<=?", [people.NS, since, now_ms]).fetchone()[0])
        rows = conn.execute(f"SELECT body_json FROM kh_event WHERE ns=? AND kind=? AND ts_ms>=? AND ts_ms<=? "
                            f"LIMIT {SCAN_MAX}", [people.NS, DECISION, since, now_ms]).fetchall()
    leaks = 0
    for r in rows:
        b = json.loads(r["body_json"] or "{}")
        if b.get("decision") == "revert" and b.get("harm"):
            rollbacks += 1
        if b.get("by") == "kh" and b.get("mode") == "on" and {"leak", "canary"} & set(b.get("codes") or []):
            leaks += 1
    out = {"checked": True, "since_ms": since, "leaks": leaks + canary, "rollbacks": rollbacks}
    if leaks + canary:
        out.update(fall_back("leak", now_ms, {"leaks": leaks, "canary_hits": canary}))
    elif rollbacks >= int(c["fallback_rollbacks"]):
        out.update(fall_back("rollbacks", now_ms, {"rollbacks": rollbacks, "days": c["fallback_days"]}))
    return out


def _cron_fallback() -> str:
    if mode() != "on" or not enabled():
        return ""
    got = check_fallback()
    return f"fallback to shadow ({got.get('reason')})" if got.get("fallback") == "activated" else ""


CRONS = [("improve_fallback", FALLBACK_INTERVAL_S, _cron_fallback)]


# ── reading ──────────────────────────────────────────────────────────────────

def proposals(limit: int = 100) -> dict:
    from app.caps import people
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT id, ts_ms, run_id, body_json FROM kh_event WHERE ns=? AND kind=? AND run_id IS NOT "
                         f"NULL ORDER BY seq DESC LIMIT {SCAN_MAX}", [people.NS, DECISION]).fetchall()
    by: dict[str, dict] = {}
    for r in rows:
        pid, b = r["run_id"], json.loads(r["body_json"] or "{}")
        line = by.setdefault(pid, {"id": pid})
        if str(r["id"]).startswith("ik_"):
            line.update(kh=b, ts_ms=int(r["ts_ms"]))
        elif str(r["id"]).startswith("if_"):
            line["fen"] = b
    out = sorted(by.values(), key=lambda x: -(x.get("ts_ms") or 0))
    return {"mode": mode(), "effective_mode": effective_mode(), "count": len(out[:limit]), "proposals": out[:limit],
            "agreement": agreement(out)}


def agreement(lines: list[dict] | None = None) -> dict:
    """The shadow -> on gate numbers (design 7.3)."""
    lines = lines if lines is not None else proposals(LIST_MAX)["proposals"]
    decided = [x for x in lines if "fen" in x and "kh" in x and x["kh"].get("decision") in ("accept", "reject")]
    agree = sum(1 for x in decided if x["kh"]["decision"] == x["fen"]["decision"])
    bad = sum(1 for x in decided if x["kh"]["decision"] == "accept" and x["fen"]["decision"] == "reject"
              and str(x["fen"].get("reason") or "") in ("harm", "leak"))
    c = conf()
    rate = agree / len(decided) if decided else None
    return {"decided": len(decided), "agree": agree, "rate": rate, "accept_vs_harm_or_leak": bad,
            "gate_ok": bool(decided) and len(decided) >= int(c["min_decided"]) and rate >= float(c["agreement_min"])
            and bad == 0}


def state() -> dict:
    st = _state()
    return {"mode": mode(), "effective_mode": effective_mode(), "global_stop": global_stop(),
            "fallback": st.get("fallback") or {"active": False}, "cleared_ms": st.get("cleared_ms"),
            "overrides": st.get("overrides") or {}, "bench_hook": BENCH[0] is not None, "settings": conf()}


# ── the door: agents and the worker on "agents": true routes ────────────────

def agent_routes(path=None) -> set[tuple[str, str]]:
    from app.caps import people
    data = json.loads((path or people.RULES_PATH).read_text(encoding="utf-8"))
    out = set()
    for entry in data["routes"]:
        if entry.get("agents") is True:
            method, template = entry["route"].split(" ", 1)
            out.add((method.upper(), template))
    return out


def _agent_refusal(principal) -> str | None:
    """None when this service token may propose: the kh_people worker, or an active agent principal of an
    allowed, active namespace. Namespace client tokens (``client``) are not agents."""
    from app.caps import people, principals, registry
    ns, pid = getattr(principal, "ns", None), getattr(principal, "principal_id", None)
    if people.is_worker(principal):
        return people._worker_refusal(principal)
    if not pid or pid == "client":
        return "namespace client tokens may not propose changes"
    if ns not in conf()["agent_namespaces"]:
        return f"namespace {ns} may not propose changes"
    row_ns = registry.ns_state(ns)
    if row_ns is None or row_ns["state"] != "active":
        return f"namespace {ns} is not active"
    row = principals.get_principal(ns, pid)
    if row is None or row["state"] != "active":
        return f"principal {pid} is {row['state'] if row else 'unknown'}"
    return None


def _wrap_decide() -> None:
    if getattr(auth.decide, "_kh_improve", False):
        return
    inner = auth.decide
    routes = agent_routes()

    def decide(rule, principal, path_params, query, body):
        if getattr(principal, "ns", None) is not None and rule is not None and (rule.method, rule.template) in routes:
            return _agent_refusal(principal)
        return inner(rule, principal, path_params, query, body)

    decide._kh_improve = True                 # type: ignore[attr-defined]
    decide._inner = inner                     # type: ignore[attr-defined]
    auth.decide = decide


def _unwrap_decide() -> None:
    """Tests only: restore auth.decide."""
    if getattr(auth.decide, "_kh_improve", False):
        auth.decide = auth.decide._inner      # type: ignore[attr-defined]


# ── routes ───────────────────────────────────────────────────────────────────

class ProposeRequest(BaseModel):
    kind: str = Field(..., max_length=32)
    target: Any = None
    change: Any = None
    evidence: Any = None


class DecideRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    decision: str = Field(..., pattern="^(accept|reject)$")
    reason: str | None = Field(default=None, pattern="^(harm|leak|quality|scope|other|maintainer)$")


class RevertRequest(BaseModel):
    param: str = Field(..., min_length=1, max_length=64)
    harm: bool = False


class FallbackRequest(BaseModel):
    action: str = Field("clear", pattern="^clear$")


def _caller() -> str:
    from app.caps import outcomes
    return outcomes.caller_of(auth.current()) or "local"


def attach(app) -> None:
    TAG = ["Improve"]
    _wrap_decide()

    def _need_active() -> None:
        from app.caps import people
        if not people.active():
            raise HTTPException(status_code=503, detail="kh_people is not active (KH_CAP_PEOPLE=on)")

    def _enc(request: Request):
        model = getattr(request.app.state, "model", None)
        return None if model is None else (lambda t: model.encode(t, normalize_embeddings=True).tolist())

    @app.post("/improve/propose", tags=TAG, summary="Propose a change (item, param, policy) for checks and measure")
    async def improve_propose(body: ProposeRequest, request: Request) -> dict:
        _need_active()
        return await asyncio.to_thread(propose, body.model_dump(), _caller(), _enc(request))

    @app.get("/improve/proposals", tags=TAG, summary="Proposals with KH's verdict and fen's decision (maintainers)")
    async def improve_proposals(limit: int = Query(100, ge=1, le=LIST_MAX)) -> dict:
        _need_active()
        return await asyncio.to_thread(proposals, limit)

    @app.get("/improve/state", tags=TAG, summary="Modes, fallback, overrides, agreement (maintainers)")
    async def improve_state() -> dict:
        _need_active()
        out = await asyncio.to_thread(state)
        out["agreement"] = await asyncio.to_thread(agreement)
        return out

    @app.post("/improve/decide", tags=TAG, summary="fen's decision on a proposal (maintainers)")
    async def improve_decide(body: DecideRequest, request: Request) -> dict:
        _need_active()
        return await asyncio.to_thread(decide, body.id, body.decision, f"maintainer:{_caller()}", body.reason,
                                       _enc(request))

    @app.post("/improve/revert", tags=TAG, summary="Delete a runtime parameter override (maintainers)")
    async def improve_revert(body: RevertRequest) -> dict:
        _need_active()
        return await asyncio.to_thread(revert, body.param, f"maintainer:{_caller()}", body.harm)

    @app.post("/improve/fallback", tags=TAG, summary="Clear the automatic fallback to shadow (maintainers)")
    async def improve_fallback(body: FallbackRequest) -> dict:   # noqa: ARG001
        _need_active()
        return await asyncio.to_thread(clear_fallback, f"maintainer:{_caller()}")

    from app.caps import benchhook
    benchhook.register(app)                   # only with KH_BENCH_HOOK=1 (default off: param proposals hold)
    logger.info("Improve routes attached (/improve/*), mode %s", mode())
