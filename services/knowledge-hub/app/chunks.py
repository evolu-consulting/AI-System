"""Chunk vectors - so the whole of a long row is searchable, not only its first 512 tokens.

WHY (measured 2026-09-30). The embedder, bge-small-en-v1.5, reads at most 512 tokens and silently
drops the rest. 377 of 437 ticketing worklogs (86 %) are longer than that (median 949 tokens), so
most of what they say was never embedded: on 12 long rows a passage from the START came back in the
top 5 for 10 of them, a passage from the END for 1.

WHAT THIS DOES. A row longer than CHUNK_MIN_CHARS gets extra vectors, one per window of CHUNK_CHARS (800)
characters taken every CHUNK_STRIDE (700) characters after the first window (the row's own vector already
covers its head). They live in a SIDECAR collection per project, kh_chunk_<project>, never in the
row's own collection, so every read that lists, counts, spills or pages rows is untouched. Each
chunk carries the row's metadata (so scope, topic and project filters apply to it unchanged) plus
`chunk_of` = the row id. A semantic query searches the sidecars too and answers with the ROW: a hit
on any chunk ranks its row, and the row's text is read back through the query's own lanes, so a row
the caller may not see, or one deleted since, never comes back through its chunks.

Re-adding a row replaces its chunks; /vector/delete removes them; deleting a project drops its
sidecar with the rest of its kh_* parts. POST /vector/rechunk builds chunks for rows stored before.
"""
from __future__ import annotations

import logging

from app import config
from app import vector_store as vs

logger = logging.getLogger(__name__)

PART = "chunk"
PARENT_KEY = "chunk_of"


def windows(text: str) -> list[str]:
    """The extra windows of a long text; [] when the row's own vector already covers it."""
    text = text or ""
    size, stride = config.CHUNK_CHARS, config.CHUNK_STRIDE
    if len(text) <= config.CHUNK_MIN_CHARS:
        return []
    out = []
    start = stride
    while start < len(text):
        piece = text[start:start + size]
        if len(piece.strip()) >= 200 or not out:
            out.append(piece)
        if start + size >= len(text):
            break
        start += stride
    return out


def sidecar_name(project: str) -> str:
    return vs.part_collection_name(PART, project)


def _sidecar(project: str, create: bool):
    name = sidecar_name(project)
    if not create and name not in vs.existing_collection_names():
        return None
    return vs.get_or_create(name)


def write(row_id: str, text: str, metadata: dict, project: str, encode_batch) -> int:
    """(Re)build the chunk vectors of one row. Returns how many were written."""
    parts = windows(text)
    coll = _sidecar(project, create=bool(parts))
    if coll is None:
        return 0
    old = vs.get_vt({PARENT_KEY: {"$eq": row_id}}, collection=coll)
    if old:
        vs.delete_vt([h["core_id"] for h in old], collection=coll)
    if not parts:
        return 0
    vectors = encode_batch(parts)
    for i, (piece, vec) in enumerate(zip(parts, vectors), start=1):
        meta = {**metadata, PARENT_KEY: row_id, "chunk_no": i}
        vs.upsert_vt(f"{row_id}#c{i}", list(vec), piece, meta, coll)
    return len(parts)


def delete_for(row_ids: list[str]) -> int:
    """Remove the chunks of these rows from every sidecar."""
    if not row_ids:
        return 0
    gone = 0
    for name in vs.existing_collection_names():
        if not (name.startswith(f"kh_{PART}_")):
            continue
        coll = vs.get_or_create(name)
        for rid in row_ids:
            hits = vs.get_vt({PARENT_KEY: {"$eq": rid}}, collection=coll)
            if hits:
                gone += len(vs.delete_vt([h["core_id"] for h in hits], collection=coll))
    return gone


def lanes(project: str | None, where: dict | None) -> list[tuple]:
    """(sidecar, where) pairs a semantic query must also search, for one project or every visible one."""
    from app import auth
    live = vs.existing_collection_names()
    if project:
        names = [sidecar_name(project)]
    else:
        visible = auth.visible_projects("project.read")
        prefix = f"kh_{PART}_"
        names = [n for n in live if n.startswith(prefix)
                 and (visible is None or n[len(prefix):] in visible)]
    return [(vs.get_or_create(n), where) for n in names if n in live]
