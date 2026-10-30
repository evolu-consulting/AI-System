"""Copy KH's policy + common knowledge from a local install into a HANA-backed KH.

Scope (fen 2026-09-23): a BLANK cloud KH that carries the policy tiers and the shared
knowledge of the local :9000 install, and none of its projects. What moves is decided by
the SELECTION table below, not by code, so widening it later is a data edit.

    relational (hooks.db):  hook_rules, policy_actions, policy_rules   - every row
    vectors (Chroma):       the collections + row filters listed in VECTOR_SELECTION

Rows keep their ids, stored embeddings, documents and metadata, so nothing is re-embedded
and the cloud copy ranks exactly like the local one. The copy is an upsert: running it
twice leaves the same result, and it never deletes anything on the target.

READ FROM A SNAPSHOT, NOT THE LIVE STORE. Chroma is not safe to open from a second
process while KH is running on it, so copy chroma_data and hooks.db aside first and
point --chroma / --hooks-db at the copy.

Usage (target credentials from the environment: HANA_HOST, HANA_PORT, HANA_USERNAME,
HANA_PASSWORD, HANA_SCHEMA, HANA_ENCRYPT=true):

    .venv\\Scripts\\python tools\\migrate_to_hana.py --chroma <snap>\\chroma_data \\
        --hooks-db <snap>\\hooks.db [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

#: hooks.db tables copied whole. `id` of hook_rules is left to HANA's identity column:
#: copying explicit ids would collide with the ids HANA generates for later inserts.
RELATIONAL_SELECTION = {
    "hook_rules":     {"keys": ("hook_type", "name"), "drop": ("id",)},
    "policy_actions": {"keys": ("project", "action"), "drop": ()},
    "policy_rules":   {"keys": ("project", "action", "sub_action"), "drop": ()},
}

#: Chroma collections copied, each with the rows it keeps. `exclude` drops a row when
#: any listed metadata field has one of the listed values.
VECTOR_SELECTION = {
    # Common knowledge + personalization. The C4 project registry entries are left out on
    # purpose: they name projects the blank KH does not have, and the target rebuilds its
    # own registry from its own project table at startup. Worklogs are not knowledge.
    "kh_know_orchestrator": {"exclude": {"kind": ["project-registry"], "scope": ["log"]}},
    # The orchestrator-common vector policy tier (/policy/add, /policy/match).
    "kh_policy_orchestrator": {"exclude": {}},
    # Legacy shared collection: knowledge written before per-project isolation.
    "knowledge_hub_vectors": {"exclude": {"scope": ["log"]}},
}

BATCH = 200


def _keep(meta: dict, exclude: dict) -> bool:
    return not any((meta or {}).get(field) in values for field, values in exclude.items())


def copy_relational(src_path: str, dry_run: bool) -> dict:
    from app import sqldb
    from app.hooks import store as hooks_store
    from app.policy_actions import store as policy_store

    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    report = {}
    if not dry_run:
        hooks_store.init()
        policy_store.init()
    for table, spec in RELATIONAL_SELECTION.items():
        rows = [dict(r) for r in src.execute(f"SELECT * FROM {table}")]
        for r in rows:
            for col in spec["drop"]:
                r.pop(col, None)
        if not dry_run:
            with sqldb.connect() as c:
                for r in rows:
                    sqldb.upsert(c, table, spec["keys"], r)
            with sqldb.connect() as c:
                target = c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        else:
            target = None
        report[table] = {"source": len(rows), "target_after": target}
    src.close()
    return report


def copy_vectors(chroma_path: str, dry_run: bool) -> dict:
    import chromadb
    from chromadb.config import Settings

    src = chromadb.PersistentClient(path=chroma_path, settings=Settings(anonymized_telemetry=False))
    live = {getattr(c, "name", c) for c in src.list_collections()}
    dst = None
    if not dry_run:
        from app.vector_hana import HanaVectorClient
        dst = HanaVectorClient()
    report = {}
    for name, spec in VECTOR_SELECTION.items():
        if name not in live:
            report[name] = {"source": 0, "kept": 0, "note": "absent in source"}
            continue
        coll = src.get_collection(name)
        got = coll.get(include=["embeddings", "metadatas", "documents"])
        ids = got["ids"]
        embs = got["embeddings"]
        metas = got["metadatas"] or [{}] * len(ids)
        docs = got["documents"] or [""] * len(ids)
        keep = [i for i in range(len(ids)) if _keep(metas[i], spec["exclude"])]
        entry = {"source": len(ids), "kept": len(keep)}
        if dst is not None and keep:
            target = dst.get_or_create_collection(name, metadata={"hnsw:space": "cosine"})
            for start in range(0, len(keep), BATCH):
                part = keep[start:start + BATCH]
                target.upsert(ids=[ids[i] for i in part],
                              embeddings=[list(map(float, embs[i])) for i in part],
                              metadatas=[metas[i] or {} for i in part],
                              documents=[docs[i] or "" for i in part])
            present = set(target.get(ids=[ids[i] for i in keep], include=[])["ids"])
            entry["verified_on_target"] = len(present)
            entry["missing_on_target"] = len(keep) - len(present)
        report[name] = entry
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--chroma", required=True, help="snapshot of chroma_data")
    ap.add_argument("--hooks-db", required=True, help="snapshot of hooks.db")
    ap.add_argument("--dry-run", action="store_true", help="count only, write nothing")
    args = ap.parse_args()

    os.environ["KH_STORE_BACKEND"] = "hana"
    if not args.dry_run:
        missing = [v for v in ("HANA_HOST", "HANA_USERNAME", "HANA_PASSWORD", "HANA_SCHEMA")
                   if not os.getenv(v)]
        if missing:
            print("missing target credentials: " + ", ".join(missing))
            return 2

    rel = copy_relational(args.hooks_db, args.dry_run)
    vec = copy_vectors(args.chroma, args.dry_run)
    print("relational:")
    for k, v in rel.items():
        print(f"  {k:16s} {v}")
    print("vectors:")
    for k, v in vec.items():
        print(f"  {k:24s} {v}")
    bad = [k for k, v in vec.items() if v.get("missing_on_target")]
    if bad:
        print("NOT COMPLETE: rows missing on target in " + ", ".join(bad))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
