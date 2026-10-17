"""The system's own entries in the partner ledger: an instalment whose due date passed with nothing recorded is logged
"Quá hạn" the next day, once per due date (a postponed date that passes too is logged again).

It is what the history shows when nobody pressed anything, and what scoring counts against a partner until the
instalment is settled; the settlement then carries how late it really was (engine._pending_overdue)."""
from datetime import date, timedelta

from app.ledger import events
from app.ledger import types as t
from app.store import docs
from app.store import opensearch as os_store


def _late_ones(today: date) -> list[dict]:
    r = os_store.client().search(index=os_store.OBLIGATIONS, body={"size": 2000, "query": {"bool": {"filter": [
        {"term": {"status": t.OPEN}}, {"range": {"due_date": {"lt": today.isoformat()}}}]}}})
    return [h["_source"] for h in r["hits"]["hits"]]


def sweep(today: date) -> int:
    """Log every newly late instalment of every organisation; returns how many were logged."""
    n = 0
    for ob in _late_ones(today):
        if not ob.get("company_id") or ob.get("overdue_for") == ob["due_date"]:
            continue
        receive = ob["direction"] == t.RECEIVE
        # the partner is the late one when a customer owes us money or a supplier owes us a delivery; our own late
        # payment (or delivery) is ours, logged for the history but never against them
        party_late = (receive and ob["kind"] == t.PAYMENT) or (not receive and ob["kind"] == t.DELIVERY)
        role = t.CUSTOMER if receive else t.SUPPLIER
        events.record(ob["org_id"], ob["company_id"], role, t.OVERDUE,
                      date.fromisoformat(ob["due_date"]) + timedelta(days=1), t.SYSTEM_BY, source="system",
                      contract_id=ob["contract_id"], obligation_id=ob["id"], amount=ob.get("amount"),
                      due_date=ob["due_date"], party_late=party_late, kind=ob["kind"], seq=ob.get("seq"))
        ob["overdue_for"] = ob["due_date"]
        docs.save(os_store.OBLIGATIONS, ob)
        n += 1
    return n


def tick() -> int:
    from app.contracts.clock import today_vn
    return sweep(today_vn())
