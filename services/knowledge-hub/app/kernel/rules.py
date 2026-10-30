"""Tagged kernel rules: one row per rule, per tier, resolved in code (fen 2026-10-29).

THE ROW. kernel_rule(id, tier, slot, title, content, tags, position, locked, enabled, ...).
  tier   'common' (every user), a project id, or a personal project id (personal-<slug>).
  slot   the rule's identity. A rule in a more specific tier with the same slot REPLACES the common one;
         a rule that says something new gets a fresh slot (sl_<hex>).
  tags   2..12 active tags of app/kernel/tags.py.
  locked a common rule nobody may replace (kernel rule 10: rule 0, a 403, never typing a secret).
  guard  optional JSON {tool, decision, when}: the rule is also enforced right before that tool runs
         (GET /personalization/guards, read by the helper's PreToolUse hook). It resolves with its rule, so a
         guard has the same tiers, overrides and locks as the text (fen 2026-10-30, replaces guard_tool on
         personalization rows).

THE CONTRACT FOR ADDING (check() and add(), POST /kernel/rules/check|add). The model may not write a
rule free-form any more:
  1. tags are required and must all be active tags of the vocabulary (a near miss is refused with the
     closest tags; a missing idea is proposed with POST /kernel/tags/propose);
  2. a personal or project rule is compared with the common rules (tags, then words). Past SAME_SCORE it
     is refused as KERNEL-SAME-AS-COMMON unless the body says what it is:
       overrides=<slot>              it replaces that rule; its tags are set to the common rule's own tags
       distinct_from=[slots]+reason  it is a different rule after all
  3. a locked slot cannot be overridden (KERNEL-LOCKED).
  4. slot=<a slot of the same tier> edits that rule in place (id kept; an override stays an override); a slot
     the tier does not have is refused (KERNEL-NO-SLOT), so an edit never forks a second copy.

RESOLVING (resolve(), GET /kernel/render). common < project < personal, per slot, in code. The CLI hook
gets ONE text that is already merged, so no model has to read two places and work out who wins.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any

from app import sqldb
from app.kernel import tags as T

TABLE = "kernel_rule"
COMMON = "common"
MIN_TAGS, MAX_TAGS = 2, 12
SAME_SCORE = 0.35          # tag overlap + word overlap at which a rule counts as the same as a common one
CONTENT_MAX = 1500
TIER_RANK = {"common": 0, "project": 1, "personal": 2}

_LOCK = threading.Lock()


class RuleRefused(Exception):
    """A rule that breaks the contract: code (KERNEL-...), HTTP status and the details to fix it."""

    def __init__(self, status: int, code: str, detail: str, **extra: Any):
        super().__init__(detail)
        self.status, self.code, self.detail, self.extra = status, code, detail, extra

    def body(self) -> dict:
        return {"error": self.code, "detail": self.detail, **self.extra}


def init() -> None:
    with _LOCK, sqldb.connect() as c:
        sqldb.create_table(
            c, TABLE,
            f"""CREATE TABLE IF NOT EXISTS {TABLE} (
                id TEXT PRIMARY KEY, tier TEXT NOT NULL, slot TEXT NOT NULL, title TEXT NOT NULL,
                content TEXT NOT NULL, tags TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
                locked INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
                overrides TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
                updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
                UNIQUE(tier, slot))""",
            f"""CREATE COLUMN TABLE {TABLE} (
                id NVARCHAR(40) PRIMARY KEY, tier NVARCHAR(256) NOT NULL, slot NVARCHAR(64) NOT NULL,
                title NVARCHAR(200) NOT NULL, content NCLOB NOT NULL, tags NVARCHAR(1000) NOT NULL,
                position INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1, overrides NVARCHAR(64) NOT NULL DEFAULT '',
                reason NVARCHAR(500) NOT NULL DEFAULT '', updated_by NVARCHAR(256) NOT NULL DEFAULT '',
                updated_at NVARCHAR(32) NOT NULL, UNIQUE(tier, slot))""",
        )
        sqldb.create_index(c, "ix_kernel_rule_tier", TABLE, "tier, enabled")
        sqldb.add_column(c, TABLE, "guard", "TEXT NOT NULL DEFAULT ''", "NVARCHAR(2000) DEFAULT '' NOT NULL")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _row(r) -> dict:
    d = dict(r)
    d["tags"] = json.loads(d.get("tags") or "[]")
    d["locked"], d["enabled"] = bool(d["locked"]), bool(d["enabled"])
    d["guard"] = json.loads(d["guard"]) if d.get("guard") else None
    return d


def rules(tier: str, enabled_only: bool = True) -> list[dict]:
    q = f"SELECT * FROM {TABLE} WHERE tier=?" + (" AND enabled=1" if enabled_only else "")
    with sqldb.connect() as c:
        return [_row(r) for r in c.execute(q + " ORDER BY position, slot", (tier,)).fetchall()]


def get(rule_id: str) -> dict | None:
    with sqldb.connect() as c:
        r = c.execute(f"SELECT * FROM {TABLE} WHERE id=?", (rule_id,)).fetchone()
    return _row(r) if r else None


def tier_kind(tier: str) -> str:
    from app import personal
    return COMMON if tier == COMMON else ("personal" if personal.is_personal(tier) else "project")


# ── the contract ─────────────────────────────────────────────────────────────

def validate_tags(tags: list[str]) -> list[str]:
    known = T.by_tag()
    clean = list(dict.fromkeys(str(t).strip().lower() for t in (tags or []) if str(t).strip()))
    if not MIN_TAGS <= len(clean) <= MAX_TAGS:
        raise RuleRefused(422, "KERNEL-TAGS", f"give {MIN_TAGS}..{MAX_TAGS} tags, got {len(clean)}")
    unknown = [t for t in clean if t not in known or known[t]["status"] != "active"]
    if unknown:
        import difflib
        names = [t for t, r in known.items() if r["status"] == "active"]
        raise RuleRefused(
            422, "KERNEL-TAGS-UNKNOWN", f"not active tags: {unknown}",
            closest={t: difflib.get_close_matches(t, names, n=3, cutoff=0.5) for t in unknown},
            hint="use tags from GET /kernel/tags/suggest; a new idea: POST /kernel/tags/propose")
    if all(known[t]["facet"] in T.GENERIC_FACETS for t in clean):
        raise RuleRefused(422, "KERNEL-TAGS-WHAT", "only when/where tags given; add what the rule is about")
    return clean


GUARD_DECISIONS = ("ask", "deny")


def validate_guard(guard: Any) -> dict | None:
    """A rule's tool guard in its stored shape {tool, decision, when}, None for none, or RuleRefused.

    tool      the CLI tool name the PreToolUse hook sees (e.g. Artifact)
    decision  'ask' (default: the CLI asks the person first) or 'deny'
    when      optional {tool input field: [allowed values]}; "" stands for a missing field
    """
    if not guard:
        return None
    if not isinstance(guard, dict):
        raise RuleRefused(422, "KERNEL-GUARD", "guard must be an object {tool, decision?, when?}")
    unknown = set(guard) - {"tool", "decision", "when"}
    tool = str(guard.get("tool") or "").strip()
    decision = str(guard.get("decision") or "ask").strip().lower()
    when = guard.get("when") or {}
    if unknown:
        raise RuleRefused(422, "KERNEL-GUARD", f"unknown guard fields: {sorted(unknown)}")
    if not tool or len(tool) > 120:
        raise RuleRefused(422, "KERNEL-GUARD", "guard.tool required (the tool name, at most 120 chars)")
    if decision not in GUARD_DECISIONS:
        raise RuleRefused(422, "KERNEL-GUARD", f"guard.decision is one of {list(GUARD_DECISIONS)}")
    if not isinstance(when, dict):
        raise RuleRefused(422, "KERNEL-GUARD", "guard.when must be an object {field: [values]}")
    clean_when = {}
    for field, allowed in when.items():
        values = allowed if isinstance(allowed, list) else [allowed]
        clean_when[str(field)] = ["" if v is None else str(v).lower() if isinstance(v, bool) else str(v)
                                  for v in values]
    out = {"tool": tool, "decision": decision, "when": clean_when}
    if len(json.dumps(out)) > 2000:
        raise RuleRefused(422, "KERNEL-GUARD", "guard over 2000 chars")
    return out


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def similarity(tags_a: list[str], text_a: str, tags_b: list[str], text_b: str) -> float:
    """How much two rules say the same thing: tag overlap (when/where tags left out), then words."""
    known = T.by_tag()
    core = lambda ts: {t for t in ts if known.get(t, {}).get("facet") not in T.GENERIC_FACETS}  # noqa: E731
    a, b = core(tags_a), core(tags_b)
    contain = len(a & b) / min(len(a), len(b)) if a and b else 0.0
    # Words by overlap coefficient too: a common rule is often one short line inside a longer personal one.
    wa, wb = T.words(text_a), T.words(text_b)
    words = len(wa & wb) / min(len(wa), len(wb)) if wa and wb else 0.0
    return round(0.6 * contain + 0.15 * _jaccard(a, b) + 0.25 * words, 3)


def _parents(tier: str) -> list[dict]:
    """Rules a new rule of this tier may duplicate: the common ones (and, for now, nothing else)."""
    return rules(COMMON) if tier != COMMON else []


def check(body: dict, by: str = "") -> dict:
    """Everything add() would do, without writing: the row it would store, or RuleRefused."""
    tier = (body.get("tier") or "").strip()
    content = " ".join((body.get("content") or "").split())
    title = " ".join((body.get("title") or "").split())[:200]
    if not tier:
        raise RuleRefused(400, "KERNEL-TIER", "tier required: 'common', a project id or your personal project")
    if not content:
        raise RuleRefused(400, "KERNEL-CONTENT", "content required")
    if len(content) > CONTENT_MAX:
        raise RuleRefused(422, "KERNEL-TOO-LONG", f"content over {CONTENT_MAX} chars; split it into rules")
    tags = validate_tags(body.get("tags") or [])
    guard = validate_guard(body.get("guard"))
    notes: list[str] = []
    overrides = (body.get("overrides") or "").strip()
    distinct = [str(s) for s in (body.get("distinct_from") or [])]
    reason = " ".join((body.get("reason") or "").split())[:500]
    slot = (body.get("slot") or "").strip()
    commons = {r["slot"]: r for r in rules(COMMON, enabled_only=False)}
    own = None
    if slot and tier != COMMON:
        own = next((r for r in rules(tier, enabled_only=False) if r["slot"] == slot), None)
        if own is None:
            raise RuleRefused(404, "KERNEL-NO-SLOT", f"tier {tier!r} has no rule with slot {slot!r}; "
                                                     "leave slot out to add a new rule")
        if own["overrides"] and overrides and overrides != own["overrides"]:
            raise RuleRefused(422, "KERNEL-OVERRIDES", f"this rule overrides {own['overrides']!r}; to override "
                                                       "another slot add a new rule and delete this one")
        if own["overrides"]:
            overrides = own["overrides"]          # editing an override keeps it one
        elif not own["overrides"] and overrides:
            raise RuleRefused(422, "KERNEL-OVERRIDES", "a rule of its own slot cannot become an override; "
                                                       "add the override as a new rule and delete this one")

    if overrides:
        if tier == COMMON:
            raise RuleRefused(422, "KERNEL-OVERRIDES", "a common rule is changed with slot=<its slot>, not overrides")
        base = commons.get(overrides)
        if base is None:
            raise RuleRefused(404, "KERNEL-NO-SLOT", f"no common rule with slot {overrides!r}")
        if base["locked"]:
            raise RuleRefused(409, "KERNEL-LOCKED", f"common rule {overrides!r} is locked; it cannot be replaced")
        if set(tags) != set(base["tags"]):
            notes.append(f"tags set to the common rule's own: {base['tags']} (was {tags})")
        tags, slot = list(base["tags"]), overrides
    elif tier == COMMON and slot in commons:
        pass                                         # a maintainer editing a common rule in place
    else:
        same = sorted(({"slot": r["slot"], "title": r["title"], "tags": r["tags"], "locked": r["locked"],
                        "score": similarity(tags, content, r["tags"], r["content"])}
                       for r in (_parents(tier) if tier != COMMON else commons.values())),
                      key=lambda x: -x["score"])
        hits = [s for s in same if s["score"] >= SAME_SCORE and s["slot"] not in distinct]
        if hits:
            raise RuleRefused(
                409, "KERNEL-SAME-AS-COMMON",
                "this rule looks like common rule(s) already in the kernel",
                candidates=hits[:5],
                hint="resend with overrides=<slot> (it replaces that rule, tags are copied from it), "
                     "or distinct_from=[slots] and a reason if it is a different rule")
        if distinct and not reason:
            raise RuleRefused(422, "KERNEL-REASON", "distinct_from needs a reason")
        slot = slot or "sl_" + uuid.uuid4().hex[:10]      # a non-common slot here was checked above

    suggested = [s["tag"] for s in T.suggest(title + " " + content, limit=12)]
    missing = [t for t in suggested[:6] if t not in tags]
    if missing:
        notes.append(f"tags the text suggests but the rule lacks: {missing}")
    locked = bool(body.get("locked")) if tier == COMMON else False
    position = int(body.get("position", own["position"] if own else
                            commons[slot]["position"] if slot in commons else 1000))
    return {"tier": tier, "kind": tier_kind(tier), "slot": slot, "title": title or content[:60],
            "content": content, "tags": tags, "position": position, "locked": locked, "guard": guard,
            "overrides": overrides, "reason": reason, "updated_by": by, "notes": notes}


def add(body: dict, by: str = "") -> dict:
    plan = check(body, by)
    with _LOCK, sqldb.connect() as c:
        old = c.execute(f"SELECT id FROM {TABLE} WHERE tier=? AND slot=?", (plan["tier"], plan["slot"])).fetchone()
        rid = old["id"] if old else "kr_" + uuid.uuid4().hex[:12]
        sqldb.upsert(c, TABLE, ("tier", "slot"), {
            "id": rid, "tier": plan["tier"], "slot": plan["slot"], "title": plan["title"],
            "content": plan["content"], "tags": json.dumps(plan["tags"]), "position": plan["position"],
            "locked": int(plan["locked"]), "enabled": 1, "overrides": plan["overrides"],
            "guard": json.dumps(plan["guard"]) if plan["guard"] else "",
            "reason": plan["reason"], "updated_by": by, "updated_at": _now()})
    return {**plan, "id": rid, "result": "updated" if old else "added"}


def delete(rule_id: str) -> int:
    with _LOCK, sqldb.connect() as c:
        return c.execute(f"DELETE FROM {TABLE} WHERE id=?", (rule_id,)).rowcount


def seed(path: str, by: str = "seed") -> dict:
    """Load the common rules of a seed file (seeds/kernel_rules.seed.json). Tags are checked like any add."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    done = []
    # The seed's rules are distinct by construction (they are the kernel split at its rule numbers).
    distinct = {"distinct_from": [r["slot"] for r in data["rules"]] + ["kh_header"], "reason": "seed: " + path}
    header = data.get("header")
    if header:
        done.append(add({"tier": COMMON, "slot": "kh_header", "title": "Kernel header", "content": header,
                         "tags": ["kh_kernel", "kh_common", "always"], "position": -1, "locked": True,
                         **distinct}, by)["slot"])
    for r in data["rules"]:
        done.append(add({**r, "tier": COMMON, **distinct}, by)["slot"])
    return {"rules": len(done), "slots": done}


# ── resolving ────────────────────────────────────────────────────────────────

def resolve(project: str | None, personal_tier: str | None) -> list[dict]:
    """The kernel as one list, per slot the most specific rule: [{slot, tier, kind, rule, replaced, blocked}]."""
    tiers = [COMMON] + ([project] if project and project != COMMON else []) + ([personal_tier] if personal_tier else [])
    by_slot: dict[str, list[dict]] = {}
    for tier in tiers:
        for r in rules(tier):
            by_slot.setdefault(r["slot"], []).append({**r, "kind": tier_kind(tier)})
    out = []
    for slot, rows in by_slot.items():
        rows.sort(key=lambda r: TIER_RANK[r["kind"]])
        base = rows[0]
        if base["kind"] == COMMON and base["locked"]:
            win, blocked = base, rows[1:]
        else:
            win, blocked = rows[-1], []
        out.append({"slot": slot, "tier": win["tier"], "kind": win["kind"], "rule": win,
                    "replaced": [r["tier"] for r in rows if r is not win and r not in blocked],
                    "blocked": [r["tier"] for r in blocked],
                    "order": (base["position"] if base["kind"] == COMMON else 1000 + win["position"],
                              TIER_RANK[win["kind"]], slot)})
    out.sort(key=lambda e: e["order"])
    return out


def guards(tool: str, project: str | None, personal_tier: str | None) -> list[dict]:
    """The guards for one tool among the rules that won their slot: a replaced rule's guard goes with it."""
    out = []
    for e in resolve(project, personal_tier):
        g = e["rule"].get("guard")
        if g and g["tool"] == tool:
            out.append({"id": e["rule"]["id"], "text": e["rule"]["content"], "decision": g["decision"],
                        "when": g["when"], "tier": e["tier"], "slot": e["slot"]})
    return out


def render(project: str | None, personal_tier: str | None, legacy: list[str] | None = None) -> list[str]:
    """The resolved kernel as text blocks (one per rule), ready to be cut into parts."""
    blocks: list[str] = []
    extra: list[str] = []
    for e in resolve(project, personal_tier):
        text = e["rule"]["content"]
        if e["kind"] == COMMON:
            blocks.append(text)
        elif e["rule"]["overrides"]:
            blocks.append(f"[{e['kind']}, replaces the common rule '{e['rule']['overrides']}'] {text}")
        else:
            extra.append(f"- {text}")
    if extra:
        blocks.append("PERSONAL AND PROJECT RULES (already merged with the rules above; on overlap they win):\n"
                      + "\n".join(extra))
    if legacy:
        blocks.append("PERSONALIZATION NOT YET TAGGED (wins over the common rules on overlap, except the locked "
                      "ones):\n" + "\n".join("- " + t for t in legacy))
    return blocks


def parts(blocks: list[str], max_chars: int) -> list[str]:
    """Cut at rule boundaries into texts of at most max_chars (one rule longer than that stands alone)."""
    out, cur = [], ""
    for b in blocks:
        if cur and len(cur) + 2 + len(b) > max_chars:
            out.append(cur)
            cur = b
        else:
            cur = cur + "\n\n" + b if cur else b
    if cur:
        out.append(cur)
    return out
