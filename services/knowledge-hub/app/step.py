"""Step context: one bounded pack of context for ONE step of a piece of work (roadmap item C).

The tier 2 bench of 2026-10-02 measured where the tokens go: a model turn costs about 10-15k input
tokens, and the expensive questions were the ones that took 9-12 turns of separate KH reads
(knowledge, then log, then entities, each answered with 8 whole rows). This route answers a step in
one call:

    POST /context/step {"text": "<the step>", "project": "<id>"}

and returns a pack ordered the way fen decided on 2026-09-30, stopping early:

    1. entity cards named in the step (people, systems, modules) - literal, no similarity;
    1b. distilled items BY KEY when the step names an action and/or a context (roadmap D slice 2,
       docs/distill-design.md): a SELECT on the project's and the shared lessons project's live
       items, action + context first, then action alone; no score floor, newest confirmed first.
       Sources (worklog ids) are shown to maintainers only;
    2. knowledge by meaning: the project's own, then the shared lessons project;
    3. the project's worklog by meaning - ONLY when step 2 found nothing at or above the floor.
    A step about TIME (an ISO date or a word of config STEP_TIME_WORDS) reads the worklog by
    recency first instead, then knowledge with what budget is left.
    DAILY TIER (roadmap E, slice S12; design 3.4): with the daily capability attached (KH_CAP_DAILY=on)
    AND KH_STEP_DAILY=1 (default 0), a time step with a project first gets the project's daily summary
    (tier ``daily``, kh_daily rows of mode llm), BEFORE ``log-recent``, which then drops to
    KH_STEP_DAILY_RECENT (4) rows. A dated step reads that local day; otherwise the newest summary of the
    last 7 days (up to KH_STEP_DAILY_WEEK_DAYS (3) when the step says "week"). Off, nothing changes.
    AGENTS TIER (D20 revised 2026-10-11, docs/multi-agent-instance-design.md 4.9): with the retrieval capability
    attached AND KH_STEP_NS_ITEMS=1 (default 0), a step with a project also gets the findings and lessons that
    consumer namespaces attached to that project hold (tier ``agents``, after ``distilled``): items whose trigger
    the step names first, then items close by meaning; at most KH_STEP_NS_SHARE (0.4) of the budget. Off, nothing
    changes.

Every row is a snippet (app/retriever.clip_hit: the head plus the piece that matched), only rows at
or above STEP_FLOOR are kept, and the whole pack stops at STEP_BUDGET_CHARS. Each item says which
tier it came from, so the caller can see whether the answer came from knowledge or from the log.
Every read goes through the caller's permissions: a project the caller cannot read is a 403, and
rows are filtered with auth.row_visible like every other read.

OPEN THREADS (fen, 2026-10-04). One call per step means the model reads one pack and may stop there,
where the old 3-5 separate reads made contradictions and loose ends visible on their own. So the pack
says what it did NOT resolve, and the model takes another step for any thread its answer depends on:
names and relation targets mentioned in the pack whose card is not in it, ticket/PR references not
looked up, rows left out at the budget (with ids), worklog rows skipped because knowledge looked close
enough, and a newer worklog entry than anything packed.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from app import auth, config, hotlog
from app import personal as kh_personal
from app import distill as kh_distill
from app import entities as kh_entities
from app import projects as kh_projects
from app.retriever import clip_hit, query_quick_knowledge

logger = logging.getLogger(__name__)

_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_REF = re.compile(r"\b(?:[A-Z][A-Z0-9]{1,9}-\d{1,6}|PR #\d+|MR !?\d+)\b")
_MIN_ITEM_CHARS = 200      # a smaller remainder is left out rather than sent as a stub
TIERS = ("entity", "distilled", "personal-lesson", "agents", "daily", "log-recent", "knowledge", "log")
_WEEK_WORDS = ("week", "tuan")


class InjectedItem(BaseModel):
    """A candidate lesson injected into the distilled tier (the offline benchmark gate, design 5.3)."""
    id: str = Field(..., min_length=1, max_length=64)
    text: str = Field(..., min_length=1, max_length=2000)


class StepRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000,
                      description="The step about to be taken - its intent plus the minimum context")
    project: str | None = Field(default=None, description="The project the step belongs to")
    budget_chars: int | None = Field(default=None, ge=500, le=40000,
                                     description="Ceiling on the pack's text (default config STEP_BUDGET_CHARS)")
    k: int | None = Field(default=None, ge=1, le=20, description="Rows read per lane (default STEP_K)")
    include_log: bool = Field(default=False, description="Pack the worklog by meaning even when knowledge "
                                                         "is close enough (an open thread 'log-skipped' says when)")
    action: str | None = Field(default=None, max_length=120,
                               description="The policy action label this step belongs to; reads distilled "
                                           "items by key before anything is searched by meaning")
    context: str | None = Field(default=None, max_length=120,
                                description="A context tag from the pack's 'contexts' list (or an entity id); "
                                            "narrows the key read")
    entities: list[str] | None = Field(default=None, max_length=10,
                                       description="Entity ids the step names; items naming them come first")
    only_tiers: list[str] | None = Field(default=None, max_length=len(TIERS),
                                         description="Maintainers: keep only these tiers (the budget goes to them "
                                                     "alone), e.g. [\"entity\", \"distilled\"] for the phase 1 bench")
    with_items: list[InjectedItem] | None = Field(default=None, max_length=10,
                                                  description="Maintainers: candidate items packed in the "
                                                              "distilled tier, after the items found by key")
    overrides: dict[str, Any] | None = Field(default=None,
                                             description="Maintainers: per-request tuning overrides for the bench "
                                                         "(names of the improve allowlist, e.g. KH_STEP_FLOOR); "
                                                         "app/caps/improve.request_overrides validates them")


def time_window(text: str) -> tuple[bool, str | None, float | None]:
    """(is a time step, since, until) - a date in the step is that whole UTC day."""
    m = _DATE.search(text or "")
    if m:
        try:
            day = datetime.strptime(m.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            day = None
        if day is not None:
            return True, m.group(1) + "T00:00:00Z", (day + timedelta(days=1)).timestamp()
    hay = f" {kh_entities.fold(text)} "
    return any(f" {kh_entities.fold(w)} " in hay for w in config.STEP_TIME_WORDS), None, None


class _Pack:
    """Items in tier order, cut at the budget; a row already packed is not packed twice."""

    def __init__(self, budget: int, only: set[str] | None = None):
        self.budget, self.used, self.items, self.seen, self.full = budget, 0, [], set(), False
        self.dropped: list[dict] = []        # rows left out at the budget - an open thread
        self.only = only                     # only_tiers: other tiers are not packed and cost no budget

    def add(self, tier: str, item: dict) -> None:
        if self.only is not None and tier not in self.only:
            return
        if item["id"] in self.seen:
            return
        if self.full:
            self.dropped.append({"tier": tier, "id": item["id"], "score": item.get("score")})
            return
        text = item.get("text") or ""
        room = self.budget - self.used
        if len(text) > room:                  # the last item is cut to fit when enough room is left
            self.full = True
            if room < _MIN_ITEM_CHARS:
                self.dropped.append({"tier": tier, "id": item["id"], "score": item.get("score")})
                return
            item = {**item, "text": text[:room], "truncated": True, "text_len": item.get("text_len") or len(text)}
            text = item["text"]
        size = len(text)
        self.seen.add(item["id"])
        self.used += size
        self.items.append({"tier": tier, **item})


def _row_item(hit: dict, query: str | None = None) -> dict:
    h = clip_hit(hit, config.STEP_ITEM_CHARS, query)
    item = {"id": h.get("vector_id"), "score": round(h["score"], 3) if "score" in h else None,
            "text": h.get("source_text") or ""}
    for key in ("truncated", "text_len", "piece_at"):
        if h.get(key):
            item[key] = h[key]
    ts = (h.get("metadata") or {}).get("ts")
    if ts:
        item["ts"] = ts
    return item


async def _nothing() -> list:
    return []


def tuned(name: str, default):
    """A tunable parameter through app/caps/improve.param (S14): the default unless improve is on with an
    override, or a maintainer's per-request override (the bench) is in force."""
    from app.caps import improve
    return improve.param(name, default)


async def _by_meaning(text: str, scope: str, project: str | None, k: int, model) -> list[dict]:
    hits = await query_quick_knowledge(text, k, model, scope=scope, project=project)
    floor = tuned("KH_STEP_FLOOR", config.STEP_FLOOR)
    return [h for h in hits if h["score"] >= floor
            and auth.row_visible(h.get("metadata"), h.get("vector_id"))]


def daily_on() -> bool:
    """The daily tier: the daily capability attached AND KH_STEP_DAILY on (read per call; default off)."""
    from app import caps
    flag = (os.getenv("KH_STEP_DAILY") or "0").strip().lower() in ("1", "on", "true", "yes")
    return flag and caps.is_loaded("daily")


def ns_items_on() -> bool:
    """The agents tier: the retrieval capability attached AND KH_STEP_NS_ITEMS on (read per call; default off)."""
    from app import caps
    flag = (os.getenv("KH_STEP_NS_ITEMS") or "0").strip().lower() in ("1", "on", "true", "yes")
    return flag and caps.is_loaded("retrieval")


def _ns_share() -> float:
    try:
        v = float(os.getenv("KH_STEP_NS_SHARE", "0.4"))
    except ValueError:
        return 0.4
    return v if 0 <= v <= 1 else 0.4


def _daily_rows(project: str, text: str) -> list[dict]:
    """The project's daily summaries (mode llm) this time step reads, newest first; [] when none."""
    from datetime import date as _date

    from app.caps import daily
    m = _DATE.search(text or "")
    if m:
        try:
            day = _date.fromisoformat(m.group(1)).isoformat()
        except ValueError:
            return []
        row = daily.get_row(project, day)
        return [row] if row and row.get("mode") == "llm" and (row.get("text") or "").strip() else []
    try:
        _, tz = daily.project_tz(project)
    except Exception:  # noqa: BLE001 - people settings unreadable: the design default zone
        tz = daily.tz_of(None)
    today = daily.local_day(daily._now_ms(), tz)
    first = (today - timedelta(days=daily.DAYS_BACK)).isoformat()
    got = daily.rows_between(project, first, today.isoformat())
    rows = sorted((r for r in got.values() if r and r.get("mode") == "llm" and (r.get("text") or "").strip()),
                  key=lambda r: r["day"], reverse=True)
    hay = kh_entities.fold(text)
    week = any(w in hay for w in _WEEK_WORDS)
    return rows[:max(1, int(os.getenv("KH_STEP_DAILY_WEEK_DAYS", "3")))] if week else rows[:1]


def bench_call(body: StepRequest) -> bool:
    """A maintainer measurement (only_tiers / with_items / overrides), not a real step: no serve id is logged."""
    return bool(body.only_tiers) or bool(body.with_items) or body.overrides is not None


async def build(body: StepRequest, model, recent, withheld: list | None = None) -> dict:
    """The pack. ``withheld`` (when given) receives the ids distill.served withheld (slice S11).
    ``overrides`` (maintainers only, else 403; an unknown name or a bad value is a 422) are in force for the
    whole build through improve.request_overrides (a context variable, so every read of this request sees them)."""
    if body.overrides is None:
        return await _build(body, model, recent, withheld)
    principal = auth.current()
    if principal is not None and not principal.is_maintainer:
        raise HTTPException(status_code=403, detail="overrides are for maintainers")
    from app.caps import improve
    from app.caps.core import CapError
    with contextlib.ExitStack() as stack:
        try:
            stack.enter_context(improve.request_overrides(body.overrides))
        except CapError as exc:
            raise HTTPException(status_code=422, detail=exc.detail) from exc
        return await _build(body, model, recent, withheld)


async def _build(body: StepRequest, model, recent, withheld: list | None = None) -> dict:
    project = body.project
    if project and not auth.may(project, "project.read"):
        raise HTTPException(status_code=403, detail="missing permission project.read on this project")
    principal = auth.current()
    if bench_call(body) and principal is not None and not principal.is_maintainer:
        raise HTTPException(status_code=403, detail="only_tiers and with_items are for maintainers")
    if body.only_tiers:
        unknown = [t for t in body.only_tiers if t not in TIERS]
        if unknown:
            raise HTTPException(status_code=422, detail=f"unknown tiers {unknown}; known: {list(TIERS)}")
    k = body.k or config.STEP_K
    pack = _Pack(body.budget_chars or config.STEP_BUDGET_CHARS, set(body.only_tiers) if body.only_tiers else None)
    is_time, since, until = time_window(body.text)

    visible = auth.visible_projects("project.read")
    scope = [project] if project else [p for p in kh_projects.list_projects() if visible is None or p in visible]
    lanes = [project] if project else [None]
    lesson = config.TURN_LESSON_PROJECT
    if lesson and lesson != project and auth.may(lesson, "project.read"):
        lanes.append(lesson)

    async def named():
        return await asyncio.to_thread(kh_entities.match, body.text, scope, config.STEP_ENTITY_LIMIT)

    async def newest():
        res = await recent(limit=config.STEP_RECENT_LIMIT, project=project, since=since, topic=None,
                           max_chars=None, until=until)
        return [h.model_dump() for h in res.hits]

    # Every read is independent, so they run at once; the order below decides only what is packed.
    # The log by meaning is read speculatively and used only when knowledge is not close enough.
    use_daily = bool(is_time and project and daily_on())
    reads = {"named": named(),
             "entity": _by_meaning(body.text, kh_entities.SCOPE, project, config.STEP_ENTITY_LIMIT, model),
             "log": _nothing() if is_time else _by_meaning(body.text, hotlog.config.HOTLOG_SCOPE, project, k, model),
             "recent": newest() if is_time else _nothing()}
    if use_daily:                             # only then: off, the reads (and the pack) are unchanged
        reads["daily"] = asyncio.to_thread(_daily_rows, project, body.text)
    if project and ns_items_on():             # off: the reads (and the pack) are unchanged
        from app.caps import retrieval as ns_retrieval
        reads["agents"] = asyncio.to_thread(ns_retrieval.people_items, project, body.text, body.context)
    reads.update({f"know:{lane}": _by_meaning(body.text, "knowledge", lane, k, model) for lane in lanes})
    own = kh_personal.own_id()                # the caller's own lessons (sign-in on only)
    if own and config.PERSONAL_LESSON_SCOPE:
        reads["mine"] = _by_meaning(body.text, config.PERSONAL_LESSON_SCOPE, own, k, model)
    keyed_lanes = [lane for lane in lanes if lane] if (body.action or body.context) else []
    reads.update({f"key:{lane}": asyncio.to_thread(kh_distill.served, lane, body.action, body.context,
                                                   body.entities, config.STEP_KEY_LIMIT, body.text, model)
                  for lane in keyed_lanes})
    for lane in lanes:                        # the catalog covers every lane a key can be read from
        if lane:
            reads[f"contexts:{lane}"] = asyncio.to_thread(kh_distill.contexts, lane)
    got = dict(zip(reads, await asyncio.gather(*reads.values(), return_exceptions=True)))
    for name, value in got.items():
        if isinstance(value, Exception):     # a broken tier must not cost the step the others
            logger.warning("step context: %s failed: %s", name, value)
            got[name] = ([], "") if name.startswith("key:") else []
        elif name.startswith("key:"):
            from app.caps import outcomes
            got[name], held = outcomes.split_served(value)
            if withheld is not None:
                withheld.extend(held)

    # 1. entity cards named in the step, then the cards near it by meaning (a thing described, not named)
    for card in got["named"]:
        pack.add("entity", {"id": card["id"], "text": kh_entities.line_of(card)})
    for h in got["entity"]:
        pack.add("entity", _row_item(h))
    # 1b. distilled items by key - a SELECT, so they carry no score
    with_sources = principal is not None and principal.is_maintainer
    answered = {}
    keyed = kh_distill.exact_first({lane: got[f"key:{lane}"] for lane in keyed_lanes})
    for lane, (found, key) in keyed.items():
        if found:
            answered[lane] = key
        for it in found:
            pack.add("distilled", {"id": it["id"], "score": None, "key": key, "status": it.get("status"),
                                   "text": kh_distill.line_of(it, with_sources=with_sources)})
    for it in body.with_items or []:          # candidates under test (maintainers only, checked above)
        pack.add("distilled", {"id": it.id, "score": None, "key": "injected", "status": "candidate",
                               "text": it.text, "injected": True})
    # 1b'. the caller's own lessons, before every shared row: on overlap the personal lesson wins
    for h in got.get("mine") or []:
        pack.add("personal-lesson", {**_row_item(h, body.text), "scope": config.PERSONAL_LESSON_SCOPE,
                                     "project": own})
    # 1c. findings and lessons of consumer namespaces on this project (agents tier, D20 revised), capped
    agents_served = []
    if got.get("agents"):
        from app.caps import retrieval as ns_retrieval
        cap, used = int(pack.budget * _ns_share()), 0
        for x in got["agents"]:
            text = f"[{x['ns']}] " + ns_retrieval.line_of(x["item"])
            if used + len(text) > cap:
                pack.dropped.append({"tier": "agents", "id": x["item"]["id"], "score": x["score"]})
                continue
            before = pack.used
            pack.add("agents", {"id": x["item"]["id"], "score": x["score"], "ns": x["ns"], "why": x["why"],
                                "status": x["item"]["status"], "text": text})
            if pack.used > before:
                used += pack.used - before
                agents_served.append(x)
    if agents_served and not bench_call(body):
        from app.caps import retrieval as ns_retrieval
        await asyncio.to_thread(ns_retrieval.note_people_served, project, agents_served,
                                principal.email if principal is not None else None)
    # time steps: the day's summary first (daily tier, S12), then the worklog by recency - fewer rows
    #   when a summary was packed (roadmap rule 2026-09-30: time questions read the summary first)
    recent_rows = got["recent"]
    for row in got.get("daily") or []:
        pack.add("daily", {"id": f"daily:{project}:{row['day']}", "score": None, "day": row["day"],
                           "rev": row.get("rev"), "text": f"Daily summary {row['day']}:\n{row['text'].strip()}"})
    if got.get("daily"):
        recent_rows = recent_rows[:int(os.getenv("KH_STEP_DAILY_RECENT", "4"))]
    for h in recent_rows:
        pack.add("log-recent", _row_item(h))
    # 2. knowledge by meaning: the project's own and the shared lessons. A lesson in trial is withheld here too
    #    (its dk row is live in the knowledge collection), not only in the key read above.
    from app.caps import learn
    know = learn.withhold([h for lane in lanes for h in got[f"know:{lane}"]], lambda h: h.get("vector_id"),
                          withheld)
    rows = [("knowledge", h) for h in know]
    # 3. the worklog by meaning, only when no knowledge row is close enough to answer the step;
    #    its rows then join the knowledge rows in score order, so a closer log row comes first
    log_skipped = 0
    if body.include_log or max((h["score"] for h in know), default=0.0) < tuned("KH_STEP_KNOW_ENOUGH",
                                                                                 config.STEP_KNOW_ENOUGH):
        rows += [("log", h) for h in got["log"]]
    else:
        log_skipped = len(got["log"])
    # only_tiers with "distilled" but not "knowledge": a distilled item found by meaning counts as distilled
    # (design P1: distilled knowledge = entity cards + distilled items), so the bench measures all of them
    as_distilled = pack.only is not None and "distilled" in pack.only and "knowledge" not in pack.only
    for tier, h in sorted(rows, key=lambda x: x[1]["score"], reverse=True):
        if as_distilled and tier == "knowledge" and str(h.get("vector_id") or "").startswith(kh_distill.ID_PREFIX):
            tier = "distilled"
        pack.add(tier, _row_item(h, body.text))

    threads = await open_threads(body, pack, scope, project, is_time, log_skipped, got, recent)
    best = max((i["score"] for i in pack.items if i.get("score") is not None), default=None)
    out = {"project": project, "time_step": is_time, "since": since,
            "tiers": list(dict.fromkeys(i["tier"] for i in pack.items)),
            "floor": tuned("KH_STEP_FLOOR", config.STEP_FLOOR), "budget_chars": pack.budget, "used_chars": pack.used,
            "cut_at_budget": pack.full, "count": len(pack.items), "best_score": best,
            "items": pack.items, "open_threads": threads}
    if body.action or body.context:
        out["keys"] = {"action": body.action, "context": body.context, "entities": body.entities or [],
                       "answered_by": answered}
    tags = list(dict.fromkeys(c["tag"] for lane in lanes if lane for c in got.get(f"contexts:{lane}") or []))
    if tags:                                  # the catalog the caller picks a context from next time
        out["contexts"] = tags[:config.STEP_CONTEXT_LIMIT]
    return out


async def open_threads(body: StepRequest, pack: _Pack, scope: list[str], project: str | None, is_time: bool,
                       log_skipped: int, got: dict, recent) -> list[dict]:
    """What this pack did not resolve, so the caller can take one more step instead of stopping."""
    out: list[dict] = []
    text = "\n".join(i.get("text") or "" for i in pack.items)
    step = kh_entities.fold(body.text)
    # cards named in the pack, or targets of a packed card's relations, whose own card is not packed
    named = got.get("named") or []
    packed_cards = {c["id"] for c in named}
    targets = " ".join(r.get("target") or "" for c in named for r in c.get("relations", []))
    try:
        mentioned = await asyncio.to_thread(kh_entities.match, text + " " + targets, scope,
                                            config.STEP_THREAD_LIMIT * 2)
    except Exception as e:  # noqa: BLE001 - a thread hint must never cost the step
        logger.warning("step context: open threads (entities) failed: %s", e)
        mentioned = []
    names = [c["name"] for c in mentioned if c["id"] not in packed_cards and c["id"] not in pack.seen]
    if names:
        out.append({"kind": "entity-not-loaded", "names": names[:config.STEP_THREAD_LIMIT],
                    "hint": "named in the pack but its card is not here; take a step about it if the answer depends on it"})
    refs = [r for r in dict.fromkeys(_REF.findall(text)) if kh_entities.fold(r) not in step]
    if refs:
        out.append({"kind": "reference-not-looked-up", "refs": refs[:config.STEP_THREAD_LIMIT],
                    "hint": "tickets, PRs or MRs mentioned in the pack; look one up only if the answer depends on it"})
    if pack.dropped:
        out.append({"kind": "cut-at-budget", "count": len(pack.dropped),
                    "ids": [d["id"] for d in pack.dropped[:config.STEP_THREAD_LIMIT]],
                    "hint": "rows left out at the budget; read one with POST /vector/scroll {ids} if needed"})
    if log_skipped:
        out.append({"kind": "log-skipped", "count": log_skipped,
                    "hint": "worklog rows near this step were skipped because knowledge looked close enough; "
                            "repeat the step with include_log=true for history, or when knowledge seems stale"})
    # rows read by meaning carry no ts, so the test is: the pack holds log rows, but not the newest one
    if project and not is_time and any(i["tier"] == "log" for i in pack.items):
        packed_ts = max((i.get("ts") or "" for i in pack.items), default="")
        try:
            res = await recent(limit=1, project=project, since=None, topic=None, max_chars=200, until=None)
            newest = [h.model_dump() for h in res.hits]
        except Exception as e:  # noqa: BLE001
            logger.warning("step context: open threads (newest) failed: %s", e)
            newest = []
        if newest:
            n_ts = (newest[0].get("metadata") or {}).get("ts") or ""
            if n_ts and n_ts > packed_ts and newest[0].get("vector_id") not in pack.seen:
                out.append({"kind": "newer-log", "ts": n_ts, "id": newest[0].get("vector_id"),
                            "hint": "the project's log has an entry newer than anything packed; check it if "
                                    "the step is about current state"})
    return out


def attach(app, recent) -> None:
    """``recent`` is the /log/recent handler, passed in so the step reads the log the same way."""
    TAG = ["Turn"]

    @app.post("/context/step", tags=TAG,
              summary="One bounded context pack for one step: entities, then knowledge, then the log")
    async def context_step(body: StepRequest, request: Request) -> dict:
        from app.caps import outcomes
        withheld: list = []
        out = await build(body, request.app.state.model, recent, withheld)
        if not bench_call(body):              # serve_id + kh.served only with KH_CAP_OUTCOMES on (else unchanged)
            outcomes.note_served(request, out, "step", body.project, body.action, body.context,
                                 [i["id"] for i in out["items"]], withheld)
        return out

    logger.info("Step routes attached (/context/step)")
