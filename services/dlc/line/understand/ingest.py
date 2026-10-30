"""Block 5: ingest and freeze a spec pack.

ingest(pack_dir, store, rag=None, *, run="") -> PackVersion

  * pack.json is required; it names the required files ("required", or "template": {"required": [..]})
    and optionally the files to ingest ("files"; default: required + every .md/.txt under the
    pack, skipping hidden dirs and the "dry" fixture dir).
  * .md/.txt are read as they are; PDF and Word (.docx) documents are converted to markdown on the way in
    (line.docread: text and tables, no OCR) and versioned by their original bytes; a missing, empty or
    unreadable required file (a scanned PDF, an old .doc, say) -> LineError(SPEC_MISSING_FILE).
  * text is normalised: BOM, CRLF, zero-width / bidi / Unicode tag chars removed, HTML
    comments blanked (newlines kept so line numbers still match the file on disk).
  * files are split by markdown heading into spans "<path>#L<start>-<end>" (1-based, inclusive).
  * version = sha256 over sorted (path, sha256(raw bytes)): any byte change is a new version.
    Content addressed: a version already in the store is reused, not re-parsed.
  * the pack is pushed to rag.freeze_pack when a RAG System is given; failure there
    degrades (event rag.degraded) and never stops ingest.
  * emits spec.frozen.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from .. import codes
from ..codes import LineError
from ..config import Config
from ..contracts import E_PACK, PackVersion, RagPort, Span, SpecPack, Store, from_dict, now_ms, span_id, to_dict
from ._common import emit, envelope, sha256_bytes, sha256_text

READABLE = (".md", ".txt")
DOCUMENTS = (".pdf", ".docx")                 # converted to markdown by line.docread
SKIP_DIRS = frozenset({"dry", "__pycache__"})

#: zero-width, bidi controls, word joiners, BOM, soft hyphen, Unicode tag block
_INVISIBLE_RE = re.compile("[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿\U000e0000-\U000e007f]")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_HEADING_RE = re.compile(r"^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_FENCE_RE = re.compile(r"^ {0,3}(```|~~~)")


def normalize(text: str) -> str:
    """Remove invisible characters and HTML comments; keep the line count unchanged."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _INVISIBLE_RE.sub("", text)
    return _COMMENT_RE.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def split_spans(path: str, text: str) -> List[Span]:
    """Split normalised text into heading sections. Blank sections are skipped; trailing
    blank lines are not part of a span."""
    lines = text.split("\n")
    starts: List[Tuple[int, str]] = []   # (0-based line index, heading)
    fenced = False
    for i, line in enumerate(lines):
        if _FENCE_RE.match(line):
            fenced = not fenced
            continue
        if not fenced:
            m = _HEADING_RE.match(line)
            if m:
                starts.append((i, m.group(2).strip()))
    if not starts or starts[0][0] != 0:
        starts.insert(0, (0, ""))
    spans: List[Span] = []
    for n, (s, heading) in enumerate(starts):
        e = starts[n + 1][0] - 1 if n + 1 < len(starts) else len(lines) - 1
        while e >= s and not lines[e].strip():
            e -= 1
        if e < s:
            continue
        body = "\n".join(lines[s:e + 1])
        if not body.strip():
            continue
        spans.append(Span(span_id(path, s + 1, e + 1), path, s + 1, e + 1, heading, body, sha256_text(body)))
    return spans


def _rel(root: str, rel: str) -> str:
    rel = str(rel).replace("\\", "/").lstrip("/")
    full = os.path.normpath(os.path.join(root, rel))
    if os.path.commonpath([os.path.abspath(root), os.path.abspath(full)]) != os.path.abspath(root):
        raise LineError(codes.SPEC_MISSING_FILE, "path escapes the pack: %s" % rel, {"path": rel})
    return rel


def load_pack(pack_dir: str) -> SpecPack:
    root = os.path.abspath(pack_dir)
    manifest = os.path.join(root, "pack.json")
    if not os.path.isfile(manifest):
        raise LineError(codes.SPEC_MISSING_FILE, "pack.json missing in %s" % root, {"path": "pack.json", "root": root})
    try:
        with open(manifest, encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, ValueError) as e:
        raise LineError(codes.SPEC_MISSING_FILE, "pack.json unreadable: %s" % e, {"path": "pack.json"}) from e
    if not isinstance(meta, dict):
        raise LineError(codes.SPEC_MISSING_FILE, "pack.json is not an object", {"path": "pack.json"})
    tmpl = meta.get("template") if isinstance(meta.get("template"), dict) else {}
    required = [_rel(root, p) for p in (meta.get("required") or tmpl.get("required") or [])]
    files = [_rel(root, p) for p in (meta.get("files") or [])]
    if not files:
        found = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS)
            for fn in sorted(filenames):
                if fn.lower().endswith(READABLE + DOCUMENTS):
                    found.append(os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/"))
        files = found
    ordered = list(dict.fromkeys(required + files))
    return SpecPack(id=str(meta.get("id") or os.path.basename(root)), root=root,
                    title=str(meta.get("title") or ""), required=required, files=ordered)


def _read(root: str, rel: str, required: bool) -> Tuple[bytes, str]:
    full = os.path.join(root, rel)
    if not rel.lower().endswith(READABLE + DOCUMENTS):   # images, spreadsheets ...: not read
        raise LineError(codes.SPEC_MISSING_FILE, "file %s is not .md/.txt/.pdf/.docx" % rel,
                        {"path": rel, "reason": "unreadable_type"})
    if not os.path.isfile(full):
        raise LineError(codes.SPEC_MISSING_FILE, "missing file %s" % rel, {"path": rel, "reason": "missing"})
    with open(full, "rb") as fh:
        raw = fh.read()
    if rel.lower().endswith(DOCUMENTS):
        from ..docread import DocError, convert_bytes
        try:
            text = normalize(convert_bytes(os.path.basename(rel), raw).text)
        except DocError as e:
            raise LineError(codes.SPEC_MISSING_FILE, "document %s cannot be read: %s" % (rel, e),
                            {"path": rel, "reason": "unreadable_document"}) from e
        return raw, text
    try:
        text = normalize(raw.decode("utf-8-sig"))
    except UnicodeDecodeError as e:
        raise LineError(codes.SPEC_MISSING_FILE, "file %s is not UTF-8" % rel, {"path": rel, "reason": "encoding"}) from e
    if required and not text.strip():
        raise LineError(codes.SPEC_MISSING_FILE, "required file %s is empty" % rel, {"path": rel, "reason": "empty"})
    return raw, text


def pack_version(file_shas: Dict[str, str]) -> str:
    h = []
    for p in sorted(file_shas):
        h.append(p + "\0" + file_shas[p] + "\0")
    return sha256_text("".join(h))


def ingest(pack_dir: str, store: Optional[Store], rag: Optional[RagPort] = None, *, run: str = "",
           cfg: Optional[Config] = None) -> PackVersion:
    """Freeze the pack in pack_dir. run names the run for the spec.frozen event
    (default "pack-<version[:12]>" when ingest runs outside a run)."""
    pack = load_pack(pack_dir)
    raws: Dict[str, bytes] = {}
    texts: Dict[str, str] = {}
    req = set(pack.required)
    for rel in pack.files:
        raws[rel], texts[rel] = _read(pack.root, rel, rel in req)
    if not texts:
        raise LineError(codes.SPEC_MISSING_FILE, "no readable file in pack %s" % pack.id, {"root": pack.root})

    shas = {p: sha256_bytes(b) for p, b in raws.items()}
    version = pack_version(shas)
    cached = False
    row = store.get(E_PACK, version) if store is not None else None
    if row:
        pv = from_dict(PackVersion, row)
        pv.root = pack.root
        cached = True
    else:
        spans: List[Span] = []
        for rel in sorted(texts):
            spans.extend(split_spans(rel, texts[rel]))
        pv = PackVersion(version=version, pack_id=pack.id, root=pack.root, files=shas, spans=spans,
                         frozen_ms=now_ms())

    run_id = run or "pack-" + version[:12]
    env = envelope(run_id, spec_hash=version, cfg=cfg)
    if rag is not None and not pv.remote_version:
        try:
            pv.remote_version = rag.freeze_pack(texts, idem_key="pack:" + version) or ""
        except LineError as e:
            emit(store, codes.RAG_DEGRADED_KIND, env, {"capability": "packs", "error": e.code, "message": e.message})
    if store is not None:
        store.put(E_PACK, version, to_dict(pv), run=run)
    emit(store, codes.SPEC_FROZEN, env, {
        "version": version, "pack_id": pv.pack_id, "title": pack.title, "files": sorted(shas),
        "spans": len(pv.spans), "remote_version": pv.remote_version, "cached": cached,
    })
    return pv


def span_map(pv: PackVersion) -> Dict[str, Span]:
    return {s.id: s for s in pv.spans}


__all__ = ["ingest", "load_pack", "normalize", "split_spans", "pack_version", "span_map", "READABLE"]
