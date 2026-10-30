"""Block 6a: independent readers A/B and the quote check.

read_digest(pack, variant, llm) -> Digest
  Reader A reads the spans in document order (prompt reader_a); reader B reads them in
  reverse order with a sceptical prompt (reader_b). Neither sees the other's answer.
  The model answers strict JSON (DIGEST_SCHEMA); every F-item, criterion, rule and number
  carries a span_id and a quote. check_quotes() keeps only claims whose quote is a literal
  substring of the named span's text (and, for numbers, whose value is in the quote);
  everything else goes to Digest.dropped with code QUOTE_UNMATCHED.

reread(pack, variant, llm, questions, span_ids, round_no) -> Digest
  Targeted re-read of only the given spans (prompt reader_reread), same schema and checks.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .. import codes
from ..codes import LineError
from ..contracts import Criterion, Digest, Fact, FItem, LlmPort, PackVersion, Size, Span
from ._common import DIGEST_SCHEMA, load_prompt, norm_value

VARIANTS = ("A", "B")
ROLE = {"A": "reader_a", "B": "reader_b"}
REREAD_ROLE = "reader_reread"


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ("" if v is None else str(v)).strip()


def render_spans(spans: Sequence[Span]) -> str:
    out = []
    for sp in spans:
        out.append("=== SPAN %s | %s ===\n%s\n=== END %s ===" % (sp.id, sp.heading or "(no heading)", sp.text, sp.id))
    return "\n\n".join(out)


def _drop(dropped: List[Dict[str, Any]], kind: str, item: Mapping[str, Any], reason: str, **extra: Any) -> None:
    d = {"code": codes.QUOTE_UNMATCHED, "kind": kind, "id": _s(item.get("id")), "text": _s(item.get("text") or item.get("title")),
         "span_id": _s(item.get("span_id")), "quote": _s(item.get("quote")), "reason": reason}
    d.update(extra)
    dropped.append(d)


def _quote_ok(spans: Mapping[str, Span], sid: str, quote: str) -> str:
    """'' if quote is a literal substring of span sid, else the reason."""
    sp = spans.get(sid)
    if sp is None:
        return "unknown_span"
    if not quote:
        return "empty_quote"
    if quote not in sp.text:
        return "not_in_span"
    return ""


def check_quotes(data: Mapping[str, Any], spans: Mapping[str, Span], pack_version: str, variant: str,
                 usd: float = 0.0) -> Digest:
    """Raw reader JSON -> Digest with every unquotable claim moved to dropped."""
    dropped: List[Dict[str, Any]] = []
    f_items: List[FItem] = []
    for raw in data.get("f_items") or []:
        if not isinstance(raw, Mapping):
            continue
        fid = _s(raw.get("id"))
        sids = [s for s in (_s(x) for x in raw.get("span_ids") or []) if s in spans]
        quote = _s(raw.get("quote"))
        if not fid or not sids:
            _drop(dropped, "f_item", raw, "unknown_span" if fid else "no_id")
            continue
        if not quote or not any(quote in spans[s].text for s in sids):
            _drop(dropped, "f_item", raw, "empty_quote" if not quote else "not_in_span", span_ids=sids)
            continue
        crits: List[Criterion] = []
        for i, c in enumerate(raw.get("criteria") or []):
            if not isinstance(c, Mapping):
                continue
            cid = _s(c.get("id")) or "%s.C%d" % (fid, i + 1)
            sid, q = _s(c.get("span_id")), _s(c.get("quote"))
            why = _quote_ok(spans, sid, q)
            if why:
                _drop(dropped, "criterion", dict(c, id=cid), why, f_item=fid)
                continue
            crits.append(Criterion(id=cid, f_item=fid, text=_s(c.get("text")), span_id=sid, quote=q,
                                   given=_s(c.get("given")), when=_s(c.get("when")), then=_s(c.get("then"))))
            if sid not in sids:
                sids.append(sid)
        size = _s(raw.get("size")).upper()
        f_items.append(FItem(id=fid, title=_s(raw.get("title")), span_ids=sids, quote=quote, criteria=crits,
                             size=size if size in ("S", "M", "L") else Size.M.value))

    def facts(kind: str, items: Iterable[Any]) -> List[Fact]:
        out = []
        for f in items or []:
            if not isinstance(f, Mapping):
                continue
            sid, q = _s(f.get("span_id")), _s(f.get("quote"))
            why = _quote_ok(spans, sid, q)
            value = f.get("value")
            value = None if value is None or _s(value) == "" else _s(value)
            if not why and kind == "number":
                if value is None:
                    why = "no_value"
                elif value not in q and norm_value(value) not in norm_value(q):
                    why = "value_not_in_quote"
            if why:
                _drop(dropped, kind, f, why)
                continue
            out.append(Fact(text=_s(f.get("text")), span_id=sid, quote=q, value=value))
        return out

    return Digest(pack_version=pack_version, variant=variant, f_items=f_items,
                  rules=facts("rule", data.get("rules")), numbers=facts("number", data.get("numbers")),
                  dropped=dropped, usd=usd)


def _call(llm: LlmPort, role: str, prompt: str, key: str, run: str, model: Optional[str]) -> Any:
    res = llm.complete(role, prompt, DIGEST_SCHEMA, key=key, model=model, run=run)
    data = res.data
    if data is None and res.text:
        try:
            data = json.loads(res.text)
        except ValueError:
            data = None
    if not isinstance(data, Mapping):
        raise LineError(codes.SCHEMA_INVALID, "%s answer is not a JSON object" % role, {"role": role, "key": key})
    return data, res


def read_digest(pack: PackVersion, variant: str, llm: LlmPort, *, run: str = "", model: Optional[str] = None,
                lessons: Sequence[str] = (), key: str = "digest") -> Digest:
    """One independent reading of the whole pack. variant 'A' or 'B'."""
    if variant not in VARIANTS:
        raise ValueError("variant must be 'A' or 'B'")
    spans = list(pack.spans) if variant == "A" else list(reversed(pack.spans))
    parts = [load_prompt(ROLE[variant])]
    if lessons:
        parts.append("## Lessons\n" + "\n".join("- " + l for l in lessons))
    parts.append("## Spec spans (%d)\n%s" % (len(spans), render_spans(spans)))
    data, res = _call(llm, ROLE[variant], "\n\n".join(parts), key, run, model)
    d = check_quotes(data, {s.id: s for s in pack.spans}, pack.version, variant, res.usd)
    return d


def reread(pack: PackVersion, variant: str, llm: LlmPort, questions: Sequence[Mapping[str, Any]],
           span_ids: Sequence[str], round_no: int, *, run: str = "", model: Optional[str] = None) -> Digest:
    """Targeted re-read of only span_ids for reader `variant`; fixture key '<variant><round>' (e.g. 'B1')."""
    by_id = {s.id: s for s in pack.spans}
    spans = [by_id[s] for s in span_ids if s in by_id]
    if variant == "B":
        spans.reverse()
    qs = "\n".join("- %s: %s" % (q.get("path", ""), q.get("question", "")) for q in questions)
    prompt = "\n\n".join([load_prompt(REREAD_ROLE), "## Questions\n" + qs,
                          "## Spec spans (%d)\n%s" % (len(spans), render_spans(spans))])
    data, res = _call(llm, REREAD_ROLE, prompt, "%s%d" % (variant, round_no), run, model)
    return check_quotes(data, by_id, pack.version, variant, res.usd)


__all__ = ["read_digest", "reread", "check_quotes", "render_spans", "VARIANTS", "ROLE", "REREAD_ROLE"]
