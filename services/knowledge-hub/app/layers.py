"""Semantic layers (C4-style) for KnowledgeHub — additive over the vector store.

Design ref: kh_semantic_layers.md  (twin of rita_adaptive_flow.md)

A single piece of knowledge is split into zoom LEVELS and each level is stored
SEPARATELY as its own vector record, tagged with metadata so retrieval can start
shallow (lv1 = the verdict/overview) and drill deeper only where a task commits:

    metadata = {tree_id, lv, parent_id, epoch, kind, subject_key, layered:"1"}

This is purely additive (§2): it reuses ``upsert_vt`` / ``query_vt`` / ``get_vt``
and ChromaDB's deterministic ``where`` filter — no rewrite of the ATTR graph
pipeline. The invariants that make it safe:

  - lv1 MUST carry the VERDICT, not just a topic (§3) — else it can't be
    retrieved on the trigger phrase and the constraint is lost.
  - a fact about an existing subject ATTACHES to that subject's tree (§4.5-1),
    it is never stored as an isolated record — so an exhaustive gather by
    subject is deterministic and uncapped by k.
  - a gathered set is RECONCILED by the trust ladder (author user>agent, then
    verified_count, then recency) so stale facts lose to fresh/authoritative
    ones (§4.5-3, reusing the §17 resolver locally — KH stays decoupled).

Covered: T090 (parse leveled), T091 (attributes), T092 (max_level), T093 (route
long-save / size-gate), T095 (depth-aware read helper), T096 (attach-to-cluster),
T097 (exhaustive gather + dynamic-k), T098 (reconcile).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Callable

# ── metadata keys ─────────────────────────────────────────────────────────────
LAYERED_FLAG = "layered"          # "1" marks a semantic-layer record
K_TREE = "tree_id"
K_LEVEL = "lv"
K_PARENT = "parent_id"
K_EPOCH = "epoch"
K_KIND = "kind"                   # "knowledge" | "policy"
K_SUBJECT = "subject_key"
K_AUTHOR = "author"              # "user" | "agent:<name>"
K_VERIFIED = "verified_count"
K_TS = "ts"                      # ISO date string or epoch seconds

# knowledge shorter than this stays a single layer (§6 size-gate)
LAYER_MIN_WORDS = 25


def slug(text: str, prefix: str = "kb") -> str:
    base = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")[:40]
    h = hashlib.sha1((text or "").encode()).hexdigest()[:8]
    return f"{prefix}_{base}_{h}" if base else f"{prefix}_{h}"


# ── T091 metadata builder ─────────────────────────────────────────────────────
def layer_metadata(*, tree_id: str, lv: int, epoch: int = 1, kind: str = "knowledge",
                   subject_key: str = "", parent_id: str = "", author: str = "agent:kh",
                   verified_count: int = 0, ts: str = "") -> dict:
    """Build a ChromaDB-safe (scalar-only) metadata dict for a layer record."""
    md: dict[str, Any] = {
        LAYERED_FLAG: "1",
        K_TREE: tree_id,
        K_LEVEL: int(lv),
        K_EPOCH: int(epoch),
        K_KIND: kind,
        K_SUBJECT: subject_key or tree_id,
        K_AUTHOR: author,
        K_VERIFIED: int(verified_count),
    }
    if parent_id:
        md[K_PARENT] = parent_id
    if ts:
        md[K_TS] = ts
    return md


# ── T090 parse leveled extraction ─────────────────────────────────────────────
@dataclass
class LayerRecord:
    id: str
    lv: int
    text: str
    parent_id: str = ""
    enforce: dict | None = None      # only for kind=policy lv1


class LeveledParseError(ValueError):
    pass


def parse_leveled(obj: dict, *, tree_id: str = "", subject_key: str = "") -> tuple[str, str, list[LayerRecord]]:
    """Validate an LLM leveled-decomposition object into ordered LayerRecords.

    Enforces the hard invariant (§3): exactly one lv1 that carries a NON-empty
    verdict text; every deeper level points at a parent. Returns (tree_id,
    subject_key, records).
    """
    if not isinstance(obj, dict):
        raise LeveledParseError("leveled object must be a dict")
    levels = obj.get("levels")
    if not isinstance(levels, list) or not levels:
        raise LeveledParseError("levels must be a non-empty list")

    tree_id = tree_id or str(obj.get("tree_id") or "").strip()
    roots = [l for l in levels if int(l.get("lv", 0)) == 1]
    if len(roots) != 1:
        raise LeveledParseError(f"exactly one lv1 required, got {len(roots)}")
    if not str(roots[0].get("text") or "").strip():
        raise LeveledParseError("lv1 must carry a verdict (non-empty text)")

    if not tree_id:
        tree_id = slug(roots[0]["text"])
    subject_key = subject_key or str(obj.get("subject_key") or "").strip() or tree_id

    # assign deterministic ids where the model didn't
    records: list[LayerRecord] = []
    root_id = str(roots[0].get("id") or f"{tree_id}_lv1")
    order = sorted(levels, key=lambda l: int(l.get("lv", 99)))
    id_map: dict[int, str] = {}
    for i, l in enumerate(order):
        lv = int(l.get("lv", 0))
        if lv < 1:
            raise LeveledParseError(f"level {i} has invalid lv={lv}")
        rid = str(l.get("id") or (root_id if lv == 1 else f"{tree_id}_lv{lv}_{i}"))
        parent = str(l.get("parent") or l.get("parent_id") or "")
        if lv > 1 and not parent:
            parent = id_map.get(lv - 1, root_id)      # default: chain to nearest shallower
        id_map[lv] = rid
        records.append(LayerRecord(
            id=rid, lv=lv, text=str(l.get("text") or "").strip(),
            parent_id=parent if lv > 1 else "",
            enforce=l.get("enforce") if isinstance(l.get("enforce"), dict) else None,
        ))
    return tree_id, subject_key, records


# ── T093 size-gate (route long-save only) ─────────────────────────────────────
def should_layer(text: str, min_words: int = LAYER_MIN_WORDS) -> bool:
    """Only long text earns C4 decomposition; a short fact stays one layer (§6)."""
    return len(re.findall(r"\S+", text or "")) >= min_words


# ── T092 depth filter ─────────────────────────────────────────────────────────
def max_level_where(max_level: int, *, tree_id: str = "", kind: str = "") -> dict:
    """A ChromaDB ``where`` selecting layer records up to ``max_level`` (§4 drill)."""
    clauses: list[dict] = [{LAYERED_FLAG: {"$eq": "1"}}, {K_LEVEL: {"$lte": int(max_level)}}]
    if tree_id:
        clauses.append({K_TREE: {"$eq": tree_id}})
    if kind:
        clauses.append({K_KIND: {"$eq": kind}})
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


# ── T097 dynamic-k (elbow) ────────────────────────────────────────────────────
def dynamic_k(hits: list[dict], *, score_key: str = "score", drop: float = 0.15,
              floor: float = 0.30, max_k: int = 20) -> list[dict]:
    """Keep the leading run of hits, cutting at the first big score drop (elbow).

    Replaces a hard k for *focused* reads: a topic with 2 good hits returns 2, one
    with 8 returns 8 — without padding rubbish past a similarity cliff (§4.5-2).
    """
    ranked = sorted(hits, key=lambda h: float(h.get(score_key, 0.0)), reverse=True)[:max_k]
    kept: list[dict] = []
    prev: float | None = None
    for h in ranked:
        s = float(h.get(score_key, 0.0))
        if s < floor:
            break
        if prev is not None and (prev - s) > drop:
            break
        kept.append(h)
        prev = s
    return kept or ranked[:1]


# ── T098 reconcile (§17 trust ladder, reimplemented locally) ──────────────────
_AUTHOR_RANK = {"user": 0, "agent": 1, "trained": 2}


def _author_class(meta: dict) -> str:
    a = str((meta or {}).get(K_AUTHOR, "")).lower()
    if a == "user":
        return "user"
    if a.startswith("agent"):
        return "agent"
    return "trained"


def reconcile(records: list[dict], *, key: Callable[[dict], str] | None = None) -> list[dict]:
    """Collapse conflicting facts per subject: user > agent, then verified, then recency.

    ``key`` groups conflicting facts (default: subject_key + level — same slot in the
    same tree). The winner of each group is kept; the rest are dropped as stale.
    """
    def default_key(r: dict) -> str:
        m = r.get("metadata", {}) or {}
        return f"{m.get(K_SUBJECT, '')}|{m.get(K_LEVEL, '')}"
    kfn = key or default_key
    # sort so the winner of each group is seen first
    ordered = sorted(records, key=lambda r: (kfn(r),) + _rank_key_tuple(r))
    best: dict[str, dict] = {}
    for r in ordered:
        k = kfn(r)
        if k not in best:
            best[k] = r
    return list(best.values())


def _rank_key_tuple(rec: dict):
    # recency uses reverse ISO sort: newer string is "greater", so negate via reverse below
    meta = rec.get("metadata", {}) or {}
    rank = _AUTHOR_RANK.get(_author_class(meta), 2)
    verified = int(meta.get(K_VERIFIED, 0) or 0)
    ts = str(meta.get(K_TS, "") or "")
    # for a stable "winner first" order: lower rank, higher verified, later ts
    return (rank, -verified, _neg_str(ts))


class _neg_str:
    """Wrap a string so that a LATER string sorts FIRST (descending recency)."""
    __slots__ = ("s",)

    def __init__(self, s: str) -> None:
        self.s = s

    def __lt__(self, other: "_neg_str") -> bool:
        return self.s > other.s

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _neg_str) and self.s == other.s


# ── storage-facing helpers (injectable for offline tests) ─────────────────────
@dataclass
class LayerStore:
    """Thin seam over the vector store so layer ops are offline-testable.

    Production wiring passes the real ``upsert_vt`` / ``query_vt`` / ``get_vt`` and
    an ``encode`` fn; tests pass fakes.
    """
    encode: Callable[[str], list[float]]
    upsert: Callable[..., None]
    query: Callable[..., list[dict]]
    get: Callable[..., list[dict]]

    # T093/T096 write
    def add_layers(self, records: list[LayerRecord], *, tree_id: str, subject_key: str,
                   epoch: int = 1, kind: str = "knowledge", author: str = "agent:kh",
                   ts: str = "", parent_tree: str = "") -> list[str]:
        """Persist each layer as its own vector record (metadata-tagged, parent-linked)."""
        ids: list[str] = []
        for rec in records:
            parent = rec.parent_id
            # T096: if attaching under an existing subject cluster, lv1 hangs off that tree's root
            if rec.lv == 1 and parent_tree:
                parent = f"{parent_tree}_lv1"
            md = layer_metadata(tree_id=tree_id, lv=rec.lv, epoch=epoch, kind=kind,
                                subject_key=subject_key, parent_id=parent, author=author, ts=ts)
            if rec.enforce is not None:
                md["enforce_json"] = _to_json(rec.enforce)
            vec = self.encode(rec.text)
            self.upsert(rec.id, vec, rec.text, md)
            ids.append(rec.id)
        return ids

    # T096 attach-to-cluster: does a subject already have a tree?
    def find_subject_tree(self, subject_key: str) -> str | None:
        rows = self.get({"$and": [{LAYERED_FLAG: {"$eq": "1"}},
                                  {K_SUBJECT: {"$eq": subject_key}},
                                  {K_LEVEL: {"$eq": 1}}]}, )
        if not rows:
            return None
        return (rows[0].get("metadata", {}) or {}).get(K_TREE)

    # T092/T095 depth-aware read
    def query_depth(self, text: str, *, max_level: int = 1, k: int = 5,
                    tree_id: str = "", kind: str = "") -> list[dict]:
        vec = self.encode(text)
        return self.query(vec, n_results=k, where=max_level_where(max_level, tree_id=tree_id, kind=kind))

    # T097/T098 exhaustive gather by subject + reconcile
    def gather_subject(self, subject_key: str, *, reconcile_set: bool = True,
                       max_level: int | None = None) -> list[dict]:
        clauses: list[dict] = [{LAYERED_FLAG: {"$eq": "1"}}, {K_SUBJECT: {"$eq": subject_key}}]
        if max_level is not None:
            clauses.append({K_LEVEL: {"$lte": int(max_level)}})
        rows = self.get({"$and": clauses})
        return reconcile(rows) if reconcile_set else rows


def _to_json(obj: Any) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False)
