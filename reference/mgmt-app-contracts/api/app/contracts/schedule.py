"""A contract's payment instalments, read from its payment terms when it is confirmed: "50% trong 15 ngày kể từ ngày
ký, 50% trong 30 ngày kể từ ngày nhận hàng" becomes two instalments, so a person can mark "Đã thu / Đã trả" on it from
day one and the overdue log (ledger/overdue.py) has dates to watch.

A cheap model reads the terms (`propose`); a date that hangs on an event nobody knows yet (delivery, acceptance) is
estimated from the contract's dates and flagged `estimated`. The instalments must add up to the contract value, or
the reading is not trusted and one instalment for the whole value at the end is used instead (as the chat import does).
It runs once: a contract that already has instalments — read before, or set by a person — is left alone."""
import logging
from datetime import date

from pydantic import BaseModel, Field

from app.contracts import store
from app.ledger import obligations
from app.settings import settings

log = logging.getLogger(__name__)


class Instalment(BaseModel):
    due_date: str = Field(description="YYYY-MM-DD")
    amount: int = Field(description="VND, an integer")
    estimated: bool = Field(description="true when the date hangs on an event whose date is not in the contract")
    basis: str = Field(description="the rule in the contract's words, e.g. '30 ngày kể từ ngày nhận hàng'")


class _Plan(BaseModel):
    instalments: list[Instalment]


READ = """You turn a Vietnamese contract's payment terms into dated instalments. You get the terms, the contract's dates
(signed, start, end) and its total value in VND. Give each instalment its due date (YYYY-MM-DD) and amount in VND; the
amounts must add up to the total value. When a date depends on an event whose date is not given (delivery, acceptance,
invoice), estimate it from the contract's dates (e.g. the start date) and set estimated=true. When the terms say nothing
usable (empty, "theo thoả thuận"), return no instalments. Never invent a percentage the terms do not state."""


def propose(rec: dict) -> list[Instalment]:
    f = {k: v["value"] for k, v in rec["fields"].items()}
    terms = (f.get("payment_terms") or "").strip()
    if settings.fake_llm or settings.llm_provider != "anthropic" or not terms or not f.get("total_value"):
        return []
    from app.llm import CLAUDE_KW, claude
    text = (f"TERMS: {terms}\nSIGNED: {f.get('signed_date') or '—'}\nSTART: {f.get('start_date') or '—'}\n"
            f"END: {f.get('end_date') or '—'}\nTOTAL VALUE (VND): {f['total_value']}")
    r = claude().beta.messages.parse(max_tokens=2000, system=READ, output_format=_Plan,
                                     messages=[{"role": "user", "content": text}],
                                     **{**CLAUDE_KW, "model": settings.assistant_light_model})
    return r.parsed_output.instalments if r.parsed_output else []


def _sane(plan: list[Instalment], total: int | None) -> bool:
    if not plan or not total:
        return False
    try:
        dates_ok = all(date.fromisoformat(i.due_date) for i in plan)
    except ValueError:
        return False
    return dates_ok and all(i.amount > 0 for i in plan) and abs(sum(i.amount for i in plan) - total) <= max(1000, total // 1000)


def auto_schedule(contract_id: str, proposer=propose) -> list[dict]:
    """The instalments made for a just-confirmed contract ([] when it has some already, or its side is not known)."""
    rec = store.get(contract_id)
    if not rec or rec.get("kind") != "contract" or rec.get("direction") not in ("sale", "purchase"):
        return []
    if obligations.for_contract(rec["org_id"], contract_id):
        return []
    f = {k: v["value"] for k, v in rec["fields"].items()}
    from app import usage
    try:
        with usage.actor(rec.get("org_id"), rec.get("confirmed_by")), usage.feature("contracts.payment_schedule"):
            plan = proposer(rec)
    except Exception:  # noqa: BLE001 - a schedule is a convenience; the default below still gives one
        log.warning("payment terms of %s could not be read", contract_id, exc_info=True)
        plan = []
    if _sane(plan, f.get("total_value")):
        out = []
        for i, it in enumerate(sorted(plan, key=lambda x: x.due_date), start=1):
            o = obligations.create(rec, it.due_date, it.amount, seq=i, source="ai")
            o.update(estimated=it.estimated, basis=it.basis[:200])
            from app.store import docs
            out.append(docs.save(obligations.IX, o))
        return out
    due = f.get("end_date") or f.get("start_date") or f.get("signed_date")
    return [obligations.create(rec, due, f.get("total_value"), source="default")] if due else []