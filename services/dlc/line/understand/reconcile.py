"""Block 6b: reconcile two digests; targeted re-read; escalate.

reconcile(a, b) -> Digest (variant "R") | Divergence
  Code only, no model. Compared field by field:
    * F-items matched by id, then by span overlap (Jaccard >= 0.5), then by title;
      an F-item only one reader found diverges unless the other reader quoted every one of its
      criteria under its own F-items (one reader split "the tests" into an F-item of their own).
    * criteria of matched F-items matched by id, then by quote overlap on the same span;
      a criterion only one reader found diverges unless the other reader covers the same
      sentence (same span, overlapping quote) under any F-item: readers split a list into
      criteria at different grain, or file a test case under another F-item, and that is no
      misreading. Matched criteria diverge when their exit codes (any field) differ, or when
      the numbers in `then` differ by a number that neither quote holds (a number copied from
      the quoted sentence is a restatement, not a conflict).
    * numbers matched by span + overlapping quote: values must be equal (unit included).
    * rules matched the same way: their exit codes and numbers must be equal.
    Facts only one reader quoted are kept (both passed the quote check).
    Spans in `advisory` (the spec analyst's section, see analyst.advisory_spans) never diverge:
    what only the analysis says is advice, kept when reader A took it.
  The reconciled digest takes reader A's wording for matched items.

resolve(pack, a, b, llm, ...) -> Digest
  Diverged -> emit reconcile.diverged, re-read ONLY the diverged spans, once per reader
  and independently, patch each side and reconcile again; at most cfg.reread_max rounds,
  then LineError(READ_DIVERGED) with both readings. Agreement -> digest stored, f_items
  stored, digest.done emitted.

understand(pack, llm, ...) -> Digest   reader A + reader B + resolve.
"""

from __future__ import annotations

import copy
from typing import AbstractSet, Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple, Union

from .. import codes
from ..codes import LineError
from ..config import Config
from ..contracts import E_DIGEST, E_FITEM, Criterion, Digest, Divergence, Fact, FItem, LlmPort, PackVersion, Store, to_dict
from ._common import cfg_or_default, emit, envelope, exit_codes, norm_value, numbers
from .analyst import advisory_spans
from .readers import read_digest, reread


# ------------------------------------------------------------------ matching helpers


def _jaccard(x: Sequence[str], y: Sequence[str]) -> float:
    a, b = set(x), set(y)
    return len(a & b) / len(a | b) if (a or b) else 0.0


def _title(t: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in t).split())


def _overlap(q1: str, q2: str) -> bool:
    return bool(q1) and bool(q2) and (q1 in q2 or q2 in q1)


def _pair(left: List[Any], right: List[Any], *keys) -> Tuple[List[Tuple[Any, Any]], List[Any], List[Any]]:
    """Greedy pairing: each key(l, r) -> bool is tried in order over the still-unmatched items."""
    pairs, ra = [], list(right)
    la = list(left)
    for key in keys:
        rest = []
        for l in la:
            hit = next((r for r in ra if key(l, r)), None)
            if hit is None:
                rest.append(l)
            else:
                pairs.append((l, hit))
                ra.remove(hit)
        la = rest
    return pairs, la, ra


def _crit_sig(c: Criterion) -> Dict[str, List[str]]:
    return {"exit": exit_codes(" ".join([c.text, c.given, c.when, c.then])), "then_numbers": numbers(c.then)}


def _covered(c: Criterion, others: Sequence[Criterion]) -> bool:
    """The other reader has a criterion on the same sentence (any F-item, any grain)."""
    return any(o.span_id == c.span_id and _overlap(o.quote, c.quote) for o in others)


def _sig_differs(k: str, ca: Criterion, cb: Criterion, va: List[str], vb: List[str]) -> bool:
    if va == vb:
        return False
    if k != "then_numbers":
        return True
    quoted = set(numbers(ca.quote)) | set(numbers(cb.quote))
    return bool((set(va) ^ set(vb)) - quoted)


def _fact_sig(f: Fact) -> Dict[str, List[str]]:
    return {"exit": exit_codes(f.text), "numbers": numbers(f.text)}


# ------------------------------------------------------------------ reconcile


def reconcile(a: Digest, b: Digest, advisory: AbstractSet[str] = frozenset()) -> Union[Digest, Divergence]:
    fields: List[Dict[str, Any]] = []

    def diverge(path: str, kind: str, va: Any, vb: Any, span_ids: Sequence[str], f_item: str = "",
                question: str = "") -> None:
        fields.append({"path": path, "kind": kind, "f_item": f_item, "a": va, "b": vb,
                       "span_ids": sorted(set(span_ids)), "question": question})

    pairs, only_a, only_b = _pair(
        a.f_items, b.f_items,
        lambda x, y: x.id == y.id,
        lambda x, y: _jaccard(x.span_ids, y.span_ids) >= 0.5,
        lambda x, y: _title(x.title) == _title(y.title) and bool(_title(x.title)),
    )
    all_a = [c for f in a.f_items for c in f.criteria]
    all_b = [c for f in b.f_items for c in f.criteria]

    def covered_item(f: FItem, others: List[Criterion]) -> bool:
        """The other reader holds this F-item's content under its own F-items (other grain): every criterion
        of it is on a sentence the other reader also quoted."""
        if f.span_ids and set(f.span_ids) <= advisory:
            return True
        crit = [c for c in f.criteria if c.span_id not in advisory]
        if f.criteria and not crit:          # every criterion comes from the analysis: advice, never a divergence
            return True
        return bool(crit) and all(_covered(c, others) for c in crit)

    only_a = [f for f in only_a if not covered_item(f, all_b)]
    only_b = [f for f in only_b if not covered_item(f, all_a)]
    for f in only_a:
        diverge("f_items[%s]" % f.id, "f_item", f.title, None, f.span_ids, f.id,
                "Is '%s' a separate feature item of the spec? Give it with all its criteria, or omit it." % f.title)
    for f in only_b:
        diverge("f_items[%s]" % f.id, "f_item", None, f.title, f.span_ids, f.id,
                "Is '%s' a separate feature item of the spec? Give it with all its criteria, or omit it." % f.title)

    merged_items: List[FItem] = []
    for fa, fb in pairs:
        cpairs, ca_only, cb_only = _pair(
            fa.criteria, fb.criteria,
            lambda x, y: x.id == y.id and x.span_id == y.span_id,
            lambda x, y: x.span_id == y.span_id and _overlap(x.quote, y.quote),
            lambda x, y: x.id == y.id,
        )
        spans = sorted(set(fa.span_ids) | set(fb.span_ids))
        ca_only = [c for c in ca_only if c.span_id not in advisory and not _covered(c, all_b)]
        cb_only = [c for c in cb_only if c.span_id not in advisory and not _covered(c, all_a)]
        if ca_only or cb_only:
            diverge("%s.criteria" % fa.id, "criteria", [c.id for c in ca_only], [c.id for c in cb_only], spans, fa.id,
                    "List every acceptance criterion of %s (one per testable behaviour)." % fa.id)
        for ca, cb in cpairs:
            if ca.span_id in advisory:
                continue
            sa, sb = _crit_sig(ca), _crit_sig(cb)
            for k in sa:   # "exit" first; a differing exit code already explains differing numbers
                if _sig_differs(k, ca, cb, sa[k], sb[k]):
                    diverge("%s.criteria[%s].%s" % (fa.id, ca.id, k), "criterion", sa[k], sb[k], spans, fa.id,
                            "Criterion '%s': which %s does the spec state?" % (ca.text or ca.id,
                                                                               "exit code" if k == "exit" else "number(s) in the expected outcome"))
                    break
        m = copy.deepcopy(fa)
        m.span_ids = spans
        merged_items.append(m)

    def facts(kind: str, la: List[Fact], lb: List[Fact], sig) -> List[Fact]:
        fpairs, fa_only, fb_only = _pair(la, lb, lambda x, y: x.span_id == y.span_id and _overlap(x.quote, y.quote))
        for x, y in fpairs:
            if x.span_id in advisory:
                continue
            if kind == "number":
                va, vb = norm_value(x.value), norm_value(y.value)
            else:
                va, vb = sig(x), sig(y)
            if va != vb:
                diverge("%s[%s]" % (kind + "s", x.quote[:40]), kind, va, vb, [x.span_id], "",
                        "Quote '%s': what %s does the spec state?" % (x.quote[:80], "value (with unit)" if kind == "number" else "rule (numbers, exit codes)"))
        return [x for x, _ in fpairs] + fa_only + fb_only

    rules = facts("rule", a.rules, b.rules, _fact_sig)
    nums = facts("number", a.numbers, b.numbers, _fact_sig)

    if fields:
        span_ids = sorted({s for f in fields for s in f["span_ids"]})
        return Divergence(pack_version=a.pack_version, fields=fields, span_ids=span_ids, rereads=0)
    return Digest(pack_version=a.pack_version, variant="R", f_items=merged_items, rules=rules, numbers=nums,
                  dropped=list(a.dropped) + list(b.dropped), usd=round(a.usd + b.usd, 6))


# ------------------------------------------------------------------ targeted re-read


def _patch(side: Digest, fresh: Digest, div: Divergence) -> Digest:
    """Replace in `side` what the divergence touched by the targeted re-read `fresh`."""
    out = copy.deepcopy(side)
    touched_f = {f["f_item"] for f in div.fields if f.get("f_item")}
    fact_spans = {k: {s for f in div.fields if f["kind"] == k for s in f["span_ids"]} for k in ("rule", "number")}
    fresh_f = {f.id: f for f in fresh.f_items}
    items = []
    for f in out.f_items:
        if f.id in touched_f:
            if f.id in fresh_f:
                items.append(fresh_f.pop(f.id))
        else:
            items.append(f)
    for fid in sorted(touched_f):
        if fid in fresh_f:
            items.append(fresh_f.pop(fid))
    out.f_items = items
    out.rules = [r for r in out.rules if r.span_id not in fact_spans["rule"]] + \
        [r for r in fresh.rules if r.span_id in fact_spans["rule"]]
    out.numbers = [n for n in out.numbers if n.span_id not in fact_spans["number"]] + \
        [n for n in fresh.numbers if n.span_id in fact_spans["number"]]
    out.dropped = list(out.dropped) + [dict(d, reread=True) for d in fresh.dropped]
    out.usd = round(out.usd + fresh.usd, 6)
    return out


def _questions(div: Divergence) -> List[Dict[str, str]]:
    return [{"path": f["path"], "question": f.get("question") or f["path"]} for f in div.fields]


def resolve(pack: PackVersion, a: Digest, b: Digest, llm: LlmPort, *, run: str = "", store: Optional[Store] = None,
            cfg: Optional[Config] = None, model: Optional[str] = None) -> Digest:
    cfg = cfg_or_default(cfg)
    env = envelope(run or "pack-" + pack.version[:12], spec_hash=pack.version, model=model or "", cfg=cfg)
    if store is not None and run:
        store.put(E_DIGEST, "%s:A" % run, to_dict(a), run=run)
        store.put(E_DIGEST, "%s:B" % run, to_dict(b), run=run)
    rounds = 0
    advisory = advisory_spans(pack)
    while True:
        res = reconcile(a, b, advisory)
        if isinstance(res, Digest):
            break
        res.rereads = rounds
        final = rounds >= cfg.reread_max
        emit(store, codes.RECONCILE_DIVERGED, env, {
            "round": rounds, "fields": res.fields, "span_ids": res.span_ids, "final": final})
        if final:
            raise LineError(codes.READ_DIVERGED, "readers still disagree after %d re-read(s)" % rounds, {
                "rereads": rounds, "fields": res.fields, "span_ids": res.span_ids,
                "a": to_dict(a), "b": to_dict(b)})
        rounds += 1
        qs = _questions(res)
        a = _patch(a, reread(pack, "A", llm, qs, res.span_ids, rounds, run=run, model=model), res)
        b = _patch(b, reread(pack, "B", llm, qs, res.span_ids, rounds, run=run, model=model), res)

    res.usd = round(a.usd + b.usd, 6)
    if store is not None and run:
        store.put(E_DIGEST, "%s:R" % run, to_dict(res), run=run)
        for f in res.f_items:
            store.put(E_FITEM, "%s:%s" % (run, f.id), to_dict(f), run=run)
    emit(store, codes.DIGEST_DONE, env, {
        "variant": "R", "f_items": [f.id for f in res.f_items],
        "criteria": sum(len(f.criteria) for f in res.f_items), "rules": len(res.rules),
        "numbers": len(res.numbers), "dropped": len(res.dropped), "rereads": rounds, "usd": res.usd})
    return res


def understand(pack: PackVersion, llm: LlmPort, *, run: str = "", store: Optional[Store] = None,
               cfg: Optional[Config] = None, lessons: Sequence[str] = (), model_b: Optional[str] = None,
               readers: int = 2) -> Digest:
    """Reader A and reader B (independent), then resolve(). readers=1 (a small or trivial lane, line.understand.sizer):
    reader A alone; its quote-checked digest is the reconciled one (stored as A, B and R alike)."""
    a = read_digest(pack, "A", llm, run=run, lessons=lessons)
    if readers < 2:
        b = copy.deepcopy(a)
        b.variant, b.usd = "B", 0.0
    else:
        b = read_digest(pack, "B", llm, run=run, lessons=lessons, model=model_b)
    return resolve(pack, a, b, llm, run=run, store=store, cfg=cfg)


__all__ = ["reconcile", "resolve", "understand"]
