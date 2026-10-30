"""Redaction: shared, versioned pattern packs that MASK secrets and PII before storage (design 4.11, D9, D23).

  GET    /v1/redaction/packs                    KH packs (any authenticated person; see LIMITS for service tokens)
  GET    /v1/redaction/packs/{id}@{ver}         one KH pack with its conformance vectors ({id} alone = latest)
  GET    /v1/{ns}/redaction/packs               KH packs + this namespace's own packs
  GET    /v1/{ns}/redaction/packs/{id}@{ver}    one pack (KH or own)
  PUT    /v1/{ns}/redaction/packs/{id}@{ver}    namespace admin: upload an own pack (immutable, must pass its vectors)
  GET    /v1/{ns}/redaction                     the selection: packs, where it came from, the resolved packs
  PUT    /v1/{ns}/redaction  {packs:[...]}      namespace admin: select packs (If-Match on the selection rev)
  DELETE /v1/{ns}/redaction                     namespace admin: drop the API selection, back to the manifest
  POST   /v1/{ns}/redaction:scan  {text}        -> {masked, findings} (stores nothing, no canary scan)
  POST   /v1/{ns}/redaction:verify              runs the conformance vectors of every selected pack

SELECTION. The packs of a namespace are, first hit wins: the ``PUT /v1/{ns}/redaction`` selection, else the
manifest's ``redaction.packs``, else nothing; ``kh-default`` (latest version) is always added in front when the
selection does not name it. A ref is ``id@ver`` (pinned) or ``id`` (latest). A ref that does not resolve is
skipped and reported as ``missing`` by GET; kh-default always applies. Cached per instance for registry.CACHE_S.

THE SCANNER is specified by data (each pack's ``spec`` field), so a consumer's verifier can load the same pack
version and both sides prove it on ``vectors`` (D9). See ``Scanner.scan``.

WRITE-PATH HOOK. ``scrub(ctx, where, body) -> body`` masks every string inside a JSON value (keys are left
alone), writes ``kh.redacted`` (names, kinds and JSON pointers, never the value) and ``kh.canary_hit``, and
raises 422 ``redaction_refused`` when a ``refuse`` pattern matched. Call it BEFORE validation and storage and
OUTSIDE any open transaction (it writes kh.* events). It is a no-op when the capability is switched off.
``attach`` registers it as an event-store body filter (``events.BODY_FILTERS``); records, rules ``source_text``,
pack parts, items and metrics ``dims_json`` call ``redact.scrub`` on their own write path.

CANARY HOOK POINT (for the vault, F11). ``register_canary_scanner(fn)`` with ``fn(ns, text) -> iterable of
{"start", "end", "vault", "item", ...}``. Every scrubbed string is offered to it; a hit is masked as
``[REDACTED:canary]``, the write is still stored (D10) and ``kh.canary_hit {vault, item, principal, run_id,
unit_id, where, pointer}`` is written. A scanner must never put the canary text in its hit.
"""
from __future__ import annotations

import asyncio
import collections
import json
import logging
import math
import os
import re
import threading
import time
from typing import Callable, Iterable

from fastapi import Depends, Request

from app import sqldb
from app.caps import core, registry
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "redaction"
VERSION = "1.0.0"
STATUS = "beta"
DEFAULT_PACK = "kh-default"
KH_OWNER = "_kh"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "redact")

MAX_PATTERNS = 100
MAX_REGEX = 512
MAX_VECTORS = 500
MAX_PACK_BYTES = 256 * 1024
MAX_SELECTED = 8
MAX_SCAN_BYTES = 256 * 1024
LIMITS = {"patterns_per_pack": MAX_PATTERNS, "regex_chars": MAX_REGEX, "vectors_per_pack": MAX_VECTORS,
          "pack_bytes": MAX_PACK_BYTES, "packs_per_ns": MAX_SELECTED, "scan_bytes": MAX_SCAN_BYTES,
          "default_pack": DEFAULT_PACK}

PACK_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{1,63}$")
PATTERN_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
REF_RE = re.compile(r"^([a-z][a-z0-9._-]{1,63})(?:@([1-9][0-9]{0,5}))?$")
KINDS = ("secret", "pii")
MODES = ("mask", "refuse")
#: Rough guard against catastrophic backtracking in consumer regexes: a quantified group that itself holds a
#: quantifier, e.g. (a+)+ or (\w*x)*. Python's re has no timeout, so such patterns are refused at upload.
_NESTED_QUANT = re.compile(r"\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{]")
SPEC = ("Scan each string. Every pattern contributes all non-overlapping matches of re.finditer (Python re "
        "semantics, inline flags only). A pattern with min_entropy keeps a match only when the Shannon entropy "
        "(bits per character) of the matched text is >= min_entropy. Sort the kept matches by (start, -length, "
        "pattern order across the selected packs in selection order); merge overlapping spans (a span starting "
        "before the current end extends it) and label a merged span with the name of its first match. Replace "
        "each span with [REDACTED:<name>]. A finding of mode refuse refuses the write (422). Masked text scans "
        "clean.")

_DDL_PACK = ("""CREATE TABLE IF NOT EXISTS kh_redact_pack (
                  ns TEXT NOT NULL, pack_id TEXT NOT NULL, version INTEGER NOT NULL, description TEXT,
                  patterns_json TEXT NOT NULL, vectors_json TEXT NOT NULL, sha256 TEXT NOT NULL,
                  created_ms INTEGER NOT NULL, actor_json TEXT NOT NULL, PRIMARY KEY (ns, pack_id, version))""",
             """CREATE COLUMN TABLE kh_redact_pack (
                  ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL, version BIGINT NOT NULL,
                  description NVARCHAR(1000), patterns_json NCLOB NOT NULL, vectors_json NCLOB NOT NULL,
                  sha256 NVARCHAR(64) NOT NULL, created_ms BIGINT NOT NULL, actor_json NCLOB NOT NULL,
                  PRIMARY KEY (ns, pack_id, version))""")
_DDL_NS = ("""CREATE TABLE IF NOT EXISTS kh_redact_ns (
                ns TEXT NOT NULL, packs_json TEXT NOT NULL, updated_ms INTEGER NOT NULL, actor_json TEXT NOT NULL,
                rev INTEGER NOT NULL, PRIMARY KEY (ns))""",
           """CREATE COLUMN TABLE kh_redact_ns (
                ns NVARCHAR(32) NOT NULL, packs_json NCLOB NOT NULL, updated_ms BIGINT NOT NULL,
                actor_json NCLOB NOT NULL, rev BIGINT NOT NULL, PRIMARY KEY (ns))""")
TABLES = ["kh_redact_pack", "kh_redact_ns"]


def _m1(c) -> None:
    sqldb.create_table(c, "kh_redact_pack", *_DDL_PACK)
    sqldb.create_table(c, "kh_redact_ns", *_DDL_NS)


# ── packs: validation, hashing, the shipped data files ───────────────────────

def entropy(s: str) -> float:
    """Shannon entropy in bits per character."""
    n = len(s)
    if not n:
        return 0.0
    return -sum((k / n) * math.log2(k / n) for k in collections.Counter(s).values())


def pack_sha(patterns: list, vectors: list) -> str:
    return core.sha256_json({"patterns": patterns, "vectors": vectors})


def parse_ref(ref: str) -> tuple[str, int | None]:
    m = REF_RE.match(ref or "")
    if not m:
        raise CapError("invalid", f"a pack ref is <id> or <id>@<version>, got {ref!r}")
    return m.group(1), int(m.group(2)) if m.group(2) else None


def _err(errors: list, pointer: str, message: str) -> None:
    errors.append({"pointer": pointer, "message": message})


def validate_pack(patterns, vectors, strict: bool = True) -> list[dict]:
    """Errors in a pack's patterns and vectors. ``strict`` (uploads) adds the backtracking guard and requires
    every pattern to be exercised by at least one vector."""
    errors: list[dict] = []
    if not isinstance(patterns, list) or not patterns:
        return [{"pointer": "/patterns", "message": "patterns must be a non-empty list"}]
    if len(patterns) > MAX_PATTERNS:
        _err(errors, "/patterns", f"at most {MAX_PATTERNS} patterns")
    names = set()
    for i, p in enumerate(patterns):
        w = f"/patterns/{i}"
        if not isinstance(p, dict):
            _err(errors, w, "a pattern is an object")
            continue
        extra = set(p) - {"name", "regex", "mode", "kind", "min_entropy", "description"}
        if extra:
            _err(errors, w, f"unknown fields {sorted(extra)}")
        if not PATTERN_NAME_RE.match(str(p.get("name") or "")) or p.get("name") == "canary":
            _err(errors, w + "/name", "name: [a-z][a-z0-9_]{0,47}, not 'canary'")
        names.add(p.get("name"))
        if p.get("mode", "mask") not in MODES:
            _err(errors, w + "/mode", f"mode is one of {MODES}")
        if p.get("kind") not in KINDS:
            _err(errors, w + "/kind", f"kind is one of {KINDS}")
        me = p.get("min_entropy")
        if me is not None and (not isinstance(me, (int, float)) or isinstance(me, bool) or not 0 < me <= 8):
            _err(errors, w + "/min_entropy", "min_entropy is a number in (0, 8]")
        rx = p.get("regex")
        if not isinstance(rx, str) or not rx or len(rx) > MAX_REGEX:
            _err(errors, w + "/regex", f"regex is a string of 1-{MAX_REGEX} characters")
            continue
        try:
            compiled = re.compile(rx)
        except re.error as exc:
            _err(errors, w + "/regex", f"does not compile: {exc}")
            continue
        if compiled.search("") is not None:
            _err(errors, w + "/regex", "regex matches the empty string")
        if strict and _NESTED_QUANT.search(rx):
            _err(errors, w + "/regex", "nested quantifiers (catastrophic backtracking risk) are not accepted")
    if not isinstance(vectors, list) or (strict and not vectors):
        _err(errors, "/vectors", "vectors must be a non-empty list of {text, findings, masked?, refused?}")
        return errors
    if len(vectors) > MAX_VECTORS:
        _err(errors, "/vectors", f"at most {MAX_VECTORS} vectors")
    exercised = set()
    for i, v in enumerate(vectors):
        w = f"/vectors/{i}"
        if not isinstance(v, dict) or not isinstance(v.get("text"), str) or not isinstance(v.get("findings"), list) \
                or not all(isinstance(x, str) for x in v["findings"]):
            _err(errors, w, "a vector is {text: str, findings: [pattern names], masked?: str, refused?: bool}")
            continue
        if "masked" in v and not isinstance(v["masked"], str):
            _err(errors, w + "/masked", "masked is a string")
        if "refused" in v and not isinstance(v["refused"], bool):
            _err(errors, w + "/refused", "refused is a boolean")
        unknown = set(v["findings"]) - names
        if unknown:
            _err(errors, w + "/findings", f"unknown pattern names {sorted(unknown)}")
        exercised |= set(v["findings"])
    if strict and not errors:
        idle = sorted(n for n in names - exercised if n)
        if idle:
            _err(errors, "/vectors", f"every pattern needs a vector that finds it; none for {idle}")
    return errors


def _norm_patterns(patterns: list) -> list[dict]:
    out = []
    for p in patterns:
        q = {"name": p["name"], "kind": p["kind"], "mode": p.get("mode", "mask"), "regex": p["regex"]}
        if p.get("min_entropy") is not None:
            q["min_entropy"] = float(p["min_entropy"])
        if p.get("description"):
            q["description"] = str(p["description"])[:500]
        out.append(q)
    return out


def shipped_packs() -> list[dict]:
    """The KH packs shipped as data files (app/caps/data/redact/<id>.v<ver>.json)."""
    out = []
    for fn in sorted(os.listdir(DATA_DIR)) if os.path.isdir(DATA_DIR) else []:
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(DATA_DIR, fn), encoding="utf-8") as f:
            doc = json.load(f)
        errors = validate_pack(doc.get("patterns"), doc.get("vectors"), strict=False)
        if errors:
            raise ValueError(f"shipped redaction pack {fn} is invalid: {errors}")
        patterns = _norm_patterns(doc["patterns"])
        out.append({"ns": KH_OWNER, "pack_id": doc["pack_id"], "version": int(doc["version"]),
                    "description": doc.get("description") or "", "patterns": patterns, "vectors": doc["vectors"],
                    "sha256": pack_sha(patterns, doc["vectors"])})
    return out


def _seed(c) -> None:
    """Insert every shipped pack version that is not stored yet (first insert wins; versions are immutable)."""
    for p in shipped_packs():
        now = sqldb.now_ms(c)
        if not sqldb.insert_new(c, "kh_redact_pack", {
                "ns": KH_OWNER, "pack_id": p["pack_id"], "version": p["version"], "description": p["description"],
                "patterns_json": core.jdump(p["patterns"]), "vectors_json": core.jdump(p["vectors"]),
                "sha256": p["sha256"], "created_ms": now, "actor_json": core.jdump({"principal": "kh"})}):
            r = c.execute("SELECT sha256 FROM kh_redact_pack WHERE ns=? AND pack_id=? AND version=?",
                          [KH_OWNER, p["pack_id"], p["version"]]).fetchone()
            if r is not None and r["sha256"] != p["sha256"]:
                logger.error("redaction pack %s@%s differs from the stored version: ship a new version instead",
                             p["pack_id"], p["version"])


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])
    _seed(c)


# ── the scanner ──────────────────────────────────────────────────────────────

class _Pat:
    __slots__ = ("name", "kind", "mode", "rx", "min_entropy", "pack")

    def __init__(self, p: dict, pack: str):
        self.name, self.kind, self.mode, self.pack = p["name"], p["kind"], p.get("mode", "mask"), pack
        self.rx = re.compile(p["regex"])
        self.min_entropy = p.get("min_entropy")


class Scanner:
    """The patterns of one or more packs, in selection order (see SPEC)."""

    def __init__(self, packs: list[dict]):
        self.refs = [f"{p['pack_id']}@{p['version']}" for p in packs]
        self.patterns = [_Pat(x, f"{p['pack_id']}@{p['version']}") for p in packs for x in p["patterns"]]

    def matches(self, text: str) -> list[tuple]:
        """Kept matches as (start, end, order, pattern)."""
        out = []
        for order, pat in enumerate(self.patterns):
            for m in pat.rx.finditer(text):
                if m.end() <= m.start():
                    continue
                if pat.min_entropy is not None and entropy(m.group(0)) < pat.min_entropy:
                    continue
                out.append((m.start(), m.end(), order, pat))
        return out

    def scan(self, text: str, extra: Iterable[dict] = ()) -> tuple[str, list[dict]]:
        """(masked text, findings). ``extra`` are canary hits {start, end, ...}; they label their span 'canary'."""
        if not text:
            return text, []
        spans = [(s, e, o, p) for s, e, o, p in self.matches(text)]
        for h in extra:
            s, e = int(h["start"]), int(h["end"])
            if 0 <= s < e <= len(text):
                spans.append((s, e, -1, h))
        if not spans:
            return text, []
        spans.sort(key=lambda x: (x[0], -(x[1] - x[0]), x[2]))
        merged: list[list] = []
        for s, e, o, p in spans:
            if merged and s < merged[-1][1]:
                cur = merged[-1]
                cur[1] = max(cur[1], e)
                cur[2].append(p)
            else:
                merged.append([s, e, [p]])
        findings, parts, pos = [], [], 0
        for s, e, members in merged:
            canaries = [m for m in members if isinstance(m, dict)]
            pats = [m for m in members if not isinstance(m, dict)]
            parts.append(text[pos:s])
            parts.append(f"[REDACTED:{'canary' if canaries else pats[0].name}]")     # a canary always wins
            pos = e
            if pats:
                lead = pats[0]
                findings.append({"name": lead.name, "kind": lead.kind,
                                 "mode": "refuse" if any(p.mode == "refuse" for p in pats) else "mask",
                                 "pack": lead.pack, "start": s, "end": e})
            for h in canaries:
                findings.append({"name": "canary", "kind": "canary", "mode": "mask", "start": s, "end": e,
                                 "canary": {k: v for k, v in h.items()
                                            if k not in ("start", "end", "value", "text", "canary")}})
        parts.append(text[pos:])
        return "".join(parts), findings


def verify_vectors(packs: list[dict]) -> list[dict]:
    """Run each pack's vectors against that pack alone: [{ref, vectors, passed, failures}]."""
    out = []
    for p in packs:
        sc = Scanner([p])
        failures = []
        for i, v in enumerate(p.get("vectors") or []):
            masked, found = sc.scan(v["text"])
            names = [f["name"] for f in found]
            refused = any(f["mode"] == "refuse" for f in found)
            why = []
            if sorted(names) != sorted(v["findings"]):
                why.append(f"findings {names} != {v['findings']}")
            if "masked" in v and masked != v["masked"]:
                why.append(f"masked {masked!r} != {v['masked']!r}")
            if refused != bool(v.get("refused", False)):
                why.append(f"refused {refused} != {bool(v.get('refused', False))}")
            if not refused and sc.scan(masked)[1]:
                why.append("masked text does not scan clean")
            if why:
                failures.append({"index": i, "why": why})
        n = len(p.get("vectors") or [])
        out.append({"ref": f"{p['pack_id']}@{p['version']}", "sha256": p.get("sha256"), "vectors": n,
                    "passed": n - len(failures), "failures": failures})
    return out


# ── pack storage and selection ───────────────────────────────────────────────

_compiled: dict[tuple, Scanner] = {}
_sel_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
_default_scanner: list[Scanner] = []


def default_scanner() -> Scanner:
    """kh-default (latest shipped version) straight from the data files: no database (the distil leak gate)."""
    if not _default_scanner:
        packs = [p for p in shipped_packs() if p["pack_id"] == DEFAULT_PACK]
        _default_scanner.append(Scanner([max(packs, key=lambda p: p["version"])]))
    return _default_scanner[0]


def _decode_pack(r) -> dict:
    return {"pack_id": r["pack_id"], "version": int(r["version"]), "owner": r["ns"],
            "description": r["description"] or "", "patterns": json.loads(r["patterns_json"]),
            "vectors": json.loads(r["vectors_json"]), "sha256": r["sha256"], "created_ms": int(r["created_ms"])}


def get_pack(c, ns: str | None, pack_id: str, version: int | None) -> dict | None:
    """A pack visible to ``ns`` (its own packs, then KH's); ``ns`` None = KH packs only. version None = latest."""
    owners = [KH_OWNER] if ns is None or pack_id.startswith("kh-") else [ns]
    for owner in owners:
        if version is None:
            r = c.execute("SELECT * FROM kh_redact_pack WHERE ns=? AND pack_id=? ORDER BY version DESC LIMIT 1",
                          [owner, pack_id]).fetchone()
        else:
            r = c.execute("SELECT * FROM kh_redact_pack WHERE ns=? AND pack_id=? AND version=?",
                          [owner, pack_id, int(version)]).fetchone()
        if r is not None:
            return _decode_pack(r)
    return None


def list_packs(c, ns: str | None) -> list[dict]:
    owners = [KH_OWNER] + ([ns] if ns else [])
    rows = c.execute(f"SELECT ns, pack_id, version, description, sha256, created_ms FROM kh_redact_pack WHERE ns IN "
                     f"({','.join('?' for _ in owners)}) ORDER BY pack_id, version", owners).fetchall()
    return [{"pack_id": r["pack_id"], "version": int(r["version"]), "ref": f"{r['pack_id']}@{r['version']}",
             "owner": "kh" if r["ns"] == KH_OWNER else r["ns"], "description": r["description"] or "",
             "sha256": r["sha256"]} for r in rows]


def _selection(c, ns: str, ns_row: dict) -> tuple[list[str], str, int]:
    """(refs as configured, source api|manifest|default, rev of the API selection or 0)."""
    r = c.execute("SELECT packs_json, rev FROM kh_redact_ns WHERE ns=?", [ns]).fetchone()
    if r is not None:
        return json.loads(r["packs_json"]), "api", int(r["rev"])
    man = ((ns_row.get("config") or {}).get("redaction") or {}).get("packs")
    if isinstance(man, list) and man:
        return [str(x) for x in man], "manifest", 0
    return [], "default", 0


def _with_default(refs: list[str]) -> list[str]:
    ids = []
    for ref in refs:
        m = REF_RE.match(ref)
        ids.append(m.group(1) if m else None)
    return refs if DEFAULT_PACK in ids else [DEFAULT_PACK] + refs


def resolve(ns: str, ns_row: dict, fresh: bool = False) -> dict:
    """{packs (configured), source, rev, effective:[pack], missing:[ref], scanner} for a namespace (cached)."""
    now = time.monotonic()
    hit = _sel_cache.get(ns)
    if hit and hit[0] > now and not fresh:
        return hit[1]
    with sqldb.connect() as c:
        refs, source, rev = _selection(c, ns, ns_row)
        effective, missing = [], []
        for ref in _with_default(refs)[: MAX_SELECTED + 1]:
            m = REF_RE.match(ref)
            p = get_pack(c, ns, m.group(1), int(m.group(2)) if m and m.group(2) else None) if m else None
            if p is None:
                missing.append(ref)
            elif not any(e["pack_id"] == p["pack_id"] and e["version"] == p["version"] for e in effective):
                effective.append(p)
    key = tuple((p["owner"], p["pack_id"], p["version"]) for p in effective)
    with _lock:
        sc = _compiled.get(key)
        if sc is None:
            sc = _compiled[key] = Scanner(effective)
    out = {"packs": refs, "source": source, "rev": rev, "effective": effective, "missing": missing, "scanner": sc}
    _sel_cache[ns] = (now + registry.CACHE_S, out)
    return out


def invalidate(ns: str | None = None) -> None:
    if ns is None:
        _sel_cache.clear()
    else:
        _sel_cache.pop(ns, None)


# ── the write-path hook ──────────────────────────────────────────────────────

#: Canary scanners (vault, F11): fn(ns, text) -> iterable of {start, end, vault, item, ...}. Never the canary text.
CANARY_SCANNERS: list[Callable] = []


def register_canary_scanner(fn: Callable) -> None:
    if fn not in CANARY_SCANNERS:
        CANARY_SCANNERS.append(fn)


_active = [False]          # set by attach: scrub is a no-op while the capability is off


def _canaries(ns: str, text: str) -> list[dict]:
    hits = []
    for fn in CANARY_SCANNERS:
        try:
            hits += [dict(h) for h in (fn(ns, text) or [])]
        except Exception:
            logger.exception("canary scanner failed for %s", ns)
    return hits


def _ptr(parts: list) -> str:
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in parts)


def scan_value(scanner: Scanner, value, ns: str | None = None, canaries: bool = True):
    """(masked copy of a JSON value, findings with ``pointer``). Strings are scanned; keys are not."""
    findings: list[dict] = []

    def walk(v, path):
        if isinstance(v, str):
            extra = _canaries(ns, v) if canaries and ns and CANARY_SCANNERS else ()
            masked, found = scanner.scan(v, extra)
            for f in found:
                f["pointer"] = _ptr(path)
            findings.extend(found)
            return masked
        if isinstance(v, dict):
            return {k: walk(x, path + [k]) for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x, path + [i]) for i, x in enumerate(v)]
        return v
    return walk(value, []), findings


def scrub(ctx: Ctx, where: str, body):
    """THE write-path hook: mask ``body`` (any JSON value) before validation and storage. See the module doc."""
    if not _active[0]:
        return body
    sel = resolve(ctx.ns, ctx.ns_row)
    masked, findings = scan_value(sel["scanner"], body, ctx.ns)
    if not findings:
        return body
    pats = [f for f in findings if f["kind"] != "canary"]
    refused = [f for f in pats if f["mode"] == "refuse"]
    if pats:
        core.emit(ctx, "kh.redacted", {
            "where": where, "count": len(pats), "refused": bool(refused), "packs": sel["scanner"].refs,
            "findings": [{k: f[k] for k in ("name", "kind", "mode", "pack", "pointer")} for f in pats[:100]]})
    for f in findings:
        if f["kind"] == "canary":
            a = ctx.actor()
            core.emit(ctx, "kh.canary_hit", {**f["canary"], "principal": a["principal"], "run_id": a["run_id"],
                                             "unit_id": a["unit_id"], "where": where, "pointer": f["pointer"]})
    if refused:
        names = ", ".join(sorted({f"{f['name']} at {f['pointer'] or '/'}" for f in refused}))
        raise CapError("redaction_refused", f"refused by redaction: {names}", status=422,
                       extra={"findings": [{k: f[k] for k in ("name", "kind", "pack", "pointer")} for f in refused]})
    return masked


def _events_filter(ctx: Ctx, where: str, body):
    return scrub(ctx, where, body)


def _on_state(c, ns: str, old: str, new: str) -> None:       # noqa: ARG001
    if new == "purged":
        c.execute("DELETE FROM kh_redact_ns WHERE ns=?", [ns])
        c.execute("DELETE FROM kh_redact_pack WHERE ns=?", [ns])
    invalidate(ns)


# ── route helpers ────────────────────────────────────────────────────────────

def _public(p: dict) -> dict:
    return {"pack_id": p["pack_id"], "version": p["version"], "ref": f"{p['pack_id']}@{p['version']}",
            "owner": "kh" if p["owner"] == KH_OWNER else p["owner"], "description": p["description"],
            "patterns": p["patterns"], "vectors": p["vectors"], "sha256": p["sha256"], "spec": SPEC}


def _read_pack(ns: str | None, ref: str) -> dict:
    pack_id, ver = parse_ref(ref)
    with sqldb.connect() as c:
        p = get_pack(c, ns, pack_id, ver)
    if p is None:
        raise CapError("not_found", f"no redaction pack {ref}")
    return _public(p)


def put_pack(ctx: Ctx, ref: str, doc: dict) -> tuple[int, dict]:
    ctx.require_admin()
    pack_id, ver = parse_ref(ref)
    if ver is None:
        raise CapError("invalid", "upload a pinned version: <id>@<version>")
    if pack_id.startswith("kh-"):
        raise CapError("forbidden", "the kh- prefix is reserved for KH packs")
    if not isinstance(doc, dict):
        raise CapError("invalid", "body must be {patterns, vectors, description?}")
    if len(core.jdump(doc).encode("utf-8")) > MAX_PACK_BYTES:
        raise CapError("too_large", f"a pack is at most {MAX_PACK_BYTES} bytes")
    errors = validate_pack(doc.get("patterns"), doc.get("vectors"))
    if errors:
        raise CapError("validation_failed", "invalid redaction pack", extra={"errors": errors})
    patterns, vectors = _norm_patterns(doc["patterns"]), doc["vectors"]
    sha = pack_sha(patterns, vectors)
    pack = {"pack_id": pack_id, "version": ver, "owner": ctx.ns, "description": str(doc.get("description") or "")[:1000],
            "patterns": patterns, "vectors": vectors, "sha256": sha}
    report = verify_vectors([pack])[0]
    if report["failures"]:
        raise CapError("validation_failed", "the pack does not pass its own conformance vectors",
                       extra={"conformance": report})
    with sqldb.connect() as c:
        created = sqldb.insert_new(c, "kh_redact_pack", {
            "ns": ctx.ns, "pack_id": pack_id, "version": ver, "description": pack["description"],
            "patterns_json": core.jdump(patterns), "vectors_json": core.jdump(vectors), "sha256": sha,
            "created_ms": sqldb.now_ms(c), "actor_json": core.jdump(ctx.actor())})
        if not created:
            old = c.execute("SELECT sha256 FROM kh_redact_pack WHERE ns=? AND pack_id=? AND version=?",
                            [ctx.ns, pack_id, ver]).fetchone()
            if old["sha256"] != sha:
                raise CapError("pack_immutable", f"{pack_id}@{ver} exists with other content; publish a new version",
                               status=409, extra={"sha256": old["sha256"]})
    invalidate(ctx.ns)
    return (201 if created else 200), {"ref": f"{pack_id}@{ver}", "sha256": sha, "created": created,
                                       "conformance": report}


def put_selection(ctx: Ctx, doc: dict) -> tuple[int, dict, int]:
    ctx.require_admin()
    refs = doc.get("packs") if isinstance(doc, dict) else None
    if not isinstance(refs, list) or not all(isinstance(r, str) for r in refs) or len(refs) > MAX_SELECTED:
        raise CapError("invalid", f"body is {{packs: [<id>@<ver> | <id>, ...]}} with at most {MAX_SELECTED} refs")
    if len(set(refs)) != len(refs):
        raise CapError("invalid", "a pack ref is listed twice")
    expected = core.if_match(ctx.request)
    with sqldb.connect() as c:
        missing = []
        for ref in refs:
            pack_id, ver = parse_ref(ref)
            if get_pack(c, ctx.ns, pack_id, ver) is None:
                missing.append(ref)
        if missing:
            raise CapError("validation_failed", "unknown redaction packs", extra={"missing": missing})
        now = sqldb.now_ms(c)
        row = {"packs_json": core.jdump(refs), "updated_ms": now, "actor_json": core.jdump(ctx.actor())}
        if expected is None and sqldb.insert_new(c, "kh_redact_ns", {"ns": ctx.ns, **row, "rev": 1}):
            rev, status = 1, 201
        else:          # If-Match given (conditional) or the row exists (last writer wins); 404 when missing
            rev, status = core.cas_update(ctx, c, "kh_redact_ns", {"ns": ctx.ns}, row, expected), 200
    invalidate(ctx.ns)
    return status, selection_view(ctx, fresh=True), rev


def delete_selection(ctx: Ctx) -> dict:
    ctx.require_admin()
    with sqldb.connect() as c:
        c.execute("DELETE FROM kh_redact_ns WHERE ns=?", [ctx.ns])
    invalidate(ctx.ns)
    return selection_view(ctx, fresh=True)


def selection_view(ctx: Ctx, fresh: bool = False) -> dict:
    sel = resolve(ctx.ns, ctx.ns_row, fresh=fresh)
    return {"packs": sel["packs"], "source": sel["source"], "rev": sel["rev"], "missing": sel["missing"],
            "effective": [{"ref": f"{p['pack_id']}@{p['version']}", "owner": "kh" if p["owner"] == KH_OWNER
                           else p["owner"], "sha256": p["sha256"]} for p in sel["effective"]]}


def _person_or_local() -> None:
    """GET /v1/redaction/packs*: any authenticated caller (the auth middleware lets persons through the ns rule)."""
    from app import auth
    if auth.current() is None and auth.enabled():
        raise CapError("unauthorized", "sign in first")


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    from app.caps import events
    TAG = ["v1 redaction"]
    _active[0] = True
    filters = getattr(events, "BODY_FILTERS", None)
    if filters is not None and _events_filter not in filters:
        filters.append(_events_filter)
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)

    # KH-wide packs. Registered before any /v1/{ns}/packs route of a later module; 'redaction' is a reserved ns.
    @app.get("/v1/redaction/packs", tags=TAG, summary="KH redaction packs")
    async def kh_packs():
        _person_or_local()

        def run():
            with sqldb.connect() as c:
                return list_packs(c, None)
        return {"packs": await asyncio.to_thread(run)}

    @app.get("/v1/redaction/packs/{ref}", tags=TAG, summary="One KH pack with its conformance vectors")
    async def kh_pack(ref: str):
        _person_or_local()
        return await asyncio.to_thread(_read_pack, None, ref)

    @app.get("/v1/{ns}/redaction/packs", tags=TAG, summary="KH packs plus this namespace's own packs")
    async def ns_packs(ns: str, ctx: Ctx = Depends(ns_ctx)):
        def run():
            with sqldb.connect() as c:
                return list_packs(c, ns)
        return {"packs": await asyncio.to_thread(run)}

    @app.get("/v1/{ns}/redaction/packs/{ref}", tags=TAG, summary="One pack (KH or own) with its vectors")
    async def ns_pack(ns: str, ref: str, ctx: Ctx = Depends(ns_ctx)):
        return await asyncio.to_thread(_read_pack, ns, ref)

    @app.put("/v1/{ns}/redaction/packs/{ref}", tags=TAG, summary="Upload an own pack version (admin, immutable)")
    @core.idempotent
    async def ns_pack_put(request: Request, ns: str, ref: str, ctx: Ctx = Depends(ns_ctx)):
        doc = await _json(request)
        status, out = await asyncio.to_thread(put_pack, ctx, ref, doc)
        return core.reply(status, out)

    @app.get("/v1/{ns}/redaction", tags=TAG, summary="The namespace's pack selection")
    async def sel_get(ns: str, ctx: Ctx = Depends(ns_ctx)):
        out = await asyncio.to_thread(selection_view, ctx)
        return core.reply(200, out, {"ETag": core.etag(out["rev"])} if out["rev"] else None)

    @app.put("/v1/{ns}/redaction", tags=TAG, summary="Select the packs of the namespace (admin)")
    @core.idempotent
    async def sel_put(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        doc = await _json(request)
        status, out, rev = await asyncio.to_thread(put_selection, ctx, doc)
        return core.reply(status, out, {"ETag": core.etag(rev)})

    @app.delete("/v1/{ns}/redaction", tags=TAG, summary="Drop the API selection (back to the manifest)")
    async def sel_delete(ns: str, ctx: Ctx = Depends(ns_ctx)):
        return await asyncio.to_thread(delete_selection, ctx)

    @app.post("/v1/{ns}/redaction:scan", tags=TAG, summary="Mask a text with the namespace's packs")
    async def scan(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        doc = await _json(request)
        text = doc.get("text") if isinstance(doc, dict) else None
        if not isinstance(text, str):
            raise CapError("invalid", "body is {text: str}")
        if len(text.encode("utf-8")) > MAX_SCAN_BYTES:
            raise CapError("too_large", f"at most {MAX_SCAN_BYTES} bytes")

        def run():
            sel = resolve(ns, ctx.ns_row)
            masked, found = sel["scanner"].scan(text)         # no canary scanners: never a canary oracle
            return {"masked": masked, "findings": found, "refused": any(f["mode"] == "refuse" for f in found),
                    "packs": sel["scanner"].refs}
        return await asyncio.to_thread(run)

    @app.post("/v1/{ns}/redaction:verify", tags=TAG, summary="Run the conformance vectors of the selected packs")
    async def verify(ns: str, ctx: Ctx = Depends(ns_ctx)):
        def run():
            sel = resolve(ns, ctx.ns_row)
            rep = verify_vectors(sel["effective"])
            return {"packs": rep, "missing": sel["missing"], "all_passed": all(not r["failures"] for r in rep)}
        return await asyncio.to_thread(run)


async def _json(request: Request):
    try:
        return json.loads(await request.body() or b"null")
    except ValueError:
        raise CapError("invalid", "body must be JSON")
