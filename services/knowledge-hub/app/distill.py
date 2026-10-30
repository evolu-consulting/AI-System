"""Distil worklogs into small knowledge items (roadmap item D, design docs/distill-design.md, 2026-10-09).

WHY. A worklog records one turn. What lasts - a decision, a lesson, a procedure, how a role in a
project works - is spread over many rows and reaches knowledge only when a session writes it there
by hand. Distilling moves it out of the log into short items that point back at their sources.

WHO DISTILS. One distiller, never the user's assistant during a turn (fen 2026-10-01): for now fen's
Claude CLI on weekends, later a worker with its own model. KH holds no model; it hands out work,
checks what comes back in code, and stores it. The same routes serve both callers.

THE LOOP.
  GET  /distill/next     a batch of unread logs WITH SIGNAL for one consented project, plus what the
                         distiller needs to merge rather than repeat: the project's live items, the
                         closed lists of kinds, actions and contexts, and the people (to write aliases).
  POST /distill/submit   items back; schema, leak gate, duplicates and contradictions are decided
                         here; items land as `proposed`; the project's cursor advances.
  GET  /distill/pending  proposed and contested items, one line each, for fen's review.
  POST /distill/approve  -> active (and, for ids in `share`, a generalised copy in the shared project;
                         a policy proposal becomes a policy rule of the project).
  POST /distill/reject   -> withdrawn.

SIGNAL. A log is served when it holds a signal word, starts a topic the project has not had, follows a
log that had signal, or falls in the random sample (DISTILL_SAMPLE_PCT) that keeps a missing word
visible. The word list lives in the table distill_signal, seeded from config once; the distiller adds
words it finds (fen 2026-10-09: the list is dynamic) and fen can add or remove them by hand.

AN ITEM is an ordinary row of the project's knowledge part, so every read path, grant and backend
works on it unchanged. `status` says where it stands; `knowledge_type` follows it, because every
model-facing read keeps knowledge_type == quick: an item that is proposed, superseded or withdrawn is
invisible to them while /vector/scroll still shows it to maintainers. Sources (worklog ids) are
stored for maintainers only.

THE WORKER (roadmap E, docs/roadmap-e-to-5-design.md 3.2-3.3, slice S5). The scheduled worker calls the
same routes with a kh_people principal token of role distiller (app/caps/people.py lets it through only
while KH_DISTILL_WORKER is dry or on). For such a caller:
  - `distilled_by` is required and starts with `worker:` (the model id), so G2 can tell its items apart;
  - under KH_DISTILL_WORKER=dry every submit is forced to a DRY RUN;
  - /distill/next answers 429 `budget` once the month's worker.cost_usd in kh_people reaches
    KH_WORKER_CAP_MONTH_USD (`budget_refusal`, also meant for /daily/next).
A DRY RUN (`dry_run: true`, any caller) runs schema, leak gate, dedupe and contradiction checks and returns
the verdicts, but writes nothing: no item, context or signal word, no cursor move, no hit count; the batch
is released (the next `next` serves the same logs again). `cost_usd` in a submit body is added to the
batch row; a batch that carries a cost is kept (closed) after its last submit, for G2.

Tables (app/sqldb.py, SQLite locally, HANA in the cloud): distill_cursor, distill_batch,
distill_signal, distill_context.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import HTTPException, Query, Request

from app import config, sqldb
from app import vector_store as vs
from app.chunks import PARENT_KEY
from app.entities import fold

logger = logging.getLogger(__name__)

KINDS = ("lesson", "fact", "procedure", "habit", "pattern", "policy_proposal")
SUBMITTED_KINDS = tuple(k for k in KINDS if k != "pattern")      # patterns are counted in code
STATUSES = ("proposed", "active", "contested", "superseded", "withdrawn")
VISIBLE = ("active", "contested")                                # what a model may be served
TOPIC = "distilled"
NONE_KEY = "-"
SOFT_KEY = "action, context lifts"     # served() with a soft context: never treated as an exact key by exact_first
ID_PREFIX = "dk_"
FOLLOWS = re.compile(r"\bfollows\s+(vec_[0-9a-f]{6,})", re.I)

CURSOR, BATCH, SIGNAL, CONTEXT = "distill_cursor", "distill_batch", "distill_signal", "distill_context"
_LOCK = threading.Lock()
_ALWAYS = [re.compile(p) for p in config.DISTILL_LEAK_PATTERNS]          # e-mail, secrets: every item
_STRICT = [re.compile(p) for p in config.DISTILL_SHARE_LEAK_PATTERNS]    # hosts, IPs: shared or not own


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── tables ───────────────────────────────────────────────────────────────────

_DDL = {
    CURSOR: ("""CREATE TABLE IF NOT EXISTS distill_cursor (
                    project     TEXT PRIMARY KEY,
                    last_ts     REAL NOT NULL DEFAULT 0,
                    last_ids    TEXT NOT NULL DEFAULT '[]',
                    signal_ids  TEXT NOT NULL DEFAULT '[]',
                    topics      TEXT NOT NULL DEFAULT '[]',
                    updated_at  TEXT NOT NULL)""",
             """CREATE COLUMN TABLE distill_cursor (
                    project     NVARCHAR(256) PRIMARY KEY,
                    last_ts     DOUBLE        NOT NULL,
                    last_ids    NCLOB         NOT NULL,
                    signal_ids  NCLOB         NOT NULL,
                    topics      NCLOB         NOT NULL,
                    updated_at  NVARCHAR(32)  NOT NULL)"""),
    BATCH: ("""CREATE TABLE IF NOT EXISTS distill_batch (
                    batch_id    TEXT PRIMARY KEY,
                    project     TEXT NOT NULL,
                    log_ids     TEXT NOT NULL,
                    state       TEXT NOT NULL,
                    created_at  TEXT NOT NULL)""",
            """CREATE COLUMN TABLE distill_batch (
                    batch_id    NVARCHAR(64)  PRIMARY KEY,
                    project     NVARCHAR(256) NOT NULL,
                    log_ids     NCLOB         NOT NULL,
                    state       NCLOB         NOT NULL,
                    created_at  NVARCHAR(32)  NOT NULL)"""),
    SIGNAL: ("""CREATE TABLE IF NOT EXISTS distill_signal (
                    word        TEXT PRIMARY KEY,
                    kind        TEXT NOT NULL,
                    source      TEXT NOT NULL,
                    reason      TEXT NOT NULL DEFAULT '',
                    hits        INTEGER NOT NULL DEFAULT 0,
                    added_at    TEXT NOT NULL)""",
             """CREATE COLUMN TABLE distill_signal (
                    word        NVARCHAR(64)   PRIMARY KEY,
                    kind        NVARCHAR(32)   NOT NULL,
                    source      NVARCHAR(256)  NOT NULL,
                    reason      NVARCHAR(512)  NOT NULL,
                    hits        INTEGER        NOT NULL,
                    added_at    NVARCHAR(32)   NOT NULL)"""),
    CONTEXT: ("""CREATE TABLE IF NOT EXISTS distill_context (
                    project     TEXT NOT NULL,
                    tag         TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    source      TEXT NOT NULL,
                    added_at    TEXT NOT NULL,
                    PRIMARY KEY (project, tag))""",
              """CREATE COLUMN TABLE distill_context (
                    project     NVARCHAR(256)  NOT NULL,
                    tag         NVARCHAR(64)   NOT NULL,
                    description NVARCHAR(512)  NOT NULL,
                    source      NVARCHAR(256)  NOT NULL,
                    added_at    NVARCHAR(32)   NOT NULL,
                    PRIMARY KEY (project, tag))"""),
}


def init() -> None:
    """Create the four tables if absent and seed the signal words once. Safe on every startup."""
    with _LOCK, sqldb.connect() as c:
        for name, (lite, hana) in _DDL.items():
            sqldb.create_table(c, name, lite, hana)
        # stage F1: the first submit of a batch claims it with a conditional UPDATE on this column
        sqldb.migrate(c, "distill", [(1, lambda cc: sqldb.add_column(
            cc, BATCH, "claimed", "INTEGER NOT NULL DEFAULT 0", "INTEGER DEFAULT 0 NOT NULL")),
            # roadmap E (S5): the worker's spend per batch (G2), and a closed state that keeps such a row
            (2, _m2)])
        if c.execute(f"SELECT COUNT(*) FROM {SIGNAL}").fetchone()[0]:
            return
        for kind, words in seed_words():
            for w in words:
                sqldb.upsert(c, SIGNAL, ["word"], {"word": w, "kind": kind, "source": "seed", "reason": "",
                                                   "hits": 0, "added_at": _now()})


def _m2(c) -> None:
    sqldb.add_column(c, BATCH, "cost_usd", "REAL NOT NULL DEFAULT 0", "DOUBLE DEFAULT 0 NOT NULL")
    sqldb.add_column(c, BATCH, "closed", "INTEGER NOT NULL DEFAULT 0", "INTEGER DEFAULT 0 NOT NULL")


def seed_words() -> list[tuple[str, list[str]]]:
    out = []
    for group in config.DISTILL_SIGNAL_SEED.split(";"):
        kind, _, words = group.partition(":")
        if kind.strip() and words.strip():
            out.append((kind.strip(), [fold(w) for w in words.split(",") if fold(w)]))
    return out


# ── signal words ────────────────────────────────────────────────────────────

def signal_words() -> list[dict]:
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT word, kind, source, reason, hits, added_at FROM {SIGNAL} ORDER BY kind, word").fetchall()
    return [{k: r[k] for k in ("word", "kind", "source", "reason", "hits", "added_at")} for r in rows]


def add_signal_words(words: list, source: str, write: bool = True) -> list[dict]:
    """Add words (dicts {word, kind, reason} or plain strings). One line per word: added or why not.
    ``write=False`` (a dry run) gives the same verdicts and stores nothing."""
    have = {w["word"] for w in signal_words()}
    out = []
    with _LOCK, sqldb.connect() as c:
        for raw in words or []:
            entry = raw if isinstance(raw, dict) else {"word": raw}
            word = fold(str(entry.get("word") or ""))
            kind = fold(str(entry.get("kind") or "other")).replace(" ", "-") or "other"
            if not (config.DISTILL_SIGNAL_MIN_CHARS <= len(word) <= config.DISTILL_SIGNAL_MAX_CHARS):
                out.append({"word": word, "result": "refused", "reason": "length"})
            elif word in have:
                out.append({"word": word, "result": "exists"})
            elif _leak(word):
                out.append({"word": word, "result": "refused", "reason": "looks like personal or host data"})
            else:
                if write:
                    sqldb.upsert(c, SIGNAL, ["word"], {"word": word, "kind": kind, "source": source[:256],
                                                       "reason": str(entry.get("reason") or "")[:512],
                                                       "hits": 0, "added_at": _now()})
                have.add(word)
                out.append({"word": word, "result": "added", "kind": kind})
    return out


def remove_signal_words(words: list[str]) -> int:
    with _LOCK, sqldb.connect() as c:
        return sum(c.execute(f"DELETE FROM {SIGNAL} WHERE word=?", [fold(w)]).rowcount or 0 for w in words or [])


def _count_hits(counts: dict[str, int]) -> None:
    if not counts:
        return
    with _LOCK, sqldb.connect() as c:
        for word, n in counts.items():
            c.execute(f"UPDATE {SIGNAL} SET hits = hits + ? WHERE word=?", [n, word])


def signals_in(text: str, words: list[str]) -> list[str]:
    hay = f" {fold(text)} "
    return [w for w in words if f" {w} " in hay]


# ── contexts ────────────────────────────────────────────────────────────────

def contexts(project: str) -> list[dict]:
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT tag, description, source FROM {CONTEXT} WHERE project=? ORDER BY tag",
                         [project]).fetchall()
    return [{"tag": r["tag"], "description": r["description"], "source": r["source"]} for r in rows]


def add_contexts(project: str, items: list, source: str, write: bool = True) -> list[dict]:
    have = {c["tag"] for c in contexts(project)}
    out = []
    with _LOCK, sqldb.connect() as c:
        for raw in items or []:
            entry = raw if isinstance(raw, dict) else {"tag": raw}
            tag = fold(str(entry.get("tag") or "")).replace(" ", "-")
            if not (2 <= len(tag) <= 64):
                out.append({"tag": tag, "result": "refused", "reason": "length"})
            elif tag in have:
                out.append({"tag": tag, "result": "exists"})
            else:
                if write:
                    sqldb.upsert(c, CONTEXT, ["project", "tag"], {
                        "project": project, "tag": tag, "description": str(entry.get("description") or "")[:512],
                        "source": source[:256], "added_at": _now()})
                have.add(tag)
                out.append({"tag": tag, "result": "added"})
    return out


# ── cursor and batches ──────────────────────────────────────────────────────

def cursor(project: str) -> dict:
    with sqldb.connect() as c:
        r = c.execute(f"SELECT last_ts, last_ids, signal_ids, topics FROM {CURSOR} WHERE project=?",
                      [project]).fetchone()
    if r is None:
        return {"last_ts": 0.0, "last_ids": [], "signal_ids": [], "topics": []}
    return {"last_ts": float(r["last_ts"] or 0), "last_ids": json.loads(r["last_ids"] or "[]"),
            "signal_ids": json.loads(r["signal_ids"] or "[]"), "topics": json.loads(r["topics"] or "[]")}


def _save_cursor(project: str, cur: dict) -> bool:
    """Move the cursor FORWARD only (stage F1): a conditional UPDATE on last_ts, so a late submit of an
    older batch on another instance cannot move it back. Returns True when this call moved it."""
    row = {"last_ts": cur["last_ts"], "last_ids": json.dumps(cur["last_ids"]),
           "signal_ids": json.dumps(cur["signal_ids"][-500:]), "topics": json.dumps(sorted(set(cur["topics"]))),
           "updated_at": _now()}
    sql = (f"UPDATE {CURSOR} SET last_ts=?, last_ids=?, signal_ids=?, topics=?, updated_at=? "
           "WHERE project=? AND last_ts <= ?")
    params = [row["last_ts"], row["last_ids"], row["signal_ids"], row["topics"], row["updated_at"], project,
              row["last_ts"]]
    with sqldb.connect() as c:
        if sqldb.update(c, sql, params):
            return True
        if sqldb.insert_new(c, CURSOR, {"project": project, **row}):
            return True
        return sqldb.update(c, sql, params) > 0


def reset_cursor(project: str) -> None:
    with _LOCK, sqldb.connect() as c:
        c.execute(f"DELETE FROM {CURSOR} WHERE project=?", [project])


def _save_batch(batch_id: str, project: str, log_ids: list[str], state: dict) -> None:
    with _LOCK, sqldb.connect() as c:
        c.execute(f"INSERT INTO {BATCH} (batch_id, project, log_ids, state, created_at) VALUES (?,?,?,?,?)",
                  [batch_id, project, json.dumps(log_ids), json.dumps(state), _now()])


def _load_batch(batch_id: str) -> dict | None:
    """An OPEN batch (a closed row is kept only for its cost)."""
    with sqldb.connect() as c:
        r = c.execute(f"SELECT project, log_ids, state FROM {BATCH} WHERE batch_id=? AND closed=0",
                      [batch_id]).fetchone()
    if r is None:
        return None
    return {"project": r["project"], "log_ids": json.loads(r["log_ids"]), "state": json.loads(r["state"])}


def _update_batch(batch_id: str, state: dict) -> None:
    with _LOCK, sqldb.connect() as c:
        c.execute(f"UPDATE {BATCH} SET state=? WHERE batch_id=?", [json.dumps(state), batch_id])


def _claim_batch(batch_id: str) -> bool:
    """The first submit of a batch claims it (conditional UPDATE); only that submit moves the cursor."""
    with sqldb.connect() as c:
        return sqldb.update(c, f"UPDATE {BATCH} SET claimed=1 WHERE batch_id=? AND claimed=0", [batch_id]) > 0


def _close_batch(batch_id: str) -> None:
    """Delete the batch, or keep it closed when it carries a worker cost (G2 reads it)."""
    with _LOCK, sqldb.connect() as c:
        c.execute(f"UPDATE {BATCH} SET closed=1 WHERE batch_id=? AND cost_usd > 0", [batch_id])
        c.execute(f"DELETE FROM {BATCH} WHERE batch_id=? AND closed=0", [batch_id])


def _add_cost(batch_id: str, cost_usd: float) -> None:
    if cost_usd > 0:
        with _LOCK, sqldb.connect() as c:
            c.execute(f"UPDATE {BATCH} SET cost_usd = cost_usd + ? WHERE batch_id=?", [cost_usd, batch_id])


def _is_claimed(batch_id: str) -> bool:
    with sqldb.connect() as c:
        r = c.execute(f"SELECT claimed FROM {BATCH} WHERE batch_id=?", [batch_id]).fetchone()
    return bool(r and r["claimed"])


def batch_cost(batch_id: str) -> float | None:
    """The spend recorded on a batch (open or closed), or None when there is no such row."""
    with sqldb.connect() as c:
        r = c.execute(f"SELECT cost_usd FROM {BATCH} WHERE batch_id=?", [batch_id]).fetchone()
    return None if r is None else float(r["cost_usd"] or 0)


def consented(project: str) -> bool:
    return project in config.DISTILL_PROJECTS


def _tuned(name: str, default):
    """A tunable parameter through app/caps/improve.param (S14): the default unless improve is on with an
    override (or a maintainer's per-request bench override is in force)."""
    from app.caps import improve
    return improve.param(name, default)


def _sampled(log_id: str, pct: int | None = None) -> bool:
    pct = _tuned("KH_DISTILL_SAMPLE_PCT", config.DISTILL_SAMPLE_PCT) if pct is None else pct
    return int(hashlib.sha256(log_id.encode()).hexdigest()[:8], 16) % 100 < pct


def _confirmer(project: str, encode):
    """A function telling whether a log only repeats a live item: (item id or None).

    Thousands of near-identical logs ("QC asked for a root cause again") should make one item with a
    large evidence count, not thousands of model reads. A log counts as a repeat when it is at least
    DISTILL_CONFIRM close to a live item AND holds no signal word that the item's text lacks: a new
    board, channel or failure word still goes to the distiller.
    """
    live = items(project, ("proposed", "active", "contested"))
    if not live or encode is None:
        return lambda text, found: None
    vecs = [(it, encode(f"{it['title']}. {it['text']}"), f" {fold(it['title'] + ' ' + it['text'])} ") for it in live]
    confirm = _tuned("KH_DISTILL_CONFIRM", config.DISTILL_CONFIRM)

    def repeat_of(text: str, found: list[str]) -> str | None:
        v = encode(text[:config.DISTILL_LOG_CHARS])
        best, score = None, confirm
        for it, iv, hay in vecs:
            s = _cos(v, iv)
            if s >= score and all(f" {w} " in hay for w in found):
                best, score = it["id"], s
        return best
    return repeat_of


def next_batch(project: str, lanes: list, limit: int, encode=None) -> dict:
    """The next batch of logs with signal for one project, oldest first, past the cursor.

    ``lanes`` are the (collection, where) pairs of the project's log (the hot window and kh_log_<id>).
    Rows without signal are passed over and counted; a signal row that only repeats a live item is
    kept back as a confirmation of that item (applied on submit); the cursor moves only on submit.
    """
    from app import hotlog
    cur = cursor(project)
    words = [w["word"] for w in signal_words()]
    words = _tuned("signal_words", words)
    sample_pct = _tuned("KH_DISTILL_SAMPLE_PCT", config.DISTILL_SAMPLE_PCT)
    repeat_of = _confirmer(project, encode)
    confirms: dict[str, list[str]] = {}
    seen_ids = set(cur["last_ids"])
    stubs: dict[str, tuple[int, float, str]] = {}
    for n, (coll, where) in enumerate(lanes):
        for vid, ts in vs.field_values_vt("ts", where, collection=coll):
            t = hotlog.parse_ts(ts) if ts is not None else 0.0
            if (t > cur["last_ts"] or (t == cur["last_ts"] and vid not in seen_ids)) and vid not in stubs:
                stubs[vid] = (n, t, vid)
    order = sorted(stubs.values(), key=lambda s: (s[1], s[2]))
    remaining = len(order)
    order = order[:config.DISTILL_SCAN_MAX]

    picked, passed, hits = [], 0, {}
    signal_ids = list(cur["signal_ids"])
    topics = set(cur["topics"])
    last_ts, last_ids = cur["last_ts"], []
    for start in range(0, len(order), 50):
        chunk = order[start:start + 50]
        rows: dict[str, dict] = {}
        for n, (coll, where) in enumerate(lanes):
            ids = [s[2] for s in chunk if s[0] == n]
            if ids:
                rows.update({h["vector_id"]: h for h in vs.get_ids_vt(ids, where, collection=coll)})
        for _, t, vid in chunk:
            row = rows.get(vid)
            if row is None:
                continue
            text = row.get("source_text") or ""
            topic = (row.get("metadata") or {}).get("topic") or ""
            why = [f"word:{w}" for w in signals_in(text, words)]
            if topic and topic not in topics:
                why.append("new-topic")
            if any(m in signal_ids for m in FOLLOWS.findall(text)):
                why.append("follows-signal")
            if not why and _sampled(vid, sample_pct):
                why.append("sample")
            if topic:
                topics.add(topic)
            last_ids = [vid] if t != last_ts else last_ids + [vid]
            last_ts = t
            if why:
                found = [w[5:] for w in why if w.startswith("word:")]
                for w in found:
                    hits[w] = hits.get(w, 0) + 1
                if "sample" not in why:
                    signal_ids.append(vid)
                same = None if "new-topic" in why else repeat_of(text, found)
                if same:
                    confirms.setdefault(same, []).append(vid)
                    continue
                picked.append({"id": vid, "ts": (row.get("metadata") or {}).get("ts"), "topic": topic,
                               "why": why, "text": text[:config.DISTILL_LOG_CHARS]})
            else:
                passed += 1
            if len(picked) >= limit:
                break
        if len(picked) >= limit:
            break

    examined = len(picked) + passed + sum(len(v) for v in confirms.values())
    state = {"last_ts": last_ts, "last_ids": last_ids, "signal_ids": signal_ids[-500:], "topics": sorted(topics),
             "hits": hits, "confirms": confirms}
    batch_id = "db_" + uuid.uuid4().hex
    if examined:
        _save_batch(batch_id, project, [p["id"] for p in picked], state)
    return {"project": project, "batch_id": batch_id if examined else None, "logs": picked,
            "passed_without_signal": passed,
            "confirmed_in_code": {k: len(v) for k, v in confirms.items()},
            "remaining_after": max(0, remaining - examined), "done": examined == 0}


def _apply_confirms(project: str, confirms: dict[str, list[str]], encode) -> int:
    """Add the repeat logs of a batch to their items as evidence; no model has read them."""
    n = 0
    for item_id, log_ids in (confirms or {}).items():
        meta = _meta_of(project, item_id)
        if not meta or meta.get("status") not in ("proposed", "active", "contested"):
            continue
        got = vs.get_ids_vt([item_id], collection=_coll(project))
        item = {**item_of(got[0]), **{k: meta.get(k) for k in
                                      ("dkey", "distilled_by", "distilled_at", "target_action", "target_sub_action")}}
        item["sources"] = list(dict.fromkeys(item["sources"] + log_ids))[-50:]
        item["evidence"] = int(meta.get("evidence_count") or 0) + len(log_ids)
        item["last_confirmed"] = _now()
        _write(project, item, encode)
        n += len(log_ids)
    return n


# ── items ───────────────────────────────────────────────────────────────────

def _coll(project: str):
    return vs.scope_collection("knowledge", project)


def dkey(project: str, kind: str, action: str, context: str, entity_key: str) -> str:
    raw = "|".join([project, kind, action or NONE_KEY, context or NONE_KEY, entity_key or NONE_KEY])
    return ID_PREFIX + hashlib.sha256(raw.encode()).hexdigest()[:12]


def item_of(hit: dict) -> dict:
    m = hit.get("metadata") or {}
    return {"id": hit.get("vector_id") or hit.get("core_id"), "project": m.get("project"), "kind": m.get("kind"),
            "action": m.get("action"), "context": m.get("context"),
            "entities": json.loads(m.get("entities_json") or "[]"), "title": m.get("title", ""),
            "text": hit.get("source_text") or "", "status": m.get("status"),
            "evidence_count": m.get("evidence_count", 0), "sources": json.loads(m.get("sources_json") or "[]"),
            "first_seen": m.get("first_seen"), "last_confirmed": m.get("last_confirmed"),
            "superseded_by": m.get("superseded_by", ""), "origin_project": m.get("origin_project", "")}


def line_of(item: dict, with_sources: bool = False) -> str:
    flag = " [contested]" if item.get("status") == "contested" else ""
    keys = f"{item.get('action') or NONE_KEY} / {item.get('context') or NONE_KEY}"
    src = f" (sources: {', '.join(item['sources'][:5])})" if with_sources and item.get("sources") else ""
    title = f"{item['title']}: " if item.get("title") else ""          # rekeyed rows have no title
    return f"{item['id']} {item.get('kind')}{flag} [{keys}] {title}{item.get('text')}{src}"


def items(project: str, statuses: tuple[str, ...] | None = None, where: dict | None = None) -> list[dict]:
    if vs.part_collection_name("knowledge", project) not in vs.existing_collection_names():
        return []
    clauses = [{"topic": {"$eq": TOPIC}}]
    if statuses:
        clauses.append({"status": {"$in": list(statuses)}})
    if where:
        clauses.append(where)
    flt = clauses[0] if len(clauses) == 1 else {"$and": clauses}
    hits = vs.scroll_vt(flt, 100000, 0, collection=_coll(project))["hits"]
    return [item_of(h) for h in hits]


def served(project: str, action: str | None, context: str | None, entities: list[str] | None,
           limit: int, text: str | None = None, model=None) -> tuple[list[dict], str]:
    """Live items by key for a model-facing read (slice 2): the key decides, so no score floor.

    Key order of the design: action + context, then action alone when that found nothing; a step that
    names only a context reads by context. Items naming one of ``entities`` come first. Inside a key
    the rows closest to ``text`` by meaning come next when a model is given (a key can hold dozens of
    rekeyed lessons, and the newest are not the relevant ones); without one, the newest
    ``last_confirmed``. Returns (items, the key that answered: 'action+context', 'action', 'context'
    or '').

    WITHHOLDING (roadmap E-5 slice S11, app/caps/learn.py): a lesson in a randomized trial is withheld
    from the control arm of the request's session. Withheld ids take no place in ``limit``; a key whose
    every item was withheld counts as empty (the next key is tried), as if the lesson did not exist.
    When anything was withheld the result is (items, key, withheld ids); otherwise it is unchanged.
    """
    action = (action or "").strip() or None
    raw = (context or "").strip()            # normalised the way submit stores it
    context = raw if raw.startswith("ent__") else fold(raw).replace(" ", "-") or None
    tries = []
    if action and context:
        tries.append(("action+context", {"$and": [{"action": {"$eq": action}}, {"context": {"$eq": context}}]}))
    if action:
        tries.append(("action", {"action": {"$eq": action}}))
    elif context:
        tries.append(("context", {"context": {"$eq": context}}))
    wanted = {e for e in (entities or []) if e}
    withheld: list[str] = []
    if action and context and text and model is not None and config.STEP_CONTEXT_BONUS is not None:
        # SOFT CONTEXT (2026-10-24, kh-investigate vec_eead247c4272): a guessed context is wrong more often than
        # right (41% right on 210 steps), and a wrong exact key served 6 items of the wrong context first (hit@1
        # 0.49). So the action decides, meaning orders, and the context only lifts its items by a small bonus:
        # hit@1 0.886 with the model's guess, 0.929 with the right context (the exact key's own ceiling).
        got = _live_by_meaning(project, {"action": {"$eq": action}}, text, model, max(limit * 3, 20))
        bonus = config.STEP_CONTEXT_BONUS
        got.sort(key=lambda i: -((i.get("score") or 0.0) + (bonus if i.get("context") == context else 0.0)))
        got, held = _withhold(got)
        withheld += [i for i in held if i not in withheld]
        if got:
            got = got[:limit]
            got.sort(key=lambda i: not wanted.intersection(i.get("entities") or []))   # stable: keeps the order
            key = SOFT_KEY if any(i.get("context") == context for i in got) else "action"
            return (got, key, withheld) if withheld else (got, key)
        tries = [t for t in tries if t[0] == "action"]       # nothing under the action: the same answer as before
    for key, where in tries:
        if text and model is not None:
            got = _live_by_meaning(project, where, text, model, max(limit * 3, 20))
        else:
            got = _live_by_key(project, where)
            got.sort(key=lambda i: i.get("last_confirmed") or "", reverse=True)
        got, held = _withhold(got)
        withheld += [i for i in held if i not in withheld]
        if got:
            got.sort(key=lambda i: not wanted.intersection(i.get("entities") or []))   # stable: keeps the order
            return (got[:limit], key, withheld) if withheld else (got[:limit], key)
    return ([], "", withheld) if withheld else ([], "")


def _withhold(got: list[dict]) -> tuple[list[dict], list[str]]:
    """The learning loop's per-session withholding (slice S11); a no-op unless app.caps.learn is attached."""
    from app import caps
    if not got or not caps.is_loaded("learn"):
        return got, []
    from app.caps import learn
    return learn.split_trial(got)


def exact_first(results: dict) -> dict:
    """{lane: (items, key)} with the action-only fallback dropped when another lane matched exactly.

    A step about CI deploys in m360 found the exact lessons in lesson-learned, but m360's own fallback
    (every m360 item under the action, any context) came first and filled the budget (prod, 2026-10-10).
    The fallback is for when no lane has the exact key.
    """
    if any(key == "action+context" for _, key in results.values()):
        return {lane: (found, key) for lane, (found, key) in results.items() if key != "action"}
    return results


def _live_by_meaning(project: str, where: dict, text: str, model, k: int) -> list[dict]:
    """Live keyed rows ordered by closeness to ``text``: a vector query restricted to the key."""
    from app.retriever import _query_quick_knowledge_sync
    flt = {"$and": [{"status": {"$in": list(VISIBLE)}}, where]}
    # a query hit carries the row id and text only; the keys, status and sources come from the row itself
    hits = _query_quick_knowledge_sync(text, k, model, "knowledge", flt, project)
    order = [h["vector_id"] for h in hits]
    score = {h["vector_id"]: h.get("score") for h in hits}
    rows = {h["vector_id"]: h for h in vs.get_ids_vt(order, collection=_coll(project))} if order else {}
    out = []
    for h in (rows[i] for i in order if i in rows):
        it = item_of(h)
        it["score"] = score.get(it["id"])
        if len(it["text"]) > config.STEP_ITEM_CHARS:
            it["text"] = it["text"][:config.STEP_ITEM_CHARS].rstrip() + " ...(cut; read the row by id)"
        out.append(it)
    return out


def _live_by_key(project: str, where: dict) -> list[dict]:
    """Live keyed rows: distilled items AND older knowledge rows keyed by /distill/rekey.

    A rekeyed row keeps its own topic and kind (other reads filter on them), so the filter is the
    status, not the topic. Long rows (guides) are cut to STEP_ITEM_CHARS: the line is a pointer, the
    whole row is one /vector/scroll away.
    """
    if vs.part_collection_name("knowledge", project) not in vs.existing_collection_names():
        return []
    flt = {"$and": [{"status": {"$in": list(VISIBLE)}}, {"knowledge_type": {"$eq": "quick"}}, where]}
    out = []
    for h in vs.scroll_vt(flt, 100000, 0, collection=_coll(project))["hits"]:
        if (h.get("metadata") or {}).get(PARENT_KEY):
            continue
        it = item_of(h)
        if len(it["text"]) > config.STEP_ITEM_CHARS:
            it["text"] = it["text"][:config.STEP_ITEM_CHARS].rstrip() + " ...(cut; read the row by id)"
        out.append(it)
    return out


def _knowledge_type(status: str) -> str:
    return "quick" if status in VISIBLE else status


def _write(project: str, item: dict, encode) -> None:
    text = item["text"]
    meta = {"scope": "knowledge", "project": project, "topic": TOPIC, "kind": item["kind"],
            "knowledge_type": _knowledge_type(item["status"]),
            "action": item.get("action") or NONE_KEY, "context": item.get("context") or NONE_KEY,
            "entities_json": json.dumps(item.get("entities") or []),
            "entity_key": ",".join(sorted(item.get("entities") or [])) or NONE_KEY,
            "dkey": item["dkey"], "title": item.get("title", ""), "status": item["status"],
            "sources_json": json.dumps(item.get("sources") or []),
            "evidence_count": max(int(item.get("evidence") or item.get("evidence_count") or 0),
                                  len(item.get("sources") or [])),
            "first_seen": item.get("first_seen") or _now(), "last_confirmed": item.get("last_confirmed") or _now(),
            "distilled_by": item.get("distilled_by", ""), "distilled_at": item.get("distilled_at") or _now(),
            "superseded_by": item.get("superseded_by", ""), "origin_project": item.get("origin_project", ""),
            "ts": _now()}
    for k in ("target_action", "target_sub_action", "applied_to", "reject_reason", "tier", "people", "seq"):
        if item.get(k):
            meta[k] = item[k]
    vs.upsert_vt(item["id"], encode(f"{item.get('title', '')}. {text}"), text, meta, _coll(project))


def _set_status(project: str, item_id: str, status: str, encode, **extra) -> dict | None:
    got = vs.get_ids_vt([item_id], collection=_coll(project))
    if not got:
        return None
    old = got[0]
    item = {**item_of(old), **{k: (old.get("metadata") or {}).get(k) for k in
                               ("dkey", "distilled_by", "distilled_at", "target_action", "target_sub_action",
                                "applied_to", "reject_reason", "tier", "people", "seq")}}
    item.update(status=status, **extra)
    _write(project, item, encode)
    return item


# ── the leak gate ───────────────────────────────────────────────────────────

def _names(projects: list[str], types: tuple[str, ...] = ("person", "org")) -> set[str]:
    """Folded names and aliases of every card of these types in these projects."""
    from app import entities
    out = set()
    for card in entities.cards(projects):
        if card.get("type") in types:
            out.update(fold(n) for n in [card.get("name") or "", *card.get("aliases", [])] if len(fold(n)) >= 3)
    return out


def _project_names() -> set[str]:
    from app import projects as kh_projects
    out = set()
    for pid, row in kh_projects.list_projects().items():
        out.add(fold(pid))
        for a in (row or {}).get("aliases", []) if isinstance(row, dict) else []:
            if len(fold(a)) >= 3:
                out.add(fold(a))
    return out


def _pack_leak(text: str) -> str | None:
    """The first finding of the shared redaction pack kh-default (app/caps/redact.py, design 4.11), or None.
    The gate still REFUSES on it (it never masks): the same versioned pack the /v1 write paths mask with."""
    try:
        from app.caps import redact
        found = redact.default_scanner().scan(text)[1]
    except Exception:  # noqa: BLE001 - a broken pack file must not open the gate wider than _ALWAYS
        logger.exception("distill - the kh-default redaction pack could not be loaded")
        return None
    return text[found[0]["start"]:found[0]["end"]] if found else None


def _leak(text: str, names: set[str] = frozenset(), strict: bool = True) -> str | None:
    """The first thing in ``text`` the gate refuses, or None. ``strict`` adds hosts and IPs."""
    for rx in _ALWAYS + (_STRICT if strict else []):
        m = rx.search(text or "")
        if m:
            return m.group(0)
    hit = _pack_leak(text or "")
    if hit:
        return hit
    hay = f" {fold(text)} "
    for n in names:
        if f" {n} " in hay:
            return n
    return None


# ── submit ──────────────────────────────────────────────────────────────────

def _cos(a: list[float], b: list[float]) -> float:
    return float(sum(x * y for x, y in zip(a, b)))


def _cost_of(body: dict) -> float:
    raw = body.get("cost_usd", 0)
    if raw is None:
        return 0.0
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw != raw or not 0 <= raw <= 1000:
        raise HTTPException(400, "cost_usd must be a number between 0 and 1000")
    return float(raw)


def submit(body: dict, encode, actions: set[str], caller: str, lanes: list = (), dry_run: bool = False,
           worker: bool = False) -> dict:
    """Check and store the items of one batch. ``dry_run``: the same verdicts, nothing written, the batch
    released and the cursor left where it is. ``worker``: the caller is the distil worker (distilled_by
    must say ``worker:<model>``)."""
    project = (body.get("project") or "").strip()
    dry_run = bool(dry_run or body.get("dry_run") is True)
    if worker and not str(body.get("distilled_by") or "").strip().startswith("worker:"):
        raise HTTPException(400, "a worker submit needs distilled_by = 'worker:<model>'")
    cost = _cost_of(body)
    batch = _load_batch(body.get("batch_id") or "")
    if batch is None or batch["project"] != project:
        raise HTTPException(409, "unknown or already submitted batch for this project")
    from app.projects import list_projects
    # fen's own projects keep org names, hosts and IPs in their private items (the board, channel and
    # deploy target are the value); other people's projects get the strict gate. Person names are
    # refused everywhere: they belong in the item's entities key, not its text.
    own = project in config.DISTILL_OWN_PROJECTS
    names = _names(list(list_projects()), ("person",) if own else ("person", "org"))
    ctx_tags = {c["tag"] for c in contexts(project)}
    source = (body.get("distilled_by") or caller or "distiller").strip()
    # The distiller may add contexts and signal words with the same call, before its items are read.
    ctx_added = add_contexts(project, body.get("contexts") or [], source, write=not dry_run)
    ctx_tags |= {c["tag"] for c in ctx_added if c["result"] == "added"}
    words_added = add_signal_words(body.get("signal_words") or [], f"{source} ({project})", write=not dry_run)

    # Sources are the logs of this batch, or any earlier log of the project: an item that updates an
    # older one rightly cites the logs it was first learned from.
    valid_sources = set(batch["log_ids"])
    cited = {s for raw in body.get("items") or [] if isinstance(raw, dict)
             for s in raw.get("sources") or [] if isinstance(s, str)} - valid_sources
    for coll, where in (lanes if cited else []):
        valid_sources |= {h["vector_id"] for h in vs.get_ids_vt(sorted(cited), where, collection=coll)}
    results = []
    for n, raw in enumerate(body.get("items") or []):
        res = _submit_one(project, raw, n, encode, actions, ctx_tags, valid_sources, names, source, not own,
                          dry_run)
        results.append(res)

    batch_id = body["batch_id"]
    _add_cost(batch_id, cost)
    if dry_run:
        # Release: an unclaimed batch is dropped (kept closed when it carries a cost), so the next
        # /distill/next serves the same logs; a claimed batch open for a retry stays open.
        if not _is_claimed(batch_id):
            _close_batch(batch_id)
        return {"project": project, "dry_run": True, "results": results, "contexts": ctx_added,
                "signal_words": words_added, "confirmed_in_code": 0, "cursor": cursor(project)["last_ts"],
                "batch_open": _load_batch(batch_id) is not None, "cost_usd": batch_cost(batch_id)}

    state = batch["state"]
    confirmed = 0
    if _claim_batch(batch_id) and not state.get("submitted"):
        _save_cursor(project, {"last_ts": state["last_ts"], "last_ids": state["last_ids"],
                               "signal_ids": state["signal_ids"], "topics": state["topics"]})
        _count_hits(state.get("hits") or {})
        confirmed = _apply_confirms(project, state.get("confirms") or {}, encode)
    # A batch with refused items stays open so the distiller can fix and resend them (same batch_id);
    # the cursor moved on the first submit and does not move again.
    retry = any(r["result"] == "rejected" for r in results)
    if retry:
        _update_batch(batch_id, {**state, "submitted": True})
    else:
        _close_batch(batch_id)
    return {"project": project, "dry_run": False, "results": results, "contexts": ctx_added,
            "signal_words": words_added, "confirmed_in_code": confirmed, "cursor": cursor(project)["last_ts"],
            "batch_open": retry, "cost_usd": batch_cost(batch_id)}


def _submit_one(project, raw, n, encode, actions, ctx_tags, valid_sources, names, source, strict,
                dry_run: bool = False) -> dict:
    """One item's verdict. ``dry_run``: the same verdict (and the id it would get), nothing written."""
    def refuse(reason):
        return {"n": n, "result": "rejected", "reason": reason}

    if not isinstance(raw, dict):
        return refuse("an item must be an object")
    kind = (raw.get("kind") or "").strip()
    if kind not in SUBMITTED_KINDS:
        return refuse(f"kind must be one of {', '.join(SUBMITTED_KINDS)}")
    action = (raw.get("action") or NONE_KEY).strip()
    if action != NONE_KEY and action not in actions:
        return refuse(f"unknown action '{action}'")
    context = fold(raw.get("context") or "").replace(" ", "-") or NONE_KEY
    if raw.get("context", "").startswith("ent__"):
        context = raw["context"].strip()
    elif context != NONE_KEY and context not in ctx_tags:
        return refuse(f"unknown context '{context}' (add it under contexts first)")
    title = (raw.get("title") or "").strip()
    text = (raw.get("text") or "").strip()
    if not title or len(title) > config.DISTILL_TITLE_CHARS:
        return refuse(f"title is required, at most {config.DISTILL_TITLE_CHARS} characters")
    if not text or len(text) > config.DISTILL_ITEM_CHARS:
        return refuse(f"text is required, at most {config.DISTILL_ITEM_CHARS} characters")
    sources = [s for s in dict.fromkeys(raw.get("sources") or []) if isinstance(s, str)]
    if not sources or any(s not in valid_sources for s in sources):
        return refuse("sources must be ids of this project's logs")
    leak = _leak(f"{title}\n{text}", names, strict)
    if leak:
        return refuse(f"leak gate: '{leak}'")
    entities = sorted({str(e).strip() for e in raw.get("entities") or [] if str(e).strip().startswith("ent__")})
    extra = {}
    if kind == "policy_proposal":
        ta, tsa = (raw.get("target_action") or "").strip(), (raw.get("target_sub_action") or "").strip()
        if ta not in actions or not tsa:
            return refuse("a policy proposal needs a known target_action and a target_sub_action")
        extra = {"target_action": ta, "target_sub_action": tsa}

    key = dkey(project, kind, action, context, ",".join(entities))
    vec = encode(f"{title}. {text}")
    now = _now()
    new = {"kind": kind, "action": action, "context": context, "entities": entities, "title": title,
           "text": text, "sources": sources, "dkey": key, "distilled_by": source, "distilled_at": now,
           "first_seen": now, "last_confirmed": now, **extra}

    live_states = ("proposed", "active", "contested")
    # The distiller sees the project's live items (neighbours) and says how a new item relates to one:
    # 'updates' (same item, newer or fuller wording) or 'contradicts' (same subject, other claim).
    # Measured on the first prod run (2026-10-09): cosine cannot tell these apart - a dev-deploy and a
    # prod-release procedure scored as close as a real contradiction.
    target_id = (raw.get("updates") or raw.get("contradicts") or "").strip()
    target = None
    if target_id:
        got = vs.get_ids_vt([target_id], collection=_coll(project))
        target = item_of(got[0]) if got else None
        if target is None or target["status"] not in live_states:
            return refuse(f"'{target_id}' is not a live item of this project")
    same = target if raw.get("updates") else None
    if same is None and target is None:
        # Without a stated relation, only a near-identical copy (any key, same kind) is the same item.
        pool = items(project, live_states, {"kind": {"$eq": kind}})
        same = _closest(pool, vec, encode)
    if same is not None:
        fresh = [s for s in sources if s not in same["sources"]]
        merged = {**same, **({k: new[k] for k in ("kind", "action", "context", "entities")} if raw.get("updates") else {}),
                  "dkey": _meta_of(project, same["id"]).get("dkey") or key, "title": title, "text": text,
                  "sources": list(dict.fromkeys(same["sources"] + sources))[-50:], "last_confirmed": now,
                  "evidence": int(same.get("evidence_count") or 0) + len(fresh),
                  "distilled_by": source, "distilled_at": now, **extra}
        if not dry_run:
            _write(project, merged, encode)
        return {"n": n, "result": "updated" if raw.get("updates") else "merged", "id": same["id"]}
    # One key holds many items (two unrelated lessons about the same tool and action).
    taken = {i["id"] for i in items(project, None, {"dkey": {"$eq": key}})}
    new_id = key if key not in taken else f"{key}_{len(taken) + 1}"
    if target is not None:
        if not dry_run:
            if target["status"] != "contested":
                _set_status(project, target["id"], "contested", encode)
            _write(project, {**new, "id": new_id, "status": "contested"}, encode)
        return {"n": n, "result": "contested", "id": new_id, "with": [target["id"]]}
    if not dry_run:
        _write(project, {**new, "id": new_id, "status": "proposed"}, encode)
    return {"n": n, "result": "accepted", "id": new_id}


def _meta_of(project: str, item_id: str) -> dict:
    got = vs.get_ids_vt([item_id], collection=_coll(project))
    return (got[0].get("metadata") or {}) if got else {}


def _closest(pool: list[dict], vec, encode) -> dict | None:
    best, best_score = None, config.DISTILL_SAME
    for it in pool:
        score = _cos(vec, encode(f"{it['title']}. {it['text']}"))
        if score >= best_score:
            best, best_score = it, score
    return best


# ── review ──────────────────────────────────────────────────────────────────

def approve(project: str, ids: list[str], share: list[str], encode) -> list[dict]:
    from app.policy_actions import store as policy_store
    out = []
    from app.projects import list_projects
    shared_names = _names(list(list_projects()), ("person", "org")) | _project_names()
    for item_id in ids or []:
        got = vs.get_ids_vt([item_id], collection=_coll(project))
        if not got:
            out.append({"id": item_id, "result": "unknown"})
            continue
        meta = got[0].get("metadata") or {}
        item = item_of(got[0])
        if item["status"] not in ("proposed", "contested"):
            out.append({"id": item_id, "result": f"not pending ({item['status']})"})
            continue
        if item["kind"] == "policy_proposal":
            try:
                if meta.get("tier") == "common":
                    # A promotion (app/promote.py): rewrites one step of the common tier, for every user.
                    policy_store.set_rule(meta["target_action"], meta["target_sub_action"], item["text"],
                                          seq=int(meta.get("seq") or 99), project=policy_store.EVERY)
                else:
                    policy_store.set_rule(meta["target_action"], meta["target_sub_action"], item["text"],
                                          project=project)
            except KeyError:
                out.append({"id": item_id, "result": "refused", "reason": "target action unknown in this project"})
                continue
            _set_status(project, item_id, "superseded", encode,
                        applied_to=f"{meta['target_action']} / {meta['target_sub_action']}")
            out.append({"id": item_id, "result": "applied as policy rule"})
            continue
        _set_status(project, item_id, "active", encode)
        # The contested siblings under the same key lose to the one approved.
        for other in items(project, ("contested",), {"dkey": {"$eq": meta.get("dkey")}}):
            if other["id"] != item_id:
                _set_status(project, other["id"], "superseded", encode, superseded_by=item_id)
        line = {"id": item_id, "result": "active"}
        if item_id in (share or []):
            line["shared"] = _share(project, item, meta, shared_names, encode)
        out.append(line)
    return out


def _share(project: str, item: dict, meta: dict, names: set[str], encode) -> str:
    target = config.DISTILL_SHARED_PROJECT
    if not target or target == project:
        return "no shared project"
    leak = _leak(f"{item['title']}\n{item['text']}", names)
    if leak:
        return f"refused: not general ('{leak}')"
    context = item["context"] if not (item["context"] or "").startswith("ent__") else NONE_KEY
    key = dkey(target, item["kind"], item["action"], context, NONE_KEY)
    # Like a submit: a near-identical shared item is the same item (a re-share or a reword); otherwise one key
    # holds many items. Before 2026-10-24 every share under one key overwrote the last (19 of one project's
    # lessons left a single row).
    vec = encode(f"{item['title']}. {item['text']}")
    same = _closest(items(target, ("proposed", "active", "contested"), {"kind": {"$eq": item["kind"]}}), vec, encode)
    if same is not None:
        new_id, key = same["id"], _meta_of(target, same["id"]).get("dkey") or key
    else:
        taken = {i["id"] for i in items(target, None, {"dkey": {"$eq": key}})}
        new_id, n = key, len(taken) + 1
        while new_id in taken:
            new_id, n = f"{key}_{n}", n + 1
    _write(target, {**item, "id": new_id, "dkey": key, "context": context, "entities": [], "status": "active",
                    "origin_project": project, "distilled_by": meta.get("distilled_by", ""),
                    "distilled_at": meta.get("distilled_at")}, encode)
    return new_id


def reject(project: str, ids: list[str], reason: str, encode) -> list[dict]:
    out = []
    for item_id in ids or []:
        got = _set_status(project, item_id, "withdrawn", encode, reject_reason=(reason or "")[:500])
        out.append({"id": item_id, "result": "withdrawn" if got else "unknown"})
    return out


# ── the distil worker (roadmap E, slice S5) ─────────────────────────────────

def is_worker(principal) -> bool:
    """True for the kh_people distiller principal (the scheduled worker)."""
    from app.caps import people
    return principal is not None and people.is_worker(principal)


@contextmanager
def as_worker_system():
    """Run a worker route's body as KH itself. The worker token holds no project grant: it passed its
    auth rule (people.py) and the consent gate, and it is THE distiller, so the reads behind the route
    (the log lanes, the person cards the leak gate refuses) must see what a maintainer's call sees -
    a narrower view would weaken the leak gate, not strengthen it."""
    from app import auth
    token = auth._current.set(None)
    try:
        yield
    finally:
        auth._current.reset(token)


@contextmanager
def _same():
    yield


def worker_forced_dry() -> bool:
    """KH_DISTILL_WORKER=dry: every worker submit is a dry run, whatever its body says."""
    from app.caps import people
    return people.worker_mode() != "on"


def month_spend_usd(now: datetime | None = None) -> float:
    """The calendar month's (UTC) worker.cost_usd total in kh_people, the one-off backfill left out (design E4: it
    has its own cap and must not eat the month budget; the worker counts the same way, dims.kind = backfill)."""
    from app.caps import metrics, people
    now = now or datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    out = metrics.aggregate(people.system_ctx(), "worker.cost_usd", "dims.kind", "", int(start.timestamp() * 1000),
                            None, "", "")
    return float(sum(g.get("sum") or 0.0 for g in out["groups"] if (g.get("key") or {}).get("dims.kind") != "backfill"))


def budget_refusal() -> dict | None:
    """None while the worker may take work; else the 429 body (also for /daily/next). Fails closed: a
    month spend that cannot be read refuses."""
    cap = float(config.WORKER_CAP_MONTH_USD)
    try:
        spent = month_spend_usd()
    except Exception:  # noqa: BLE001 - a cost cap that cannot be read must not let spend through
        logger.exception("distill - the worker's month spend could not be read")
        return {"error": "budget", "detail": "the worker's month spend could not be read", "cap_usd": cap}
    if spent >= cap:
        return {"error": "budget", "detail": "the worker's month spend reached KH_WORKER_CAP_MONTH_USD",
                "month_usd": round(spent, 4), "cap_usd": cap}
    return None


# ── endpoints ───────────────────────────────────────────────────────────────

# -- rekey: keys for knowledge written before distilling (slice 3) -------------

def rekey_batch(project: str, limit: int) -> dict:
    """Knowledge rows of a project that have no keys yet, by id (the shared lessons, older guides).

    Distilled items are left out (they are keyed at submit) and so are chunk sidecars.
    """
    if vs.part_collection_name("knowledge", project) not in vs.existing_collection_names():
        return {"project": project, "rows": [], "remaining_after": 0, "done": True}
    hits = vs.scroll_vt({"knowledge_type": {"$eq": "quick"}}, 100000, 0, collection=_coll(project))["hits"]
    todo = sorted((h for h in hits if not (h.get("metadata") or {}).get("action")
                   and (h.get("metadata") or {}).get("topic") != TOPIC
                   and not (h.get("metadata") or {}).get(PARENT_KEY)), key=lambda h: h["vector_id"])
    rows = [{"id": h["vector_id"], "kind": (h.get("metadata") or {}).get("kind", ""),
             "topic": (h.get("metadata") or {}).get("topic", ""),
             "text": (h.get("source_text") or "")[:config.DISTILL_LOG_CHARS]} for h in todo[:limit]]
    return {"project": project, "rows": rows, "remaining_after": max(0, len(todo) - len(rows)), "done": not todo}


def rekey(project: str, keys: list, actions: set[str], caller: str) -> list[dict]:
    """Write action / context / entities on existing knowledge rows; text, kind and embedding unchanged.

    ``{"id", "skip": true}`` marks a row that fits no key: it is not offered again and not served.
    """
    ctx_tags = {c["tag"] for c in contexts(project)}
    ids = [k.get("id") for k in keys or [] if isinstance(k, dict) and k.get("id")]
    coll = _coll(project)
    rows = {h["vector_id"]: h for h in vs.get_ids_vt(ids, collection=coll)} if ids else {}
    out = []
    for n, k in enumerate(keys or []):
        rid = k.get("id") if isinstance(k, dict) else None

        def refuse(reason):
            return {"n": n, "id": rid, "result": "rejected", "reason": reason}

        row = rows.get(rid) if rid else None
        if not rid:
            out.append(refuse("each entry needs an id"))
            continue
        if row is None:
            out.append(refuse("no such row in this project's knowledge"))
            continue
        meta = dict(row.get("metadata") or {})
        if meta.get("topic") == TOPIC:
            out.append(refuse("a distilled item: change it through submit with 'updates'"))
            continue
        stamp = {"rekeyed_by": caller[:256], "rekeyed_at": _now()}
        if k.get("skip"):
            new, result = {"action": NONE_KEY, "context": NONE_KEY, **stamp}, "skipped"
        else:
            action = (k.get("action") or NONE_KEY).strip()
            raw_ctx = (k.get("context") or "").strip()
            context = raw_ctx if raw_ctx.startswith("ent__") else fold(raw_ctx).replace(" ", "-") or NONE_KEY
            ents = [e for e in (k.get("entities") or []) if isinstance(e, str) and e.startswith("ent__")]
            if action != NONE_KEY and action not in actions:
                out.append(refuse(f"unknown action '{action}'"))
                continue
            if context != NONE_KEY and not context.startswith("ent__") and context not in ctx_tags:
                out.append(refuse(f"unknown context '{context}' (add it under contexts first)"))
                continue
            if action == NONE_KEY and context == NONE_KEY:
                out.append(refuse("give an action or a context, or set skip"))
                continue
            new = {"action": action, "context": context, "entities_json": json.dumps(ents),
                   "entity_key": ",".join(sorted(ents)) or NONE_KEY, "status": "active",
                   "first_seen": meta.get("first_seen") or meta.get("ts") or _now(), "last_confirmed": _now(),
                   **stamp}
            result = "keyed"
        coll.update(ids=[rid], metadatas=[{**meta, **new}])
        out.append({"n": n, "id": rid, "result": result})
    return out


# -- patterns: counted in code, never by the model ---------------------------

def patterns(projects: list[str], log_lanes, days: int) -> list[dict]:
    """Per project: logs in the window, how many hold a failure word, and the topics that fail most."""
    from app import hotlog
    cutoff = datetime.now(timezone.utc).timestamp() - days * 86400
    fail = [w["word"] for w in signal_words() if w["kind"] == "failure"]
    out = []
    for project in projects:
        per_topic: dict[str, list[int]] = {}
        seen: set[str] = set()
        for coll, where in log_lanes(project):
            ids = [vid for vid, ts in vs.field_values_vt("ts", where, collection=coll)
                   if vid not in seen and ts is not None and hotlog.parse_ts(ts) >= cutoff]
            seen.update(ids)
            for start in range(0, len(ids), 200):
                for h in vs.get_ids_vt(ids[start:start + 200], where, collection=coll):
                    c = per_topic.setdefault((h.get("metadata") or {}).get("topic") or NONE_KEY, [0, 0])
                    c[0] += 1
                    c[1] += bool(signals_in(h.get("source_text") or "", fail))
        logs = sum(c[0] for c in per_topic.values())
        failing = sum(c[1] for c in per_topic.values())
        top = sorted(((t, c) for t, c in per_topic.items() if c[1]), key=lambda x: (-x[1][1], x[0]))[:5]
        out.append({"project": project, "logs": logs, "with_failure": failing,
                    "failure_rate": round(failing / logs, 3) if logs else 0.0,
                    "top_failing_topics": [{"topic": t, "logs": c[0], "with_failure": c[1]} for t, c in top]})
    out.sort(key=lambda r: (-r["failure_rate"], r["project"]))
    return out


LOG_LANES = None          # set by attach(): log_lanes(project) -> the (collection, where) pairs of its log


def serve_next(project: str, limit: int, encode, lanes: list | None = None) -> dict:
    """What GET /distill/next answers, also for a caller inside KH (app/learnback.py, 2026-10-13), which
    may pass more ``lanes`` than the project's log (its findings too)."""
    from app.entities import cards
    from app.policy_actions import store as policy_store
    out = next_batch(project, lanes if lanes is not None else LOG_LANES(project), limit, encode)
    live = items(project, VISIBLE + ("proposed",))
    neighbours, used = [], 0
    for it in sorted(live, key=lambda i: i.get("last_confirmed") or "", reverse=True):
        line = line_of(it)
        if used + len(line) > config.DISTILL_NEIGHBOUR_CHARS:
            break
        neighbours.append(line)
        used += len(line)
    people = [{"id": c["id"], "name": c["name"], "aliases": c.get("aliases", []), "role": c.get("role", "")}
              for c in cards([project]) if c.get("type") == "person"]
    out.update(neighbours=neighbours, people=people,
               catalog={"kinds": list(SUBMITTED_KINDS),
                        "actions": [a["action"] for a in policy_store.menu(project)],
                        "contexts": contexts(project)},
               rules=("One item per lesson, fact, procedure, habit or policy proposal; title <= "
                      f"{config.DISTILL_TITLE_CHARS} chars, text <= {config.DISTILL_ITEM_CHARS}; English; "
                      "people as role aliases (Dev, PO, reviewer), never names or e-mails (put the "
                      "person's card id in 'entities'); no secrets; sources = ids of this project's "
                      "logs; a how-to-work rule is a policy_proposal with target_action and "
                      "target_sub_action. When an item improves a neighbour, set 'updates': <its id>; "
                      "when it says the opposite of one, set 'contradicts': <its id>. Add a context under "
                      "'contexts' before using it, and words that should have flagged a log under "
                      "'signal_words'. Submit even an empty item list: it moves the cursor."))
    return out


def attach(app, log_lanes) -> None:
    """``log_lanes(project)`` returns the (collection, where) pairs of a project's whole log.

    The routes are plain ``def``: FastAPI runs them in its thread pool (contextvars, so the caller,
    are copied). A submit encodes and writes for seconds; run on the event loop it blocked /health
    long enough for Cloud Foundry to restart the app (prod, 2026-10-09).
    """
    from app import auth
    from app.entities import cards
    from app.policy_actions import store as policy_store

    global LOG_LANES
    LOG_LANES = log_lanes
    TAG = ["Distil"]
    init()

    def _encoder(request: Request):
        model = request.app.state.model
        return lambda t: model.encode(t, normalize_embeddings=True).tolist()

    def _caller() -> str:
        principal = auth.current()
        return principal.email if principal is not None else "local"

    def _need(project: str) -> None:
        if not project:
            raise HTTPException(400, "project is required")
        if not consented(project):
            raise HTTPException(403, f"project '{project}' is not in KH_DISTILL_PROJECTS (no consent to distil)")

    @app.get("/distill/next", tags=TAG, summary="The next batch of unread logs with signal for one project")
    def distill_next(request: Request, project: str,
                           limit: int = Query(config.DISTILL_BATCH, ge=1, le=100)) -> dict:
        _need(project)
        if is_worker(auth.current()):
            refusal = budget_refusal()
            if refusal:
                raise HTTPException(429, refusal)
            with as_worker_system():
                return _next(request, project, limit)
        return _next(request, project, limit)

    def _next(request: Request, project: str, limit: int) -> dict:
        return serve_next(project, limit, _encoder(request))

    @app.post("/distill/submit", tags=TAG, summary="Hand back the items distilled from one batch")
    def distill_submit(body: dict, request: Request) -> dict:
        project = (body.get("project") or "").strip()
        _need(project)
        actions = {a["action"] for a in policy_store.menu(project)}
        caller = _caller()
        worker = is_worker(auth.current())
        forced = worker and worker_forced_dry()
        with as_worker_system() if worker else _same():
            out = submit(body, _encoder(request), actions, caller, log_lanes(project),
                         dry_run=forced or body.get("dry_run") is True, worker=worker)
        if forced:
            out["forced_dry"] = "KH_DISTILL_WORKER=dry"
        return out

    @app.get("/distill/pending", tags=TAG, summary="Proposed and contested items, one line each")
    def distill_pending(project: str) -> dict:
        rows = sorted(items(project, ("proposed", "contested")), key=lambda i: i.get("distilled_at") or "",
                      reverse=True)
        return {"project": project, "count": len(rows), "lines": [line_of(i, with_sources=True) for i in rows]}

    @app.post("/distill/approve", tags=TAG, summary="Approve items; share some; apply policy proposals")
    def distill_approve(body: dict, request: Request) -> dict:
        project = (body.get("project") or "").strip()
        if not project:
            raise HTTPException(400, "project is required")
        return {"results": approve(project, body.get("ids") or [], body.get("share") or [], _encoder(request))}

    @app.post("/distill/reject", tags=TAG, summary="Withdraw items, with a reason")
    def distill_reject(body: dict, request: Request) -> dict:
        project = (body.get("project") or "").strip()
        if not project:
            raise HTTPException(400, "project is required")
        return {"results": reject(project, body.get("ids") or [], body.get("reason") or "", _encoder(request))}

    @app.post("/distill/reopen", tags=TAG, summary="Put items back to proposed (a wrong contest or approval)")
    def distill_reopen(body: dict, request: Request) -> dict:
        project = (body.get("project") or "").strip()
        if not project:
            raise HTTPException(400, "project is required")
        enc = _encoder(request)
        out = []
        for item_id in body.get("ids") or []:
            got = _set_status(project, item_id, "proposed", enc, superseded_by="")
            out.append({"id": item_id, "result": "proposed" if got else "unknown"})
        return {"results": out}

    @app.get("/distill/rekey", tags=TAG, summary="Knowledge rows without keys yet (older lessons), to key")
    def distill_rekey_next(project: str, limit: int = Query(config.DISTILL_BATCH, ge=1, le=100)) -> dict:
        # Rekey reads knowledge only, never logs, so it needs no distil consent: maintainer only.
        out = rekey_batch(project, limit)
        out["catalog"] = {"actions": [a["action"] for a in policy_store.menu(project)],
                          "contexts": contexts(project)}
        out["rules"] = ("For each row give {id, action, context, entities} from the catalog (an entity id may "
                        "stand as the context), or {id, skip: true} when no key fits. The text is not "
                        "changed, so no review is needed. Add a context under 'contexts' before using it.")
        return out

    @app.post("/distill/rekey", tags=TAG, summary="Write keys on existing knowledge rows (text unchanged)")
    def distill_rekey(body: dict) -> dict:
        project = (body.get("project") or "").strip()
        if not project:
            raise HTTPException(400, "project is required")
        added = add_contexts(project, body.get("contexts") or [], _caller())
        actions = {a["action"] for a in policy_store.menu(project)}
        return {"project": project, "contexts": added,
                "results": rekey(project, body.get("keys") or [], actions, _caller())}

    @app.get("/distill/patterns", tags=TAG, summary="Failure counts per project and topic, counted in code")
    def distill_patterns(project: str | None = None, days: int = Query(90, ge=1, le=730)) -> dict:
        pids = [project] if project else list(config.DISTILL_PROJECTS)
        for pid in pids:
            _need(pid)
        return {"days": days, "projects": patterns(pids, log_lanes, days)}

    @app.get("/distill/signals", tags=TAG, summary="The signal word list, with how often each word fired")
    def distill_signals() -> dict:
        rows = signal_words()
        return {"count": len(rows), "words": rows}

    @app.post("/distill/signals", tags=TAG, summary="Add or remove signal words by hand")
    def distill_signals_set(body: dict) -> dict:
        added = add_signal_words(body.get("add") or [], _caller())
        removed = remove_signal_words(body.get("remove") or [])
        return {"added": added, "removed": removed}

    @app.get("/distill/cursor", tags=TAG, summary="Where distilling stands for one project")
    def distill_cursor(project: str) -> dict:
        cur = cursor(project)
        return {"project": project, "consented": consented(project), "last_ts": cur["last_ts"],
                "topics": len(cur["topics"]), "contexts": contexts(project)}

    @app.post("/distill/cursor/reset", tags=TAG, summary="Start a project's distilling over from its first log")
    def distill_cursor_reset(body: dict) -> dict:
        project = (body.get("project") or "").strip()
        _need(project)
        reset_cursor(project)
        return {"project": project, "reset": True}

    logger.info("Distil routes attached (/distill/next, submit, pending, approve, reject, rekey, patterns, "
                "signals, cursor)")
