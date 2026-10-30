"""Versioned spec addendum vN.k (design N3, I02: the pack is never edited in place).

make_addendum(store, run, answered_questions) turns the answers of one question round into a new
file "addendum/vN.k.md" of the pack: one heading (= one span) per answered question, holding the
decision, the chosen option, any free text and the F-items it touches. Later reads quote it like
any other source. The pack is re-frozen as a new PackVersion (version = sha over all files incl.
the addendum), stored under E_PACK; the run row's spec_hash moves to it (detail.spec_hash_base keeps
the original); the affected F-items get "stale": true; assumptions / conflicts get the addendum
label and span id; spec.addendum is emitted.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .. import codes
from ..codes import LineError
from ..contracts import E_FITEM, E_PACK, E_RUN, PackVersion, from_dict, to_dict
from ..understand._common import sha256_bytes
from ..understand.ingest import pack_version as _pack_version, split_spans
from ._common import E_ADDENDUM, E_PARK, E_QUESTION, SPEC_ADDENDUM, clock_ms, emit, merge, put, rid, s, setting

ADDENDUM_DIR = "addendum"
_LABEL_RE = re.compile(r"^%s/v(\d+)\.(\d+)\.md$" % ADDENDUM_DIR)


def addendum_files(pv: PackVersion) -> List[str]:
    return sorted((p for p in pv.files if _LABEL_RE.match(p)),
                  key=lambda p: tuple(int(x) for x in _LABEL_RE.match(p).groups()))


def next_label(pv: PackVersion, major: int) -> str:
    ks = [int(m.group(2)) for m in (_LABEL_RE.match(p) for p in pv.files) if m and int(m.group(1)) == major]
    return "v%d.%d" % (major, (max(ks) if ks else 0) + 1)


def _clean(text: str) -> str:
    """One line, no heading markers (an answer must not open a new span)."""
    return " ".join((text or "").replace("#", "").split())


def render(label: str, run: str, clauses: Sequence[Mapping[str, Any]], when_ms: int) -> str:
    lines = ["# Spec addendum %s" % label, "",
             "Answers given by people to the questions of run %s. Each section is one decision; it overrides" % run,
             "the assumptions it names and settles the conflicts it names.", ""]
    for c in clauses:
        lines.append("## %s %s" % (c["qid"], _clean(c["title"])))
        lines.append("")
        lines.append("Decision: %s" % _clean(c["decision"]))
        lines.append("Answer: %s" % _clean(c["answer_text"]))
        if c.get("note"):
            lines.append("Note: %s" % _clean(c["note"]))
        if c.get("f_items"):
            lines.append("F-items: %s" % ", ".join(c["f_items"]))
        if c.get("refs"):
            lines.append("Settles: %s" % ", ".join(c["refs"]))
        lines.append("Answered by: %s" % _clean(c["who"]))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _pack_of(store: Any, run: str, qs: Sequence[Mapping[str, Any]]) -> PackVersion:
    cands = [s(q.get("pack_version")) for q in qs] + [s((store.get(E_PARK, run) or {}).get("pack_version")),
                                                       s((store.get(E_RUN, run) or {}).get("spec_hash"))]
    for v in cands:
        if v:
            row = store.get(E_PACK, v)
            if row:
                return from_dict(PackVersion, row)
    raise LineError(codes.NOT_FOUND, "no frozen pack for run %s" % run, {"run": run, "tried": [c for c in cands if c]})


def make_addendum(store: Any, run: str, answered: Sequence[Mapping[str, Any]], *, cfg: Any = None, clock: Any = None,
                  env: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """answered = answered question rows (human_question). Returns {"label", "version", "parent",
    "base_version", "path", "clauses", "stale_f_items", "pv": PackVersion}."""
    if not answered:
        raise ValueError("make_addendum needs at least one answered question")
    # the newest frozen pack of the run is the parent (questions may predate an earlier addendum)
    run_hash = s((store.get(E_RUN, run) or {}).get("spec_hash"))
    parent = from_dict(PackVersion, store.get(E_PACK, run_hash)) if run_hash and store.get(E_PACK, run_hash) else \
        _pack_of(store, run, answered)
    base = s(answered[0].get("base_version")) or parent.version
    label = next_label(parent, int(setting(cfg, "uplus_pack_major", env)))
    path = "%s/%s.md" % (ADDENDUM_DIR, label)
    now = clock_ms(store, clock)
    clauses = []
    for q in answered:
        ans = q.get("answer") or {}
        refs = [s(r.get("id")).split(":", 1)[-1] for r in q.get("refs") or [] if s(r.get("id"))]
        clauses.append({"qid": s(q.get("qid")) or s(q["id"]).split(":", 1)[-1], "kind": s(q.get("kind")),
                        "title": "%s %s" % (s(q.get("kind")), " ".join(refs)),
                        "decision": s(q.get("decision")), "answer_text": s(ans.get("option_text")) or s(ans.get("text")),
                        "option": s(ans.get("option")), "note": s(ans.get("text")) if s(ans.get("option")) != "other" else "",
                        "who": s(ans.get("who")), "f_items": list(q.get("f_items") or []), "refs": refs,
                        "fingerprint": s(q.get("fingerprint")), "answer": ans,
                        "ref_rows": [dict(r) for r in q.get("refs") or []]})
    text = render(label, run, clauses, now)
    spans = split_spans(path, text)
    by_head = {}
    for sp in spans:
        m = re.match(r"^(Q\d+)\b", sp.heading or "")
        if m:
            by_head[m.group(1)] = sp.id
    for c in clauses:
        c["span_id"] = by_head.get(c["qid"], "")
    files = dict(parent.files)
    files[path] = sha256_bytes(text.encode("utf-8"))
    version = _pack_version(files)
    pv = PackVersion(version=version, pack_id=parent.pack_id, root=parent.root, files=files,
                     spans=list(parent.spans) + spans, frozen_ms=now, remote_version="")
    put(store, E_PACK, version, to_dict(pv), run=run)

    stale = sorted({f for c in clauses for f in c["f_items"]})
    for fid in stale:
        key = rid(run, fid)
        if store.get(E_FITEM, key) is not None:
            merge(store, E_FITEM, key, {"stale": True, "stale_by": label}, run=run)
    for c in clauses:
        for ref in c["ref_rows"]:
            ent, rid_ = s(ref.get("entity")), s(ref.get("id"))
            if ent and rid_ and store.get(ent, rid_) is not None:
                merge(store, ent, rid_, {"addendum": label, "addendum_span": c["span_id"]}, run=run)
        merge(store, E_QUESTION, rid(run, c["qid"]), {"addendum": label, "addendum_span": c["span_id"]}, run=run)

    row = {"id": rid(run, label), "run": run, "label": label, "version": version, "parent": parent.version,
           "base_version": base, "path": path, "text": text, "created_ms": now, "stale_f_items": stale,
           "clauses": [{k: v for k, v in c.items() if k != "ref_rows"} for c in clauses]}
    put(store, E_ADDENDUM, row["id"], row, run=run)
    run_row = store.get(E_RUN, run)
    if run_row is not None:
        detail = dict(run_row.get("detail") or {})
        detail.setdefault("spec_hash_base", run_row.get("spec_hash") or parent.version)
        detail["addenda"] = list(detail.get("addenda") or []) + [label]
        merge(store, E_RUN, run, {"spec_hash": version, "detail": detail, "updated_ms": now}, run=run)
    emit(store, SPEC_ADDENDUM, run, {"label": label, "version": version, "parent": parent.version, "path": path,
                                     "clauses": [c["qid"] for c in clauses], "stale_f_items": stale}, cfg, version)
    return {"label": label, "version": version, "parent": parent.version, "base_version": base, "path": path,
            "clauses": row["clauses"], "stale_f_items": stale, "pv": pv}


def addenda(store: Any, run: str) -> List[Dict[str, Any]]:
    return sorted(store.query(E_ADDENDUM, run=run), key=lambda r: r.get("created_ms", 0))


__all__ = ["make_addendum", "next_label", "addendum_files", "addenda", "render", "ADDENDUM_DIR"]
