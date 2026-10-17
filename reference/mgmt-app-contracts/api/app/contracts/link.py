"""What an upload is, without asking the person: a contract or an addendum, which contract an addendum amends,
and who should own it. Runs once, after the text is read and before extraction, so an addendum is read with
its parent's summary. Every guess carries its reason; the person can change any of them on the contract page."""
import json
import logging
import math
import re
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel

from app import orgs
from app.contracts import store
from app.ingest.resolve import match_form
from app.settings import settings
from app.store import opensearch as os_store

log = logging.getLogger(__name__)
_HEAD = 4000
_RAG_MIN = 0.8          # without a supplier to go on, only a very close text counts as the same family


class Classified(BaseModel):
    kind: Literal["contract", "addendum"] = "contract"
    parent_number: str | None = None      # the contract an addendum says it belongs to
    supplier_name: str | None = None
    supplier_tax_id: str | None = None


PROMPT = """Classify the start of a Vietnamese business document. Return ONLY a JSON object:
{"kind": "contract" | "addendum", "parent_number": string|null, "supplier_name": string|null, "supplier_tax_id": string|null}
kind is "addendum" only if the document itself is a phụ lục hợp đồng / biên bản sửa đổi bổ sung that amends an existing
contract. A new contract that merely cites another (e.g. "Căn cứ hợp đồng nguyên tắc số ...") is a "contract".
parent_number: the number of the contract the addendum amends, copied exactly; null for a contract.
supplier: the party that sells or provides the goods/service; tax id = its mã số thuế."""


# ---- reading the document ----

_ADDENDUM_TITLE = re.compile(r"^[#*\s]*(phụ\s*lục|phu\s*luc|biên\s*bản\s*sửa\s*đổi)", re.IGNORECASE)
_CONTRACT_NO = re.compile(r"hợp\s*đồng[^\n]{0,60}?số\s*:?\s*([^\s,;()]+)", re.IGNORECASE)


def heuristic(md: str) -> Classified:
    """No model at hand (tests, no key, a failed call): an addendum names itself in its title."""
    lines = [ln for ln in md[:_HEAD].splitlines() if ln.strip()][:8]
    title = next((i for i, ln in enumerate(lines) if _ADDENDUM_TITLE.match(ln)), None)
    if title is None:
        return Classified()
    rest = "\n".join(lines[title + 1:])                 # the title line holds the addendum's own number
    m = _CONTRACT_NO.search(rest)
    return Classified(kind="addendum", parent_number=m.group(1).rstrip(".:") if m else None)


def classify(md: str) -> Classified:
    if settings.fake_llm or not (settings.anthropic_api_key or settings.openai_api_key):
        return heuristic(md)
    try:
        if settings.anthropic_api_key:
            from app.llm import claude
            r = claude().messages.create(model=settings.contract_model, max_tokens=400, system=PROMPT,
                                         messages=[{"role": "user", "content": md[:_HEAD]}])
            text = "".join(b.text for b in r.content if b.type == "text")
            return Classified.model_validate(json.loads(text[text.find("{"): text.rfind("}") + 1]))
        from app.llm_openai import openai_client
        r = openai_client().chat.completions.parse(
            model=settings.openai_chat_model, temperature=0, response_format=Classified,
            messages=[{"role": "system", "content": PROMPT}, {"role": "user", "content": md[:_HEAD]}])
        return r.choices[0].message.parsed or heuristic(md)
    except Exception:  # noqa: BLE001 - a failed guess falls back to reading the title
        log.warning("contract classification failed", exc_info=True)
        return heuristic(md)


# ---- matching ----

def _fold(s: str | None) -> str:
    return match_form(s or "").replace("đ", "d")


def _key(s: str | None) -> str:
    return re.sub(r"\W", "", _fold(s))


_LEGAL = re.compile(r"\b(cong ty|co phan|trach nhiem huu han|tnhh|ctcp|cty|mtv|mot thanh vien)\b")


def party_form(s: str | None) -> str:
    """A company name without its legal form, accents or punctuation: \"Cty TNHH ABC\" == \"CÔNG TY TNHH ABC\"."""
    return re.sub(r"\W", "", _LEGAL.sub(" ", _fold(s)))


def _value(rec: dict, field: str) -> str | None:
    return (rec.get("fields", {}).get(field) or {}).get("value")


def same_supplier(c: Classified, rec: dict) -> bool:
    tax = re.sub(r"\D", "", c.supplier_tax_id or "")
    if tax and tax == re.sub(r"\D", "", _value(rec, "supplier_tax_id") or ""):
        return True
    mine, theirs = party_form(c.supplier_name), party_form(_value(rec, "supplier_name"))
    return len(mine) >= 4 and len(theirs) >= 4 and (mine in theirs or theirs in mine)


def find_parent(c: Classified, candidates: list[dict],
                rank: Callable[[list[str]], dict[str, float]] | None) -> tuple[dict | None, str | None]:
    """The contract an addendum amends: by the number it cites, else by supplier, else by the closest text (RAG)."""
    if c.kind != "addendum":
        return None, None
    if c.parent_number:
        hit = next((r for r in candidates if _key(_value(r, "number")) == _key(c.parent_number)), None)
        if hit:
            return hit, f"văn bản ghi kèm theo hợp đồng số {c.parent_number}"
    same = [r for r in candidates if same_supplier(c, r)]
    if len(same) == 1:
        return same[0], "cùng nhà cung cấp với hợp đồng này"
    pool = same or candidates
    scores = rank([r["id"] for r in pool]) if rank and pool else {}
    if not scores:
        return None, None
    best = max(scores, key=scores.get)
    if not same and scores[best] < _RAG_MIN:
        return None, None
    why = "cùng nhà cung cấp, nội dung gần nhất với hợp đồng này" if same else "nội dung gần nhất với hợp đồng này"
    return next(r for r in pool if r["id"] == best), why


def pick_owner(c: Classified, parent: dict | None, candidates: list[dict], uploader: str,
               allowed: Callable[[str], bool]) -> tuple[str, str]:
    if parent and parent.get("owner_email") and allowed(parent["owner_email"]):
        return parent["owner_email"], "người phụ trách hợp đồng gốc"
    same = sorted((r for r in candidates if r.get("owner_email") and allowed(r["owner_email"]) and same_supplier(c, r)),
                  key=lambda r: r.get("created_at") or "", reverse=True)
    if same:
        return same[0]["owner_email"], "người phụ trách hợp đồng trước với cùng nhà cung cấp"
    return uploader, "người tải lên"


def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / ((math.sqrt(sum(x * x for x in a)) or 1.0) * (math.sqrt(sum(y * y for y in b)) or 1.0))


def _ranker(own_id: str, vectors: list[list[float]]) -> Callable[[list[str]], dict[str, float]]:
    """RAG over the organisation's own contract chunks: each candidate scores its best match to our opening."""
    def rank(ids: list[str]) -> dict[str, float]:
        best: dict[str, float] = {}
        for v in vectors[:3]:
            for hit in os_store.knn_neighbors(v, k=12, exclude_doc_id=own_id, domain="contract", contract_ids=ids):
                cid = hit.get("contract_id") or hit["doc_id"]
                best[cid] = max(best.get(cid, 0.0), _cos(v, hit["embedding"]))
        return best
    return rank


def auto_link(contract_id: str, vectors: list[list[float]]) -> None:
    """Fill in kind, parent and owner on a fresh upload; whatever the uploader chose explicitly stays."""
    rec = store.get(contract_id)
    if not rec:
        return
    try:
        ctx = orgs.ctx_for({"email": rec["created_by"]})
    except Exception:  # noqa: BLE001 - the uploader has left the organisation; guess nothing
        return
    candidates = [r for r in ctx.visible(store.list_org(ctx.org_id))
                  if r["kind"] == "contract" and r["id"] != contract_id and r.get("org_id") == rec.get("org_id")]
    c = classify(rec.get("source_md") or "")
    auto = {"kind": c.kind, "parent_reason": None, "owner_reason": None, "note": None}
    parent = store.get(rec["parent_id"]) if rec.get("parent_id") else None
    if not rec.get("parent_id"):
        parent, auto["parent_reason"] = find_parent(c, candidates, _ranker(contract_id, vectors))
        if parent:
            rec.update(kind="addendum", parent_id=parent["id"])
        elif c.kind == "addendum":
            cited = f" số {c.parent_number}" if c.parent_number else ""
            auto["note"] = f"Văn bản có vẻ là phụ lục của hợp đồng{cited} nhưng chưa tìm thấy hợp đồng đó trong hệ thống."
    if not rec.get("owner_email"):
        def allowed(email: str) -> bool:
            m = orgs.membership(email)
            return bool(m) and m["org_id"] == ctx.org_id and m["status"] == "active" \
                and (ctx.scope is None or email in ctx.scope)
        rec["owner_email"], auto["owner_reason"] = pick_owner(c, parent, candidates, ctx.email, allowed)
    rec["auto"] = auto
    store.save(rec)
