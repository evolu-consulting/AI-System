"""The measured learning loop: propose, offline gate, 50/50 withholding, decision (roadmap E-5 slice S11).

docs/roadmap-e-to-5-design.md section 5.3-5.6 and decisions L4/L5. Default off: ``KH_CAP_LEARN=on`` attaches it,
and it acts only while the ``kh_people`` namespace is active (``KH_CAP_PEOPLE=on``). ``KH_LEARN_MODE``:

  off     nothing: no withholding, no gate, no decision (the default)
  record  outcomes only (slice S7 records them); /learn/propose stores candidates, nothing else moves
  trial   (alias ``shadow``) the gate runs, trial lessons are WITHHELD from half of the sessions, and the decision
          cron only RECOMMENDS (a ``learn.decision`` event with ``applied: false``); fen confirms with
          POST /learn/decide
  auto    (alias ``on``) as trial, and the cron applies its decisions

  POST /learn/propose {project, action, context, text, title?, evidence: {serve_ids[], outcome_ids[]}}  project.write
       D's submit checks (distill._submit_one: kind, keys, leak gate, duplicates, contradictions) with the evidence
       serve ids as the sources; a new dk_* lesson (distilled_by ``agent:<caller>``) is enrolled for a trial.
  GET  /learn/trials?state=&limit=   maintainers: the trial ledger, with the current statistics of each trial
  POST /learn/decide {id, decision: accept|reject}   maintainers: fen applies a decision (any mode but off)

LEDGER. Each candidate is a ``kh_item`` of kind ``lesson_trial`` in kh_people with the SAME id as its ``dk_*`` row
(the text stays in the vector row; kh_item holds the trial state, conditional on ``rev``). ``attrs``:
``trial_state`` proposed -> trial -> accepted | withdrawn (or contested), ``arm_salt``, ``opened_ms``,
``offline_gate`` and ``source`` (distill | agent | improve). The item carries ``guard_metric step.success``, so once
it is accepted (kh_item active) stage F's F8 rollback watches it.

OFFLINE GATE (cron ``learn_gate``, hourly; it also enrols the worker's proposed ``lesson`` rows of the consented
projects): 1. leak gate + items lint; 2. evidence from >= 2 sessions with a different caller or project (agent),
>= 2 distinct sources (distill); 3. the dk row is not contested (D's submit marks contradictions); 4. bench
non-regression through the ``BENCH[0]`` hook (``fn(item) -> {ok, ...}``; unset = ``skipped``; app/caps/benchhook.py
sets it when ``KH_BENCH_HOOK=1``: p1bench + tier-1 with the candidate injected, at most 2% worse than baseline).
The verdict goes to ``attrs.offline_gate``; a pass sets ``trial_state = trial``, records
``opened_ms`` and makes the dk row active so the served arm gets it. A contradiction makes the item contested.

WITHHOLDING (``split_trial``, called by app/distill.served). For an item in trial, arm =
``sha256(item_id + arm_salt + session) mod 2``; arm 0 withholds it, arm 1 serves it. No session (no
``X-KH-Session``), mode off/record or the module not attached: everything is served. The session reaches
distill.served through a context variable set by this module's ASGI middleware (asyncio.to_thread copies it).

DECISION (cron ``learn_decide`` every ``decide_every_h`` hours, already under the ``_kh`` lease of start_crons).
Eligible session for item i: a session with a kh.served pack on i's key (same action and context, i's project or
the shared lesson project) or naming i among its item or withheld ids, since ``opened_ms``; its arm is the hash
arm (intention to treat). Outcome per session: 1 when every LABELLED step of those packs is ``done`` (the
current label = the highest-ranked), else 0; sessions without a label do not count. Then, in this order:
  withdraw (harm): stage F's own D12 rule, ``metrics.evaluate`` (n >= min_n_per_arm, relative change <= harm_rel,
                   p < harm_p)
  accept:          n >= min_n_per_arm per arm, served - control >= 0, one-sided ni_conf lower bound > -ni_margin,
                   and the step.tokens guard holds (served median <= control median x (1 + token_guard_rel))
  at the cap (max_n_per_arm per arm or max_days): accept when the difference >= 0 and the token guard holds,
                   else withdraw (``no_effect`` / ``token_guard``)
  continue otherwise (``insufficient`` below min_n, ``inconclusive`` above it).
Accept: kh_item -> active, trial closed (everyone gets the lesson). Withdraw: kh_item -> withdrawn and the dk row
-> withdrawn through distill._set_status. Either way a ``learn.decision`` event. Decisions use outcomes, never
error counts (L6).
"""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import logging
import math
import secrets
import statistics
import threading
import time
from typing import Any, Callable

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import auth, config, sqldb
from app.caps.core import CapError

logger = logging.getLogger(__name__)

NAME = "learn"
VERSION = "1.0.0"
STATUS = "beta"
DEFAULT_ON = False                       # KH_CAP_LEARN=on attaches it (design 5.6)

KIND = "lesson_trial"
DECISION = "learn.decision"
GUARD_SERIES = "step.success"
TOKENS_SERIES = "step.tokens"
MODES = ("off", "record", "trial", "auto")
MODE_ALIASES = {"shadow": "trial", "on": "auto"}
SOURCES = ("distill", "agent", "improve")
STATES = ("proposed", "trial", "accepted", "withdrawn", "contested")
DEFAULTS = {"min_n_per_arm": 30, "harm_rel": -0.10, "harm_p": 0.05, "ni_margin": 0.05, "ni_conf": 0.90,
            "max_n_per_arm": 100, "max_days": 45, "token_guard_rel": 0.10, "decide_every_h": 6,
            "evidence_sessions_min": 2, "token_min_n": 5}
SCAN_MAX = 500_000
TRIAL_CACHE_S = 5.0
LIST_MAX = 500
DAY_MS = 86_400_000
LIMITS = {"scan_max": SCAN_MAX, "list_max": LIST_MAX}

#: The bench hook of gate step 4: ``fn(item: dict) -> {"ok": bool, ...}``. None = skipped.
BENCH: list[Callable[[dict], dict] | None] = [None]

_session: contextvars.ContextVar[str | None] = contextvars.ContextVar("kh_learn_session", default=None)
_trials_lock = threading.Lock()
_trials: list = [0.0, {}]                # [expires (monotonic), {item_id: arm_salt}]


def init(c) -> None:                     # noqa: ARG001 - no tables: kh_people items and events only
    sqldb.migrate(c, NAME, [])


# ── mode and settings ────────────────────────────────────────────────────────

def mode() -> str:
    raw = (config._env("KH_LEARN_MODE", "off") or "off").strip().lower()
    raw = MODE_ALIASES.get(raw, raw)
    return raw if raw in MODES else "off"


def enabled() -> bool:
    """Attached and kh_people active."""
    from app import caps
    from app.caps import people
    try:
        return caps.is_loaded(NAME) and people.active()
    except Exception:  # noqa: BLE001 - a context read never fails on the learning loop
        return False


def withholding() -> bool:
    return mode() in ("trial", "auto") and enabled()


def conf() -> dict:
    from app.caps import people
    out = dict(DEFAULTS)
    try:
        s = people.settings("learn")
    except Exception:  # noqa: BLE001
        s = {}
    out.update({k: v for k, v in s.items() if k in DEFAULTS and isinstance(v, (int, float))})
    return out


# ── arms and withholding ─────────────────────────────────────────────────────

def arm(item_id: str, salt: str, session: str) -> int:
    """0 = control (withheld), 1 = served. Stable per (item, session)."""
    return int(hashlib.sha256(f"{item_id}{salt}{session}".encode("utf-8")).hexdigest(), 16) % 2


def current_session() -> str | None:
    return _session.get()


def invalidate() -> None:
    with _trials_lock:
        _trials[0] = 0.0


def trial_salts() -> dict[str, str]:
    """{item_id: arm_salt} of the lessons in trial (cached TRIAL_CACHE_S)."""
    now = time.monotonic()
    with _trials_lock:
        if now < _trials[0]:
            return _trials[1]
    from app.caps import people
    out: dict[str, str] = {}
    with sqldb.connect() as c:
        rows = c.execute("SELECT item_id, attrs_json FROM kh_item WHERE ns=? AND kind=? AND status IN "
                         "('proposed','contested')", [people.NS, KIND]).fetchall()
    for r in rows:
        a = _json(r["attrs_json"])
        if a.get("trial_state") == "trial" and a.get("arm_salt"):
            out[r["item_id"]] = a["arm_salt"]
    with _trials_lock:
        _trials[:] = [now + TRIAL_CACHE_S, out]
    return out


def split_trial(items: list[dict], session: str | None = None) -> tuple[list[dict], list[str]]:
    """(kept, withheld ids) for one session. Only items in trial are ever withheld. Never raises."""
    try:
        session = session if session is not None else _session.get()
        if not items or not session or not withholding():
            return items, []
        salts = trial_salts()
        if not salts:
            return items, []
        kept, held = [], []
        for it in items:
            iid = it.get("id")
            if iid in salts and arm(iid, salts[iid], session) == 0:
                held.append(iid)
            else:
                kept.append(it)
        return kept, held
    except Exception as exc:  # noqa: BLE001 - withholding must never break a context read
        logger.warning("learn: withholding failed, serving everything: %s", exc)
        return items, []


def withhold(rows: list, id_of: Callable[[Any], str | None], withheld: list | None = None,
             session: str | None = None) -> list:
    """The same 50/50 withholding for rows found BY MEANING (the /context/step knowledge tier, the /turn/context
    near and lesson lines). A lesson in trial is also a live dk row of the knowledge collection, so withholding
    only in distill.served (the key read) let the control arm get it by meaning anyway (S15 dev check
    2026-10-11: 160 of 160 trial sessions were served the lesson, with the id in withheld_ids too). Withheld ids
    are appended to ``withheld`` once. Never raises; off, rows come back unchanged."""
    try:
        session = session if session is not None else _session.get()
        if not rows or not session or not withholding():
            return rows
        salts = trial_salts()
        if not salts:
            return rows
        out = []
        for r in rows:
            iid = id_of(r)
            if iid in salts and arm(iid, salts[iid], session) == 0:
                if withheld is not None and iid not in withheld:
                    withheld.append(iid)
                continue
            out.append(r)
        return out
    except Exception as exc:  # noqa: BLE001 - withholding must never break a context read
        logger.warning("learn: withholding by meaning failed, serving everything: %s", exc)
        return rows


class SessionMiddleware:
    """Pure ASGI: puts ``X-KH-Session`` in a context variable for app/distill.served."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        session = None
        for k, v in scope.get("headers") or []:
            if k == b"x-kh-session":
                session = v.decode("latin-1").strip()[:128] or None
                break
        token = _session.set(session)
        try:
            return await self.app(scope, receive, send)
        finally:
            _session.reset(token)


# ── the ledger ───────────────────────────────────────────────────────────────

def _json(raw) -> dict:
    try:
        v = json.loads(raw or "{}")
    except ValueError:
        return {}
    return v if isinstance(v, dict) else {}


def _item(c, item_id: str) -> dict | None:
    from app.caps import items, people
    r = items._load(c, people.NS, item_id)
    return _dec(r) if r else None


def _dec(r) -> dict:
    from app.caps import items
    d = items._decode(r)
    d["item_id"] = d["id"]
    return d


def get(item_id: str) -> dict | None:
    with sqldb.connect() as c:
        return _item(c, item_id)


def _key_norm(action: str | None, context: str | None) -> tuple[str, str]:
    from app import distill
    a = (action or "").strip() or distill.NONE_KEY
    raw = (context or "").strip()
    ctx = raw if raw.startswith("ent__") else (distill.fold(raw).replace(" ", "-") or distill.NONE_KEY)
    return a, ctx


def enroll(project: str, dk: dict, source: str, evidence: list[str]) -> dict:
    """A kh_item lesson_trial with the dk row's id (trial_state proposed). Idempotent on the id."""
    from app.caps import core, items, people, registry
    if source not in SOURCES:
        raise CapError("invalid", f"source must be one of {SOURCES}")
    row_ns = people.ns_row()
    if row_ns is None:
        raise CapError("ns_not_active", "kh_people is not active (KH_CAP_PEOPLE=on)", status=503)
    action, context = _key_norm(dk.get("action"), dk.get("context"))
    k = items.parse_key(row_ns, "people", {"project": project, "action": action, "context": context})
    attrs = {"trial_state": "proposed", "arm_salt": secrets.token_hex(8), "source": source}
    t = registry.type_of(row_ns, KIND, kind_of="item")
    errs = registry.validate(people.NS, t, attrs) if t.get("schema") else []
    if errs:
        raise CapError("validation_failed", "lesson_trial attrs are not valid", extra={"errors": errs})
    text = (dk.get("text") or "").strip()
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        row = {"ns": people.NS, "item_id": dk["id"], "kind": KIND, "keyspace": "people",
               "key_json": items._key_json(k["key"]), "key_sha": k["key_sha"], "project": project, "scope": "project",
               "status": "proposed", "status_reason": None, "title": (dk.get("title") or "")[:512], "text": text,
               "text_sha": items._text_sha(text), "attrs_json": core.jdump(attrs),
               "provenance_json": core.jdump({"runs": [], "event_ids": list(dict.fromkeys(evidence))[:items.PROV_MAX]}),
               "evidence_count": len(set(evidence)), "support_projects_json": core.jdump([project]),
               "guard_names_json": "[]", "guard_metric": GUARD_SERIES, "metric_dir": "up", "ttl_days": None,
               "expires_ms": None, "activated_ms": None, "last_confirmed_ms": None, "superseded_by": None,
               "actor_json": core.jdump({"principal": people.SYSTEM}), "rev": 1, "vec_rev": None, "created_ms": now,
               "updated_ms": now}
        created = sqldb.insert_new(c, "kh_item", row)
        out = _item(c, dk["id"])
    return {"created": created, "item": out}


def _set_attrs(item_id: str, rev: int, attrs: dict) -> int:
    """Conditional attrs update (rev). Returns the new rev; 409 write_conflict when the item moved."""
    from app.caps import core, people
    with sqldb.connect() as c:
        return core.cas_update(None, c, "kh_item", {"ns": people.NS, "item_id": item_id},
                               {"attrs_json": core.jdump(attrs), "updated_ms": sqldb.now_ms(c)}, rev)


def _transition(item: dict, to: str, reason: str) -> dict:
    from app.caps import items, people
    ctx = people.system_ctx(if_match=item["rev"], kind=KIND)
    _, out = items.transition(ctx, item["item_id"], {"status": to, "reason": reason})
    return out["item"]


def _dk(project: str, item_id: str) -> dict | None:
    from app import distill
    from app import vector_store as vs
    try:
        got = vs.get_ids_vt([item_id], collection=distill._coll(project))
    except Exception:  # noqa: BLE001 - a missing collection is a missing row
        return None
    if not got:
        return None
    return {**distill.item_of(got[0]), "meta": got[0].get("metadata") or {}}


def _encoder():
    from app.caps import items
    return items.encoder()


# ── propose (agents and people) ──────────────────────────────────────────────

def _served_rows(c, ids: list[str]) -> list[dict]:
    from app.caps import people
    out = []
    for k in range(0, len(ids), 200):
        part = ids[k:k + 200]
        out += [{"id": r["id"], "session": r["session_id"], **_json(r["body_json"])} for r in c.execute(
            f"SELECT id, session_id, body_json FROM kh_event WHERE ns=? AND kind='kh.served' AND id IN "
            f"({','.join('?' for _ in part)})", [people.NS] + part).fetchall()]
    return out


def propose(body: dict, caller: str, encode, actions: set[str] | None = None, source: str = "agent") -> dict:
    """D's submit checks on one lesson with the evidence serve ids as its sources; a new dk row is enrolled.
    ``source`` marks the trial (``agent`` for /learn/propose, ``improve`` for a phase 5 item proposal)."""
    from app import distill
    if source not in SOURCES:
        raise CapError("invalid", f"source must be one of {SOURCES}")
    from app.projects import list_projects
    if mode() == "off":
        raise CapError("learn_off", "KH_LEARN_MODE is off", status=409)
    project = (body.get("project") or "").strip()
    ev = body.get("evidence") or {}
    serve_ids = [s for s in dict.fromkeys(ev.get("serve_ids") or []) if isinstance(s, str)][:200]
    with sqldb.connect() as c:
        rows = _served_rows(c, serve_ids)
    valid = {r["id"] for r in rows if (r.get("project") or "") in (project, config.TURN_LESSON_PROJECT)}
    if actions is None:
        from app.policy_actions import store as policy_store
        actions = {a["action"] for a in policy_store.menu(project)}
    ctx_tags = {x["tag"] for x in distill.contexts(project)}
    own = project in config.DISTILL_OWN_PROJECTS
    names = distill._names(list(list_projects()), ("person",) if own else ("person", "org"))
    text = (body.get("text") or "").strip()
    raw = {"kind": "lesson", "action": body.get("action"), "context": body.get("context") or "",
           "title": (body.get("title") or text[:config.DISTILL_TITLE_CHARS]).strip(), "text": text,
           "sources": [s for s in serve_ids if s in valid] or serve_ids}
    res = distill._submit_one(project, raw, 0, encode, actions, ctx_tags, valid, names,
                              f"agent:{caller or 'unknown'}", not own)
    out = {"project": project, "result": res}
    if res.get("result") in ("accepted", "contested"):
        dk = _dk(project, res["id"]) or {"id": res["id"], "action": raw["action"], "context": raw["context"],
                                         "title": raw["title"], "text": text}
        out["trial"] = enroll(project, dk, source, sorted(valid))["item"]
    return out


def enroll_distilled() -> int:
    """Enrol the worker's proposed ``lesson`` rows of the consented projects (gate cron)."""
    from app import distill
    n = 0
    for project in config.DISTILL_PROJECTS:
        try:
            rows = distill.items(project, ("proposed",), {"kind": {"$eq": "lesson"}})
        except Exception:  # noqa: BLE001 - one project never stops the others
            logger.exception("learn: reading %s failed", project)
            continue
        if not rows:
            continue
        with sqldb.connect() as c:
            known = {r["id"] for r in rows if _item(c, r["id"]) is not None}
        for it in rows:
            if it["id"] in known:
                continue
            meta = (_dk(project, it["id"]) or {}).get("meta") or {}
            if not str(meta.get("distilled_by") or "").startswith("worker:"):
                continue
            n += bool(enroll(project, it, "distill", list(it.get("sources") or []))["created"])
    return n


# ── offline gate ─────────────────────────────────────────────────────────────

def _evidence(item: dict, source: str, dk: dict | None) -> dict:
    need = int(conf()["evidence_sessions_min"])
    if source == "distill":
        n = len(set((dk or {}).get("sources") or item["provenance"].get("event_ids") or []))
        return {"ok": n >= need, "sources": n}
    ids = list(item["provenance"].get("event_ids") or [])
    with sqldb.connect() as c:
        rows = _served_rows(c, ids)
    sessions = {r["session"] for r in rows if r.get("session")}
    callers = {r.get("caller") for r in rows if r.get("caller")}
    projects = {r.get("project") for r in rows if r.get("project")}
    ok = len(sessions) >= need and (len(callers) >= 2 or len(projects) >= 2)
    return {"ok": ok, "sessions": len(sessions), "callers": len(callers), "projects": len(projects)}


def gate(item_id: str, encode=None) -> dict:
    """Run the offline gate on one proposed candidate. Returns the verdict (stored in attrs.offline_gate)."""
    from app import distill
    from app.caps import items, people
    with sqldb.connect() as c:
        it = _item(c, item_id)
        if it is None or it["kind"] != KIND:
            raise CapError("not_found", f"no lesson trial {item_id}")
        if it["attrs"].get("trial_state") != "proposed":
            return {"item_id": item_id, "skipped": it["attrs"].get("trial_state")}
        lint = items.lint(c, people.ns_row(), it["text"], [])
    dk = _dk(it["project"], item_id)
    checks: dict[str, Any] = {}
    leak = distill._leak(f"{it['title']}\n{it['text']}")
    checks["leak_lint"] = {"ok": not leak and not lint, "leak": leak, "lint": lint}
    checks["evidence"] = _evidence(it, it["attrs"].get("source") or "agent", dk)
    contested = dk is None or dk.get("status") == "contested"
    checks["contradiction"] = {"ok": not contested, "dk_status": (dk or {}).get("status")}
    bench = BENCH[0]
    if bench is None:
        checks["bench"] = {"ok": True, "skipped": "no bench hook (tools/kh_bench)"}
    else:
        try:
            got = bench({**it, "dk": dk}) or {}
            checks["bench"] = {"ok": bool(got.get("ok")), **{k: v for k, v in got.items() if k != "ok"}}
        except Exception as exc:  # noqa: BLE001 - a broken bench never passes a candidate
            checks["bench"] = {"ok": False, "error": str(exc)[:300]}
    ok = all(v["ok"] for v in checks.values())
    verdict = {"ok": ok, "checks": checks, "at_ms": int(time.time() * 1000)}
    attrs = {**it["attrs"], "offline_gate": verdict}
    if not checks["contradiction"]["ok"] and dk is not None:
        attrs["trial_state"] = "contested"
        rev = _set_attrs(item_id, it["rev"], attrs)
        _transition({**it, "rev": rev}, "contested", "offline_gate: contradicts an approved item")
    elif ok:
        enc = encode or _encoder()
        if enc is None:
            return {"item_id": item_id, "deferred": "no encoder to activate the dk row", "gate": verdict}
        attrs.update(trial_state="trial", opened_ms=int(time.time() * 1000))
        _set_attrs(item_id, it["rev"], attrs)
        if dk.get("status") != "active":
            distill._set_status(it["project"], item_id, "active", enc)
        invalidate()
    else:
        _set_attrs(item_id, it["rev"], attrs)       # stays proposed: a later gate run may pass (evidence grows)
    return {"item_id": item_id, "trial_state": attrs["trial_state"], "gate": verdict}


def gate_all(encode=None) -> dict:
    from app.caps import people
    with sqldb.connect() as c:
        ids = [r["item_id"] for r in c.execute("SELECT item_id, attrs_json FROM kh_item WHERE ns=? AND kind=? AND "
                                               "status='proposed'", [people.NS, KIND]).fetchall()
               if _json(r["attrs_json"]).get("trial_state") == "proposed"]
    out = []
    for i in ids:
        try:
            out.append(gate(i, encode))
        except CapError as exc:
            out.append({"item_id": i, "error": exc.code})
    return {"gated": len(out), "trial": sum(1 for o in out if o.get("trial_state") == "trial"), "items": out}


def _cron_gate() -> str:
    if mode() not in ("trial", "auto") or not enabled():
        return ""
    n = enroll_distilled()
    got = gate_all()
    return f"enrolled {n}, gated {got['gated']}, into trial {got['trial']}" if n or got["gated"] else ""


# ── statistics and the decision rule ─────────────────────────────────────────

def evaluate(control: dict[str, float], served: dict[str, float], age_days: float, c: dict | None = None,
             tokens: tuple[list[float], list[float]] | None = None, ns_row: dict | None = None) -> dict:
    """THE decision rule (pure). ``control`` / ``served``: {session: 0|1}. ``tokens``: (control, served) values."""
    from app.caps import metrics
    c = {**DEFAULTS, **(c or {})}
    a, b = list(control.values()), list(served.values())
    st = metrics.compare_values(a, b, "proportion")
    n_c, n_s = st["n_a"], st["n_b"]
    diff = st["abs_delta"]
    lower = None
    if n_c and n_s:
        pc, ps = st["mean_a"], st["mean_b"]
        se = math.sqrt(pc * (1 - pc) / n_c + ps * (1 - ps) / n_s)
        lower = diff - statistics.NormalDist().inv_cdf(float(c["ni_conf"])) * se
    # harm: stage F's D12 rule, the same function the F8 rollback runs (concurrent control)
    obs = [{"unit_id": u, "value": float(v), "ts_ms": 0, "baseline": False} for u, v in {**control, **served}.items()]
    harm = metrics.evaluate(ns_row or {}, {"item_id": "-", "guard_metric": GUARD_SERIES, "metric_dir": "up",
                                           "activated_ms": 0}, obs, set(served),
                            {"min_n": int(c["min_n_per_arm"]), "min_rel": -float(c["harm_rel"]),
                             "alpha": float(c["harm_p"]), "control": "concurrent", "test": "proportion"})
    tok = {"ok": True, "reason": "no_data"}
    if tokens is not None:
        tc, ts = tokens
        if len(tc) >= int(c["token_min_n"]) and len(ts) >= int(c["token_min_n"]):
            mc, ms = statistics.median(tc), statistics.median(ts)
            tok = {"ok": ms <= mc * (1 + float(c["token_guard_rel"])), "median_control": mc, "median_served": ms}
    min_n, max_n = int(c["min_n_per_arm"]), int(c["max_n_per_arm"])
    enough = n_c >= min_n and n_s >= min_n
    capped = (n_c >= max_n and n_s >= max_n) or age_days >= float(c["max_days"])
    if harm["decision"] == "fire":
        decision, reason = "withdraw", "harm"
    elif enough and diff is not None and diff >= 0 and lower is not None and lower > -float(c["ni_margin"]):
        decision, reason = ("accept", "non_inferior") if tok["ok"] else (
            ("withdraw", "token_guard") if capped else ("continue", "token_guard"))
    elif capped:
        if diff is not None and diff >= 0 and tok["ok"]:
            decision, reason = "accept", "cap_reached"
        else:
            decision, reason = "withdraw", "token_guard" if diff is not None and diff >= 0 else "no_effect"
    else:
        decision, reason = "continue", "insufficient" if not enough else "inconclusive"
    return {"decision": decision, "reason": reason, "n_control": n_c, "n_served": n_s,
            "mean_control": st["mean_a"], "mean_served": st["mean_b"], "diff": diff, "lower_bound": lower,
            "rel_delta": st["rel_delta"], "p": st["p"], "harm": harm["decision"], "tokens": tok,
            "age_days": round(age_days, 2), "capped": capped}


def _trial_items(c, ids: list[str] | None = None) -> list[dict]:
    from app.caps import items, people
    rows = c.execute("SELECT * FROM kh_item WHERE ns=? AND kind=? AND status IN ('proposed','contested')",
                     [people.NS, KIND]).fetchall()
    out = [_dec(r) for r in rows]
    return [i for i in out if i["attrs"].get("trial_state") == "trial" and (ids is None or i["item_id"] in ids)]


def _eligible(it: dict, body: dict, dk_key: tuple[str, str]) -> bool:
    iid = it["item_id"]
    if iid in (body.get("item_ids") or []) or iid in (body.get("withheld_ids") or []):
        return True
    if (body.get("project") or "") not in (it["project"], config.TURN_LESSON_PROJECT) and \
            it["project"] != config.TURN_LESSON_PROJECT:
        return False
    return _key_norm(body.get("action"), body.get("context")) == dk_key


def collect(c, trials: list[dict]) -> dict[str, dict]:
    """{item_id: {"control": {session: 0|1}, "served": {...}}} from kh.served and step.outcome since opened."""
    from app.caps import outcomes, people
    out = {i["item_id"]: {"control": {}, "served": {}} for i in trials}
    if not trials:
        return out
    since = min(int(i["attrs"].get("opened_ms") or 0) for i in trials)
    keys = {i["item_id"]: (i["key"].get("action"), i["key"].get("context")) for i in trials}
    # serve id -> [(item_id, session)]
    serves: dict[str, list[tuple[str, str]]] = {}
    cur = c.execute(f"SELECT id, session_id, ts_ms, body_json FROM kh_event WHERE ns=? AND kind=? AND ts_ms>=? AND "
                    f"session_id IS NOT NULL LIMIT {SCAN_MAX}", [people.NS, outcomes.SERVED, since])
    for r in cur.fetchall():
        body = _json(r["body_json"])
        for it in trials:
            if int(r["ts_ms"]) >= int(it["attrs"].get("opened_ms") or 0) and _eligible(it, body, keys[it["item_id"]]):
                serves.setdefault(r["id"], []).append((it["item_id"], r["session_id"]))
    if not serves:
        return out
    label: dict[str, int] = {}
    cur = c.execute(f"SELECT id, body_json FROM kh_event WHERE ns=? AND kind=? AND ts_ms>=? LIMIT {SCAN_MAX}",
                    [people.NS, outcomes.OUTCOME, since])
    for r in cur.fetchall():
        b = _json(r["body_json"])
        o = b.get("outcome")
        # the label id is o_<outcome><source>_<serve_id>: the body's serve_id can be masked by the namespace
        # redaction (a random id looks high-entropy), the event id never is
        sid = r["id"][5:] if str(r["id"]).startswith("o_") and len(str(r["id"])) > 5 else b.get("serve_id")
        if sid in serves and o in outcomes.RANK:
            label[sid] = max(label.get(sid, -1), outcomes.RANK[o])
    per: dict[tuple[str, str], int] = {}
    for sid, pairs in serves.items():
        if sid not in label:
            continue
        for iid, session in pairs:
            ok = 1 if label[sid] == outcomes.RANK["done"] else 0
            per[(iid, session)] = min(per.get((iid, session), 1), ok)
    salts = {i["item_id"]: i["attrs"].get("arm_salt") or "" for i in trials}
    for (iid, session), v in per.items():
        out[iid]["served" if arm(iid, salts[iid], session) == 1 else "control"][session] = v
    return out


def _tokens(c, it: dict, arms: dict) -> tuple[list[float], list[float]]:
    from app.caps import metrics, people
    res = []
    for side in ("control", "served"):
        units = sorted(arms[side])
        vals: list[float] = []
        for k in range(0, len(units), 1000):
            rows = metrics.load_obs(c, people.NS, TOKENS_SERIES, None,
                                    {"unit_ids": units[k:k + 1000], "from": int(it["attrs"].get("opened_ms") or 0),
                                     "baseline": False})
            vals += [r["value"] for r in metrics.per_unit_latest(rows).values()]
        res.append(vals)
    return res[0], res[1]


def _emit_decision(it: dict, decision: str, reason: str, applied: bool, by: str, stats: dict | None) -> None:
    from app.caps import people
    body = {"id": it["item_id"], "decision": decision, "mode": mode(), "reason": reason, "applied": applied,
            "by": by, "project": it["project"]}
    if stats:
        body["stats"] = {k: v for k, v in stats.items() if k not in ("decision", "reason")}
    eid = f"{'la' if applied else 'lr'}_{decision[0]}_{it['item_id']}"[:64]
    try:
        people.append_events([{"id": eid, "kind": DECISION, "body": body,
                               **({"project": it["project"]} if it["project"] else {})}])
    except CapError as exc:
        logger.warning("learn: %s event for %s refused: %s", DECISION, it["item_id"], exc.detail)


def apply(item_id: str, decision: str, reason: str, by: str, stats: dict | None = None, encode=None) -> dict:
    """Accept (kh_item active, trial closed) or withdraw (kh_item and the dk row withdrawn)."""
    from app import distill
    if decision not in ("accept", "withdraw"):
        raise CapError("invalid", "decision must be accept or withdraw")
    it = get(item_id)
    if it is None or it["kind"] != KIND:
        raise CapError("not_found", f"no lesson trial {item_id}")
    state = it["attrs"].get("trial_state")
    if state in ("accepted", "withdrawn") or it["status"] not in ("proposed", "contested"):
        raise CapError("invalid_transition", f"trial {item_id} is already {state or it['status']}", status=409)
    attrs = {**it["attrs"], "trial_state": "accepted" if decision == "accept" else "withdrawn"}
    # the status first (it checks the transition and lint); leaving proposed/contested closes the trial at once
    final = _transition(it, "active" if decision == "accept" else "withdrawn", f"learn: {reason}")
    _set_attrs(item_id, final["rev"], attrs)
    invalidate()
    if decision == "withdraw":
        enc = encode or _encoder()
        if enc is not None:
            distill._set_status(it["project"], item_id, "withdrawn", enc, reject_reason=f"learn: {reason}"[:500])
        else:
            logger.warning("learn: no encoder, dk row %s left as is", item_id)
    _emit_decision(it, decision, reason, True, by, stats)
    return {"item_id": item_id, "decision": decision, "reason": reason, "status": final["status"],
            "trial_state": attrs["trial_state"]}


def decide_all(apply_mode: str | None = None, ids: list[str] | None = None, now_ms: int | None = None,
               encode=None) -> dict:
    """Evaluate every trial; in ``auto`` apply, in ``trial`` only recommend (learn.decision applied=false)."""
    from app.caps import people
    m = apply_mode or mode()
    c_ = conf()
    now_ms = now_ms or int(time.time() * 1000)
    with sqldb.connect() as c:
        trials = _trial_items(c, ids)
        arms = collect(c, trials)
        toks = {i["item_id"]: _tokens(c, i, arms[i["item_id"]]) for i in trials}
    results = []
    for it in trials:
        age = (now_ms - int(it["attrs"].get("opened_ms") or now_ms)) / DAY_MS
        ev = evaluate(arms[it["item_id"]]["control"], arms[it["item_id"]]["served"], age, c_, toks[it["item_id"]],
                      people.ns_row())
        ev["item_id"] = it["item_id"]
        if ev["decision"] != "continue":
            if m == "auto":
                try:
                    ev["applied"] = apply(it["item_id"], ev["decision"], ev["reason"], "cron", ev, encode)
                except CapError as exc:
                    ev["error"] = exc.code
            elif m == "trial":
                _emit_decision(it, ev["decision"], ev["reason"], False, "cron", ev)
                ev["recommended"] = True
        results.append(ev)
    return {"mode": m, "checked": len(results),
            "decided": sum(1 for r in results if r["decision"] != "continue"), "items": results}


def _cron_decide() -> str:
    if mode() not in ("trial", "auto") or not enabled():
        return ""
    got = decide_all()
    return f"{got['decided']} of {got['checked']} trials decided ({got['mode']})" if got["decided"] else ""


CRONS = [("learn_decide", int(DEFAULTS["decide_every_h"] * 3600), _cron_decide), ("learn_gate", 3600, _cron_gate)]


def trials(state: str | None, limit: int) -> dict:
    from app.caps import items, people
    with sqldb.connect() as c:
        rows = [_dec(r) for r in c.execute(
            f"SELECT * FROM kh_item WHERE ns=? AND kind=? ORDER BY updated_ms DESC LIMIT {int(LIST_MAX)}",
            [people.NS, KIND]).fetchall()]
        rows = [r for r in rows if not state or r["attrs"].get("trial_state") == state][:limit]
        live = [r for r in rows if r["attrs"].get("trial_state") == "trial"]
        arms = collect(c, live)
    out = []
    for r in rows:
        line = {"id": r["item_id"], "project": r["project"], "key": r["key"], "status": r["status"],
                "trial_state": r["attrs"].get("trial_state"), "source": r["attrs"].get("source"),
                "opened_ms": r["attrs"].get("opened_ms"), "offline_gate": r["attrs"].get("offline_gate"),
                "text": r["text"]}
        if r["item_id"] in arms:
            a = arms[r["item_id"]]
            line["arms"] = {"control": len(a["control"]), "served": len(a["served"])}
        out.append(line)
    return {"mode": mode(), "count": len(out), "trials": out}


# ── routes ───────────────────────────────────────────────────────────────────

class ProposeRequest(BaseModel):
    project: str = Field(..., min_length=1, max_length=256)
    action: str | None = Field(default=None, max_length=128)
    context: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=200)
    text: str = Field(..., min_length=1, max_length=4000)
    evidence: dict = Field(default_factory=dict, description="{serve_ids[], outcome_ids[]}")


class DecideRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)
    decision: str = Field(..., pattern="^(accept|reject)$")


def _caller() -> str:
    from app.caps import outcomes
    return outcomes.caller_of(auth.current())


def attach(app) -> None:
    TAG = ["Learn"]
    app.add_middleware(SessionMiddleware)

    def _need_active() -> None:
        from app.caps import people
        if not people.active():
            raise HTTPException(status_code=503, detail="kh_people is not active (KH_CAP_PEOPLE=on)")

    def _enc(request: Request):
        model = request.app.state.model
        return None if model is None else (lambda t: model.encode(t, normalize_embeddings=True).tolist())

    @app.post("/learn/propose", tags=TAG, summary="Propose a lesson for the offline gate and a randomized trial")
    async def learn_propose(body: ProposeRequest, request: Request) -> dict:
        _need_active()
        enc = _enc(request)
        if enc is None:
            raise HTTPException(status_code=503, detail="no embedding model loaded")
        return await asyncio.to_thread(propose, body.model_dump(), _caller(), enc)

    @app.get("/learn/trials", tags=TAG, summary="The trial ledger with the arm sizes (maintainers)")
    async def learn_trials(state: str | None = Query(None, pattern="^(proposed|trial|accepted|withdrawn|contested)$"),
                           limit: int = Query(100, ge=1, le=LIST_MAX)) -> dict:
        _need_active()
        return await asyncio.to_thread(trials, state, limit)

    @app.post("/learn/decide", tags=TAG, summary="Apply a decision on a trial: accept or reject (maintainers)")
    async def learn_decide(body: DecideRequest, request: Request) -> dict:
        _need_active()
        if mode() == "off":
            raise HTTPException(status_code=409, detail="KH_LEARN_MODE is off")
        dec = "accept" if body.decision == "accept" else "withdraw"
        return await asyncio.to_thread(apply, body.id, dec, "maintainer" if dec == "accept" else "rejected",
                                       f"maintainer:{_caller()}", None, _enc(request))

    from app.caps import benchhook
    benchhook.register(app)                   # only with KH_BENCH_HOOK=1 (default off: the gate's bench is skipped)
    logger.info("Learn routes attached (/learn/propose, /learn/trials, /learn/decide), mode %s", mode())
