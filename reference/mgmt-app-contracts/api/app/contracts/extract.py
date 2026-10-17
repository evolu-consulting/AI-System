import base64
import json
import logging

from app.llm import claude
from app.llm_openai import openai_client
from app.models import ContractExtraction
from app.settings import settings

log = logging.getLogger(__name__)
_MAX_CHARS = 300_000   # ~100k tokens of Vietnamese; longer text keeps its head and its price appendices

SYSTEM = """You read Vietnamese purchase and service contracts and return their facts as structured data.
For EVERY field return {value, quote}. quote is copied VERBATIM from the text (same words, same numbers) and must
contain the value. If the text does not state a field, return value null and quote "". Never infer a value, with one
exception: when the text gives a term instead of an end date (e.g. "thời hạn 01 (một) năm kể từ ngày ký"), set end_date
to the start date plus that term minus one day and quote the term sentence; a person checks it before it is used.
effective_date is for addenda only; leave it null for a contract.
Dates: ISO YYYY-MM-DD. Money: integer VND, no separators. vat_rate: percent number (10 means 10%).
vat_included: true only if the text says prices include VAT, false if it says they exclude it, else null.
type: purchase (mua bán), service (dịch vụ), framework (khung), principle (nguyên tắc).
Supplier is the party that sells or provides the goods/service (Bên bán, Bên cung cấp, nhà cung cấp dịch vụ; it may be
Bên A or Bên B). Buyer is the other party (Bên mua, đại lý, đối tác).
supplier_representative / buyer_representative: the person who signs for that party ("Đại diện: Ông Nguyễn Văn A, chức
vụ: Giám đốc", or the name under its signature), as "Nguyễn Văn A – Giám đốc" (name, then title when stated; no Ông/Bà).
items: one per priced line (table row), each with its own verbatim quote containing the unit price.
clauses: one entry per article ("Điều N") with its number and topic; the preamble is number "0", topic "general".
"""
ADDENDUM = """This document is an ADDENDUM (phụ lục) to the parent contract summarised below.
Return number (the addendum number), effective_date (ngày hiệu lực của phụ lục), supplier_name, and ONLY the fields
and price lines this addendum changes; every other field is null. A changed price line keeps the parent's product
code and name so it can be matched.
"""


def parent_summary(rec: dict) -> str:
    f = {k: v.get("value") for k, v in (rec.get("fields") or {}).items() if v.get("value") is not None}
    lines = [f"{k}: {v}" for k, v in f.items()]
    for it in rec.get("items") or []:
        lines.append(f"item: {it.get('code') or '-'} | {it['name']} | {it.get('unit') or ''} | {it.get('unit_price')}")
    return "\n".join(lines)


def _clip(md: str) -> str:
    if len(md) <= _MAX_CHARS:
        return md
    head, tail = md[: _MAX_CHARS // 2], md[-_MAX_CHARS // 2 :]
    return head + "\n\n[...]\n\n" + tail


def _call_model(system: str, user: str) -> ContractExtraction | None:
    try:
        if not settings.anthropic_api_key:   # contracts go to Claude whenever a key is configured
            r = openai_client().chat.completions.parse(
                model=settings.openai_chat_model, temperature=0,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format=ContractExtraction,
            )
            return r.choices[0].message.parsed
        return _claude_json(system, [{"type": "text", "text": user}])
    except Exception:  # noqa: BLE001 - a failed extraction leaves an empty form, never a failed ingest
        log.warning("contract extraction call failed", exc_info=True)
        return None


def _claude_json(system: str, content: list[dict]) -> ContractExtraction | None:
    """The extraction schema is too large for Claude's constrained decoding ("compiled grammar is too
    large"), so the schema goes in the prompt and the reply is validated here instead."""
    schema = json.dumps(ContractExtraction.model_json_schema(), ensure_ascii=False)
    with claude().messages.stream(
        model=settings.contract_model, max_tokens=32000,
        system=[{"type": "text", "text": f"{system}\nReturn ONLY one JSON object matching this JSON Schema:\n{schema}",
                 "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": content}],
    ) as stream:
        r = stream.get_final_message()
    if r.stop_reason == "refusal":
        return None
    text = "".join(b.text for b in r.content if b.type == "text")
    return ContractExtraction.model_validate_json(text[text.find("{"): text.rfind("}") + 1])


def extract_contract(md: str, parent: dict | None = None, pdf: bytes | None = None) -> ContractExtraction:
    if settings.fake_llm:
        return ContractExtraction.empty()
    system = SYSTEM + (ADDENDUM if parent else "")
    head = f"PARENT CONTRACT:\n{parent_summary(parent)}\n\n" if parent else ""
    if pdf and settings.anthropic_api_key:
        # Claude reads the pages themselves, so scans and split text layers lose nothing.
        doc = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                             "data": base64.standard_b64encode(pdf).decode()}}
        try:
            got = _claude_json(system, [doc, {"type": "text", "text": head + "Extract this contract."}])
            if got:
                return got
        except Exception:  # noqa: BLE001 - fall back to the text path below
            log.warning("PDF extraction failed, using text", exc_info=True)
    return _call_model(system, head + f"DOCUMENT:\n{_clip(md)}") or ContractExtraction.empty()
