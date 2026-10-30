"""Block 7: gap checklist, assumption register (ASSUMED-n), one round of human questions,
versioned addendum vN.k (design g1, I01, N3; r5h for the questions).

check_gaps(pack, digest, llm, store=, run=) -> dict
  Every F-item of the digest is checked against the 7-slot checklist (SLOTS): input, output,
  errors, limits / empty, units / time zone / rounding, permissions, persistence. The model
  (role "gaps", fixture key "gaps") proposes per slot either
      {"slot", "status": "covered", "span_id", "quote"}          the spec states it
      {"slot", "status": "gap", "assumption", "category", "span_refs", "alternatives"}
  Code validates, never trusts:
    * a covered slot needs a quote that is a literal substring of the named span, else it becomes a
      gap (reason quote_unmatched);
    * a slot the model left out becomes a gap with a code-written "no behaviour assumed" placeholder:
      no slot stays silent (design: "khe trống ... không được im lặng");
    * span_refs are kept only when they name a span of the pack (else the F-item's own spans);
    * sensitivity: the model's category is upgraded by a keyword scan (money, permission, deletion,
      external interface) and a gap in the "permissions" slot is always a permission assumption.
  Each gap becomes an assumption row (entity "assumption", id "<run>:ASSUMED-<n>", state
  proposed | accepted | answered, linked F-items). Non-sensitive assumptions are recorded as
  "accepted" (board + demo list); sensitive ones stay "proposed" and become question drafts. Sensitive
  gaps with the same slot and the same proposed assumption are grouped into one question.
  A slot already settled by an earlier answer (same F-item + slot answered, or now quoted from the
  addendum) is not asked again.

Questions, the addendum and the park are in human.py / addendum.py; gaps.ask() wires them.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import Digest, FItem, LlmPort, PackVersion
from ..understand.readers import render_spans
from ._common import (ASSUMPTION_SENSITIVE, E_ASSUMPTION, GAPS_CHECKED, SENSITIVE_CATEGORIES, SPEC_GAP, clock_ms,
                      emit, fingerprint, local_id, merge, norm, put, quote_ok, rid, rows, s, sensitive_categories)
from ._prompts import load_part

ROLE = "gaps"
KEY = "gaps"

#: design g1 / I01: the 7 slots, in order, with the question each answers
SLOTS: Tuple[Tuple[str, str], ...] = (
    ("input", "what inputs the feature takes, their format and validation"),
    ("output", "what the feature returns or prints, exactly"),
    ("errors", "what happens on bad input or failure (messages, exit codes, error types)"),
    ("limits", "limits, sizes, empty input, boundaries"),
    ("units", "units, time zone, rounding, ordering"),
    ("permissions", "who may do it (permissions, roles)"),
    ("persistence", "what is stored, where, and what survives a restart"),
)
SLOT_NAMES = tuple(n for n, _ in SLOTS)
PROPOSED, ACCEPTED, ANSWERED = "proposed", "accepted", "answered"

_SLOT = {
    "type": "object",
    "required": ["slot", "status"],
    "properties": {
        "slot": {"type": "string"}, "status": {"type": "string", "enum": ["covered", "gap"]},
        "span_id": {"type": "string"}, "quote": {"type": "string"}, "assumption": {"type": "string"},
        "category": {"type": "string"}, "span_refs": {"type": "array", "items": {"type": "string"}},
        "alternatives": {"type": "array", "items": {"type": "string"}},
    },
}
GAPS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["f_items"],
    "properties": {"f_items": {"type": "array", "items": {
        "type": "object", "required": ["id", "slots"],
        "properties": {"id": {"type": "string"}, "slots": {"type": "array", "items": _SLOT}}}}},
}


def _digest_text(digest: Digest) -> str:
    out = []
    for f in digest.f_items:
        out.append("- %s %s (spans: %s)" % (f.id, f.title, ", ".join(f.span_ids)))
        for c in f.criteria:
            out.append("    - %s: given %s / when %s / then %s" % (c.id, c.given, c.when, c.then))
    if digest.rules:
        out.append("Rules:")
        out.extend("- %s (%s)" % (r.text, r.span_id) for r in digest.rules)
    if digest.numbers:
        out.append("Numbers:")
        out.extend("- %s = %s (%s)" % (n.text, n.value, n.span_id) for n in digest.numbers)
    return "\n".join(out)


def build_prompt(pack: PackVersion, digest: Digest) -> str:
    slots = "\n".join("- %s: %s" % (n, q) for n, q in SLOTS)
    return "\n\n".join([load_part("gaps", "check"), "## Slots\n" + slots, "## Digest\n" + _digest_text(digest),
                        "## Spec spans (%d)\n%s" % (len(pack.spans), render_spans(pack.spans))])


def _placeholder(fid: str, slot: str) -> str:
    q = dict(SLOTS)[slot]
    return "The spec is silent on %s for %s; no behaviour is assumed and no acceptance test may assert it." % (q, fid)


def validate(data: Mapping[str, Any], pack: PackVersion, digest: Digest) -> Dict[str, Any]:
    """Raw model JSON -> {"slots": {fid: {slot: {...}}}, "dropped": [...]}; every F-item gets all 7 slots."""
    spans = {sp.id: sp for sp in pack.spans}
    items = {f.id: f for f in digest.f_items}
    dropped: List[Dict[str, Any]] = []
    seen: Dict[str, Dict[str, Dict[str, Any]]] = {f: {} for f in items}
    for raw in data.get("f_items") or []:
        if not isinstance(raw, Mapping):
            continue
        fid = s(raw.get("id"))
        if fid not in items:
            dropped.append({"f_item": fid, "reason": "unknown_f_item"})
            continue
        f = items[fid]
        for sl in raw.get("slots") or []:
            if not isinstance(sl, Mapping):
                continue
            name = s(sl.get("slot")).lower()
            if name not in SLOT_NAMES:
                dropped.append({"f_item": fid, "slot": name, "reason": "unknown_slot"})
                continue
            if name in seen[fid]:
                dropped.append({"f_item": fid, "slot": name, "reason": "duplicate_slot"})
                continue
            refs = [r for r in (s(x) for x in sl.get("span_refs") or []) if r in spans]
            bad_refs = [s(x) for x in sl.get("span_refs") or [] if s(x) not in spans]
            if bad_refs:
                dropped.append({"f_item": fid, "slot": name, "reason": "unknown_span_ref", "span_refs": bad_refs})
            if s(sl.get("status")) == "covered":
                sid, quote = s(sl.get("span_id")), s(sl.get("quote"))
                why = quote_ok(spans, sid, quote)
                if not why:
                    seen[fid][name] = {"status": "covered", "span_id": sid, "quote": quote}
                    continue
                dropped.append({"code": codes.QUOTE_UNMATCHED, "f_item": fid, "slot": name, "reason": why,
                                "span_id": sid, "quote": quote})
                seen[fid][name] = {"status": "gap", "reason": "quote_unmatched", "assumption": s(sl.get("assumption"))
                                   or _placeholder(fid, name), "category": "none",
                                   "span_refs": refs or ([sid] if sid in spans else list(f.span_ids)), "alternatives": [],
                                   "source": "code" if not s(sl.get("assumption")) else "model"}
                continue
            seen[fid][name] = {"status": "gap", "reason": "silent", "assumption": s(sl.get("assumption")) or _placeholder(fid, name),
                               "category": s(sl.get("category")).lower() or "none", "span_refs": refs or list(f.span_ids),
                               "alternatives": [s(a) for a in sl.get("alternatives") or [] if s(a)][:2],
                               "source": "model" if s(sl.get("assumption")) else "code"}
    for fid, f in items.items():
        for name in SLOT_NAMES:
            if name not in seen[fid]:
                seen[fid][name] = {"status": "gap", "reason": "not_answered", "assumption": _placeholder(fid, name),
                                   "category": "none", "span_refs": list(f.span_ids), "alternatives": [], "source": "code"}
    for fid, slots in seen.items():
        for name, g in slots.items():
            if g["status"] != "gap":
                continue
            cats = set(c for c in [g.get("category")] if c in SENSITIVE_CATEGORIES)
            cats |= set(sensitive_categories(g["assumption"], *g.get("alternatives") or []))
            if name == "permissions":
                cats.add("permission")
            g["categories"] = sorted(cats)
            g["sensitive"] = bool(cats)
    return {"slots": {f: dict((n, seen[f][n]) for n in SLOT_NAMES) for f in items}, "dropped": dropped}


def _evidence(pack: PackVersion, f: FItem, refs: Sequence[str]) -> List[Dict[str, str]]:
    spans = {sp.id: sp for sp in pack.spans}
    ev = []
    sid = next((r for r in list(f.span_ids) + list(refs) if r in spans), "")
    if sid:
        quote = f.quote if f.quote and f.quote in spans[sid].text else spans[sid].text.split("\n", 1)[0]
        ev.append({"span_id": sid, "quote": quote})
    return ev


def check_gaps(pack: PackVersion, digest: Digest, llm: LlmPort, *, store: Any = None, run: str = "",
               cfg: Any = None, clock: Any = None, model: Optional[str] = None, key: str = KEY) -> Dict[str, Any]:
    """Run the checklist; write assumption rows; return
    {"slots", "assumptions": [rows], "questions": [drafts], "covered", "gaps", "sensitive", "dropped", "usd"}."""
    res = llm.complete(ROLE, build_prompt(pack, digest), GAPS_SCHEMA, key=key, model=model, run=run)
    data = res.data
    if data is None and res.text:
        try:
            data = json.loads(res.text)
        except ValueError:
            data = None
    if not isinstance(data, Mapping):
        raise LineError(codes.SCHEMA_INVALID, "gaps answer is not a JSON object", {"role": ROLE, "key": key})
    v = validate(data, pack, digest)
    items = {f.id: f for f in digest.f_items}
    now = clock_ms(store, clock)

    existing = rows(store, E_ASSUMPTION, run) if store is not None and run else []
    by_slot = {(r.get("f_item"), r.get("slot")): r for r in existing}
    n = max([int(local_id(r["id"]).split("-")[-1]) for r in existing if local_id(r["id"]).split("-")[-1].isdigit()] or [0])
    out_rows: List[Dict[str, Any]] = []
    covered = gaps = 0
    for fid, slots in v["slots"].items():
        for name, g in slots.items():
            prev = by_slot.get((fid, name))
            if g["status"] == "covered":
                covered += 1
                if prev is not None and store is not None and not prev.get("covered_by"):
                    merge(store, E_ASSUMPTION, prev["id"], {"covered_by": {"span_id": g["span_id"], "quote": g["quote"]}}, run=run)
                continue
            gaps += 1
            if prev is not None:          # same F-item + slot already registered: keep its id and state
                out_rows.append(prev)
                continue
            n += 1
            aid = "ASSUMED-%d" % n
            row = {"id": rid(run, aid) if run else aid, "aid": aid, "run": run, "f_item": fid, "f_items": [fid],
                   "slot": name, "text": g["assumption"], "reason": g["reason"], "source": g["source"],
                   "span_refs": g["span_refs"], "alternatives": g["alternatives"], "categories": g["categories"],
                   "sensitive": g["sensitive"], "code": ASSUMPTION_SENSITIVE if g["sensitive"] else SPEC_GAP,
                   "state": PROPOSED if g["sensitive"] else ACCEPTED, "question": "", "answer": None,
                   "fingerprint": fingerprint("assumption", fid, name), "created_ms": now}
            if store is not None and run:
                put(store, E_ASSUMPTION, row["id"], row, run=run)
            out_rows.append(row)

    drafts = question_drafts(pack, items, [r for r in out_rows if r.get("state") == PROPOSED and not r.get("question")])
    summary = {"f_items": sorted(items), "slots": len(items) * len(SLOT_NAMES), "covered": covered, "gaps": gaps,
               "assumptions": [local_id(r["id"]) for r in out_rows],
               "sensitive": [local_id(r["id"]) for r in out_rows if r.get("sensitive")],
               "questions": len(drafts), "dropped": len(v["dropped"])}
    if store is not None and run:
        emit(store, GAPS_CHECKED, run, summary, cfg, pack.version)
    return {"slots": v["slots"], "assumptions": out_rows, "questions": drafts, "covered": covered, "gaps": gaps,
            "sensitive": summary["sensitive"], "dropped": v["dropped"], "usd": res.usd, "summary": summary}


def question_drafts(pack: PackVersion, items: Mapping[str, FItem], proposed: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """Sensitive assumptions -> human.ask_round drafts; same slot + same assumption text -> one question."""
    groups: Dict[Tuple[str, str], List[Mapping[str, Any]]] = {}
    for r in proposed:
        groups.setdefault((r["slot"], norm(r["text"])), []).append(r)
    drafts = []
    for (slot, _), rs in groups.items():
        fids = sorted({r["f_item"] for r in rs})
        aids = [local_id(r["id"]) for r in rs]
        text = rs[0]["text"]
        cats = sorted({c for r in rs for c in r.get("categories") or []})
        opts = [{"id": "accept", "text": "Accept: %s" % text,
                 "impact": "Tests and code of %s follow this assumption (%s)." % (", ".join(fids), ", ".join(aids))}]
        for i, alt in enumerate(rs[0].get("alternatives") or [], 1):
            opts.append({"id": "alt%d" % i, "text": alt, "impact": "Tests and code of %s follow this rule instead." % ", ".join(fids)})
        if len(opts) < 3:
            opts.append({"id": "unspecified", "text": "Leave it unspecified: no acceptance test asserts it",
                         "impact": "The builder may choose; nothing checks %s for %s." % (slot, ", ".join(fids))})
        ev = []
        for r in rs:
            ev.extend(e for e in _evidence(pack, items[r["f_item"]], r.get("span_refs") or []) if e not in ev)
        drafts.append({
            "kind": "assumption",
            "decision": "The spec does not state %s for %s (%s; touches %s). Which rule holds?" % (
                dict(SLOTS)[slot], ", ".join(fids), ", ".join(aids), ", ".join(cats) or "a sensitive area"),
            "options": opts[:4], "recommended": "accept", "evidence": ev or [{"span_id": "-", "quote": "-"}],
            "f_items": fids, "refs": [{"entity": E_ASSUMPTION, "id": r["id"]} for r in rs],
            "fingerprint": fingerprint("assumption", slot, *sorted(r["fingerprint"] for r in rs)),
        })
    return drafts


def register(store: Any, run: str) -> List[Dict[str, Any]]:
    """The run's assumption register (Sổ giả định), ASSUMED-n order."""
    def k(r: Mapping[str, Any]) -> int:
        tail = local_id(r["id"]).split("-")[-1]
        return int(tail) if tail.isdigit() else 0
    return sorted(rows(store, E_ASSUMPTION, run), key=k)


__all__ = ["check_gaps", "validate", "question_drafts", "register", "build_prompt", "SLOTS", "SLOT_NAMES",
           "GAPS_SCHEMA", "ROLE", "KEY", "PROPOSED", "ACCEPTED", "ANSWERED"]
