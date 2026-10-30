"""T090-T098 acceptance tests — semantic layers (pure logic + injectable store)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import layers as L


# ── T090 parse leveled ────────────────────────────────────────────────────────
def test_parse_valid_assigns_parents():
    obj = {"subject_key": "browser", "levels": [
        {"lv": 1, "id": "r", "text": "ST LTD: cấm Chrome → dùng Solace"},
        {"lv": 2, "text": "Solace = Chromium; --debug-port=9222"},
        {"lv": 2, "text": "lý do cấm = bảo mật"}]}
    tree, subj, recs = L.parse_leveled(obj)
    assert subj == "browser" and tree
    assert recs[0].lv == 1 and recs[0].parent_id == ""
    assert all(r.parent_id == "r" for r in recs if r.lv == 2)   # chained to lv1


def test_parse_rejects_missing_lv1():
    try:
        L.parse_leveled({"levels": [{"lv": 2, "text": "detail"}]}); assert False
    except L.LeveledParseError:
        pass


def test_parse_rejects_empty_verdict():
    try:
        L.parse_leveled({"levels": [{"lv": 1, "text": "   "}]}); assert False
    except L.LeveledParseError:
        pass


# ── T093 size-gate ────────────────────────────────────────────────────────────
def test_should_layer_gate():
    assert L.should_layer("word " * 30) is True
    assert L.should_layer("port 9222") is False


# ── T091/T092 metadata + depth filter ─────────────────────────────────────────
def test_layer_metadata_scalar_only():
    md = L.layer_metadata(tree_id="t", lv=2, epoch=3, subject_key="s", parent_id="p")
    assert md[L.K_LEVEL] == 2 and md[L.K_EPOCH] == 3 and md[L.LAYERED_FLAG] == "1"
    assert all(isinstance(v, (str, int, float, bool)) for v in md.values())


def test_max_level_where():
    w = L.max_level_where(2, tree_id="t", kind="policy")
    assert {"$and"} <= set(w)
    clauses = w["$and"]
    assert {L.K_LEVEL: {"$lte": 2}} in clauses and {L.K_KIND: {"$eq": "policy"}} in clauses


# ── T097 dynamic-k elbow ──────────────────────────────────────────────────────
def test_dynamic_k_cuts_at_cliff():
    hits = [{"score": 0.9}, {"score": 0.88}, {"score": 0.86}, {"score": 0.50}, {"score": 0.49}]
    kept = L.dynamic_k(hits, drop=0.15, floor=0.30)
    assert len(kept) == 3                             # cut before the 0.86→0.50 cliff


def test_dynamic_k_floor():
    hits = [{"score": 0.2}, {"score": 0.1}]
    assert len(L.dynamic_k(hits, floor=0.30)) == 1   # nothing passes floor → keep top-1


# ── T098 reconcile trust ladder ───────────────────────────────────────────────
def _rec(text, author="agent:x", verified=0, ts="", subject="s", lv=1):
    return {"core_id": text, "source_text": text,
            "metadata": {L.K_AUTHOR: author, L.K_VERIFIED: verified, L.K_TS: ts,
                         L.K_SUBJECT: subject, L.K_LEVEL: lv}}


def test_reconcile_user_beats_agent():
    winners = L.reconcile([_rec("port 9222 (agent)", author="agent:x", verified=99),
                           _rec("port 9333 (fen)", author="user")])
    assert len(winners) == 1 and winners[0]["source_text"] == "port 9333 (fen)"


def test_reconcile_recency_then_verified():
    winners = L.reconcile([
        _rec("old", author="agent:x", verified=1, ts="2026-01-01"),
        _rec("new", author="agent:x", verified=1, ts="2026-07-01")])
    assert winners[0]["source_text"] == "new"          # later ts wins at equal rank/verified


def test_reconcile_keeps_distinct_slots():
    winners = L.reconcile([_rec("a", subject="s", lv=1), _rec("b", subject="s", lv=2)])
    assert len(winners) == 2                            # different level = different slot


# ── LayerStore with fakes (T093/T096/T092/T097) ───────────────────────────────
class FakeStore:
    def __init__(self, rows=None):
        self.upserts = []
        self.rows = rows or []
        self.last_where = None

    def encode(self, text):
        return [float(len(text))]

    def upsert(self, cid, vec, text, md):
        self.upserts.append({"core_id": cid, "source_text": text, "metadata": md})
        self.rows.append({"core_id": cid, "source_text": text, "metadata": md})

    def query(self, vec, n_results=5, where=None):
        self.last_where = where
        return self.rows[:n_results]

    def get(self, where, limit=None):
        self.last_where = where
        return list(self.rows)


def _store(rows=None):
    f = FakeStore(rows)
    return f, L.LayerStore(encode=f.encode, upsert=f.upsert, query=f.query, get=f.get)


def test_add_layers_tags_metadata():
    f, store = _store()
    _, _, recs = L.parse_leveled({"levels": [
        {"lv": 1, "id": "r", "text": "verdict here that is fine"},
        {"lv": 2, "text": "component detail"}]})
    ids = store.add_layers(recs, tree_id="t", subject_key="subj", epoch=2, author="user")
    assert len(ids) == 2
    lv1 = f.upserts[0]["metadata"]
    assert lv1[L.K_TREE] == "t" and lv1[L.K_SUBJECT] == "subj" and lv1[L.K_EPOCH] == 2
    assert f.upserts[1]["metadata"][L.K_PARENT] == "r"     # child linked to lv1


def test_add_layers_attach_to_existing_cluster():
    f, store = _store()
    _, _, recs = L.parse_leveled({"levels": [{"lv": 1, "id": "n", "text": "a new fact about X"}]})
    store.add_layers(recs, tree_id="new", subject_key="X", parent_tree="existing")
    assert f.upserts[0]["metadata"][L.K_PARENT] == "existing_lv1"   # T096 hangs off existing tree


def test_find_subject_tree():
    rows = [{"core_id": "r", "metadata": {L.LAYERED_FLAG: "1", L.K_SUBJECT: "X",
                                          L.K_LEVEL: 1, L.K_TREE: "kb_x"}}]
    f, store = _store(rows)
    assert store.find_subject_tree("X") == "kb_x"


def test_query_depth_passes_max_level_where():
    f, store = _store([{"core_id": "r", "metadata": {}}])
    store.query_depth("q", max_level=1, k=3)
    assert f.last_where == L.max_level_where(1)   # depth filter applied


def test_gather_subject_reconciles():
    rows = [_rec("stale", author="agent:x", verified=1, ts="2026-01-01", subject="X"),
            _rec("fresh", author="user", ts="2026-07-01", subject="X")]
    f, store = _store(rows)
    got = store.gather_subject("X")
    assert len(got) == 1 and got[0]["source_text"] == "fresh"   # uncapped gather + reconcile


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  PASS  {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} tests passed")
