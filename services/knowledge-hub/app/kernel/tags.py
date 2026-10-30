"""Kernel tag taxonomy: the fixed vocabulary every kernel rule is tagged from (fen 2026-10-29).

WHY. Kernel rules used to be free text, so overlap between a person's rule and a common one was left
to the model reading both. With every rule tagged from ONE vocabulary, KH decides overlap and the
personal-over-common priority in code (app/kernel/rules.py), and the model only reads the result.

THE VOCABULARY. Facets (kh, lang, action, object, domain, comm, risk, moment, place, cli, people), each
a list of tags with a description and aliases. Seeded from seeds/kernel_tags.seed.json into table
kernel_tag; it grows by POST /kernel/tags/propose (status proposed) and a maintainer's approve. Only
active tags may be put on a rule, so two people can never spell the same idea two ways.

SUGGESTING. suggest(text) ranks tags for a text by aliases, tag words and description words. It is a
lexical ranker on purpose: deterministic, no model, the same answer on every instance. The model picks
from it; rules.validate() refuses a tag that is not in the table.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any

from app import sqldb

TABLE = "kernel_tag"
SEED = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    "seeds", "kernel_tags.seed.json")
TAG_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
# Facets that say WHEN or WHERE a rule applies, not WHAT it is about: they do not make two rules the same.
GENERIC_FACETS = ("moment", "cli")
STATUSES = ("active", "proposed", "retired")

_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {"at": 0.0, "rows": None}
_STOP = frozenset(
    "a an and are as at be by do does for from has have in is it its kh of on or that the this to was with "
    "when what which who each every any one no not never only their them they you your its into than then "
    "else there here also just".split())
_WORD = re.compile(r"[a-z0-9_]+")


def init() -> None:
    with _LOCK, sqldb.connect() as c:
        sqldb.create_table(
            c, TABLE,
            f"""CREATE TABLE IF NOT EXISTS {TABLE} (
                tag TEXT PRIMARY KEY, facet TEXT NOT NULL, description TEXT NOT NULL,
                aliases TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
                added_by TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL)""",
            f"""CREATE COLUMN TABLE {TABLE} (
                tag NVARCHAR(48) PRIMARY KEY, facet NVARCHAR(32) NOT NULL, description NVARCHAR(500) NOT NULL,
                aliases NVARCHAR(2000) NOT NULL DEFAULT '[]', status NVARCHAR(16) NOT NULL DEFAULT 'active',
                added_by NVARCHAR(256) NOT NULL DEFAULT '', added_at NVARCHAR(32) NOT NULL)""",
        )
        sqldb.create_index(c, "ix_kernel_tag_facet", TABLE, "facet, status")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def seed(path: str = SEED, by: str = "seed") -> dict:
    """Load the seed file; an existing tag keeps its status (a retired one stays retired)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    seen: dict[str, str] = {}
    added = 0
    with _LOCK, sqldb.connect() as c:
        have = {r["tag"]: r["status"] for r in c.execute(f"SELECT tag, status FROM {TABLE}").fetchall()}
        for facet, spec in data["facets"].items():
            for tag, desc, aliases in spec["tags"]:
                if not TAG_RE.match(tag):
                    raise ValueError(f"bad tag id {tag!r}")
                if tag in seen:
                    raise ValueError(f"tag {tag!r} in two facets ({seen[tag]}, {facet})")
                seen[tag] = facet
                sqldb.upsert(c, TABLE, ("tag",), {
                    "tag": tag, "facet": facet, "description": desc,
                    "aliases": json.dumps([a.strip() for a in aliases.split(",") if a.strip()]),
                    "status": have.get(tag, "active"), "added_by": by, "added_at": _now()})
                added += tag not in have
    _CACHE["rows"] = None
    return {"tags": len(seen), "added": added, "facets": len(data["facets"])}


def all_tags(include: tuple[str, ...] = ("active",)) -> list[dict]:
    if _CACHE["rows"] is None or time.monotonic() - _CACHE["at"] > 30:
        with sqldb.connect() as c:
            rows = [dict(r) for r in c.execute(f"SELECT * FROM {TABLE} ORDER BY facet, tag").fetchall()]
        for r in rows:
            r["aliases"] = json.loads(r.get("aliases") or "[]")
        _CACHE.update(rows=rows, at=time.monotonic())
    return [r for r in _CACHE["rows"] if r["status"] in include]


def by_tag(include: tuple[str, ...] = STATUSES) -> dict[str, dict]:
    return {r["tag"]: r for r in all_tags(include)}


def facets() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for r in all_tags():
        out.setdefault(r["facet"], []).append(r["tag"])
    return out


def propose(tag: str, facet: str, description: str, aliases: list[str] | None, by: str) -> dict:
    tag = (tag or "").strip().lower()
    if not TAG_RE.match(tag):
        raise ValueError("tag: lowercase letters, digits and _, 2-48 chars, starting with a letter")
    if facet not in facets():
        raise ValueError(f"facet must be one of {sorted(facets())}")
    if not (description or "").strip():
        raise ValueError("description required")
    known = by_tag()
    if tag in known:
        raise ValueError(f"tag {tag!r} exists ({known[tag]['status']})")
    near = suggest(description + " " + " ".join(aliases or []), limit=5)
    with _LOCK, sqldb.connect() as c:
        sqldb.upsert(c, TABLE, ("tag",), {
            "tag": tag, "facet": facet, "description": description.strip()[:500],
            "aliases": json.dumps([a.strip() for a in (aliases or []) if a.strip()][:20]),
            "status": "proposed", "added_by": by, "added_at": _now()})
    _CACHE["rows"] = None
    return {"tag": tag, "status": "proposed", "similar_existing": near}


def set_status(tag: str, status: str) -> int:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    with _LOCK, sqldb.connect() as c:
        n = c.execute(f"UPDATE {TABLE} SET status=? WHERE tag=?", (status, tag)).rowcount
    _CACHE["rows"] = None
    return n


# ── suggest ──────────────────────────────────────────────────────────────────

def _stem(w: str) -> str:
    for end in ("ing", "ies", "es", "ed", "s"):
        if len(w) > len(end) + 3 and w.endswith(end):
            return w[: -len(end)] + ("y" if end == "ies" else "")
    return w


def _stemmed(text: str) -> str:
    return " ".join(_stem(w) for w in _WORD.findall((text or "").lower()))


def words(text: str) -> set[str]:
    return {_stem(w) for w in _WORD.findall((text or "").lower()) if w not in _STOP and len(w) > 1}


def suggest(text: str, limit: int = 20, facet: str | None = None, floor: float = 1.5) -> list[dict]:
    """Tags for a text, best first: [{tag, facet, score, why}]."""
    low = " " + " ".join((text or "").lower().split()) + " "
    stemmed = " " + _stemmed(text) + " "
    toks = words(text)
    out = []
    for r in all_tags():
        if facet and r["facet"] != facet:
            continue
        score, why = 0.0, []
        for a in r["aliases"]:
            a = a.lower().strip()
            if " " in a or not a.isalnum():
                # a phrase: as written ("c:\rwtemp", "1-2 lines"), or word by word stemmed ("signed in" = "sign in")
                if a and (a in low or (" " in a and " " + _stemmed(a) + " " in stemmed)):
                    score += 3.0
                    why.append(a)
            elif _stem(a) in toks:
                score += 1.5
                why.append(a)
        # The tag's own words count, except in facet kh: there 'kh' is a stop word, so kh_log would fire on
        # every 'log' and kh_auth on every 'auth'; a kh tag is found by its aliases only.
        parts = [] if r["facet"] == "kh" else [p for p in r["tag"].split("_") if p not in _STOP and len(p) > 1]
        hit = [p for p in parts if _stem(p) in toks]
        if hit and len(hit) == len(parts):
            score += 2.0
            why.append(r["tag"])
        score += 0.3 * len(words(r["description"]) & toks)
        if score >= floor:
            out.append({"tag": r["tag"], "facet": r["facet"], "score": round(min(score, 12.0), 2),
                        "why": why[:4]})
    out.sort(key=lambda x: (-x["score"], x["tag"]))
    return out[:limit]
