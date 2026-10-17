"""The partner ledger: an append-only list of what happened with each partner. Reputation is computed from it."""
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date

from app.contracts.store import now
from app.ledger import types as t
from app.store import docs
from app.store import opensearch as os_store

IX = os_store.PARTNER_EVENTS
_VIA: ContextVar[str] = ContextVar("event_source", default="action")


@contextmanager
def via(source: str) -> Iterator[None]:
    """Events written inside are marked as coming from `source` (the assistant acting for a person), so the history
    tells a click from a request in chat."""
    token = _VIA.set(source)
    try:
        yield
    finally:
        _VIA.reset(token)


def record(org_id: str, company_id: str, role: str, type: str, at: str | date, by: str, *, source: str | None = None,
           contract_id: str | None = None, obligation_id: str | None = None, certificate_id: str | None = None,
           days_late: int | None = None, amount: int | None = None, note: str | None = None, **extra) -> dict:
    if type not in t.EVENT_TYPES:
        raise ValueError(f"event type {type}")
    if role not in t.ROLES:
        raise ValueError(f"role {role}")
    if type == t.MANUAL_ADJUST:
        delta = extra.get("delta")
        if not isinstance(delta, int) or not -10 <= delta <= 10 or delta == 0:
            raise ValueError("delta")
        if not (note or "").strip():
            raise ValueError("note")
    if type == t.RATING:
        v, crit = extra.get("value"), extra.get("criterion")
        if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 100:
            raise ValueError("value")
        if not isinstance(crit, str) or not crit.startswith("custom:"):
            raise ValueError("criterion")
        extra["rated_at"] = now()           # several ratings on one day: the last one is the rating
    return docs.save(IX, {
        "org_id": org_id, "company_id": company_id, "role": role, "type": type,
        "at": at.isoformat() if isinstance(at, date) else at, "by": by, "source": source or _VIA.get(),
        "contract_id": contract_id, "obligation_id": obligation_id, "certificate_id": certificate_id,
        "days_late": days_late, "amount": amount, "note": note, "voided": False, **extra})


def list_for(org_id: str, company_id: str | None = None, role: str | None = None, include_voided: bool = False) -> list[dict]:
    rows = docs.find(IX, org_id, sort="at", company_id=company_id, role=role)
    return rows if include_voided else [e for e in rows if not e.get("voided")]


def void(org_id: str, event_id: str, by: str) -> dict | None:
    """Nothing is deleted: the event is marked void, so the history still shows what was recorded and undone."""
    e = docs.get_in(IX, org_id, event_id)
    if not e:
        return None
    e.update(voided=True, voided_by=by, voided_at=now())
    return docs.save(IX, e)
