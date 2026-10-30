"""B4 data migration — split log/knowledge/findings out of the shared flat
collection into each project's OWN physical collection (kh_log_/kh_know_/kh_find_
<project>), keyed by metadata.project. personalization + kh-meta self-info move to
the orchestrator's common knowledge. Idempotent: re-running is safe (upsert + the
row is deleted from the shared store once copied).

Run with the SAME env as the server (test paths) while the server is STOPPED so the
Chroma client is the only writer. DRY-RUN unless --apply is passed.
"""
import sys

from app import vector_store as vs
from app.vector_store import _collection, _stamp  # shared collection + stamp

APPLY = "--apply" in sys.argv

# scopes that become per-project (or common) physical collections
MOVE_SCOPES = ("log", "knowledge", "findings", "personalization", "kh-meta", "self-info")


def main() -> None:
    res = _collection.get(include=["embeddings", "metadatas", "documents"])
    ids = list(res.get("ids") or [])
    embs_raw = res.get("embeddings")
    embs = [list(e) for e in embs_raw] if embs_raw is not None else []
    metas = list(res.get("metadatas") or [])
    docs = list(res.get("documents") or [])

    plan: dict[str, list] = {}      # target collection name -> list of (id, emb, meta, doc)
    skipped = 0
    for i, cid in enumerate(ids):
        meta = metas[i] or {}
        scope = meta.get("scope")
        if scope not in MOVE_SCOPES:
            skipped += 1
            continue
        project = meta.get("project") or meta.get("source_id")
        target = vs.scope_collection(scope, project)
        if target is None:
            skipped += 1
            continue
        plan.setdefault(target.name, []).append(
            (cid, embs[i], meta, docs[i] if i < len(docs) else "")
        )

    print(f"shared rows total={len(ids)}  to-move={sum(len(v) for v in plan.values())}  stay={skipped}")
    for name, rows in sorted(plan.items()):
        print(f"  -> {name}: {len(rows)}")

    if not APPLY:
        print("DRY-RUN (pass --apply to execute)")
        return

    moved_ids: list[str] = []
    for name, rows in plan.items():
        coll = vs.get_or_create(name)
        B = 500
        for j in range(0, len(rows), B):
            batch = rows[j:j + B]
            coll.upsert(
                ids=[r[0] for r in batch],
                embeddings=[r[1] for r in batch],
                metadatas=[_stamp({**r[2]}) for r in batch],
                documents=[r[3] or (r[2].get("source_text", "")) for r in batch],
            )
            moved_ids.extend(r[0] for r in batch)
    # delete moved rows from the shared collection
    for j in range(0, len(moved_ids), 500):
        _collection.delete(ids=moved_ids[j:j + 500])
    print(f"APPLIED: moved {len(moved_ids)} rows out of the shared collection.")


if __name__ == "__main__":
    main()
