"""What each contract obliges: instalments we pay or receive, deliveries due. Settling one writes the partner ledger."""
from datetime import date

from app.companies import store as cstore
from app.contracts.store import now
from app.ledger import events
from app.ledger import types as t
from app.store import docs
from app.store import opensearch as os_store

IX = os_store.OBLIGATIONS


def counterparty(rec: dict) -> tuple[str | None, str, str]:
    """(company_id, direction, role) of a contract: a sale is paid to us by its buyer, a purchase we pay its supplier."""
    sale = rec.get("direction") == "sale"
    side = "buyer" if sale else "supplier"
    party = (rec.get("parties") or {}).get(side) or {}
    cid = party.get("company_id")
    if not cid:
        f = rec["fields"]
        name, tax = f[f"{side}_name"]["value"], f[f"{side}_tax_id"]["value"]
        cid = cstore.company_id(rec["org_id"], tax, name) if (name or tax) else None
    return cid, (t.RECEIVE if sale else t.PAY), (t.CUSTOMER if sale else t.SUPPLIER)


def create(rec: dict, due_date: str, amount: int | None, *, seq: int = 1, kind: str = t.PAYMENT,
           source: str = "manual", status: str = t.OPEN, done_at: str | None = None, obligation_id: str | None = None) -> dict:
    cid, direction, _ = counterparty(rec)
    return docs.save(IX, {
        "id": obligation_id or docs.new_id(), "org_id": rec["org_id"], "contract_id": rec["id"], "company_id": cid,
        "direction": direction, "kind": kind, "seq": seq, "due_date": due_date, "amount": amount, "status": status,
        "done_at": done_at, "postponed_to": None, "postpones": 0, "source": source})


def for_contract(org_id: str, contract_id: str) -> list[dict]:
    return docs.find(IX, org_id, sort="seq", contract_id=contract_id)


def list_org(org_id: str, **terms) -> list[dict]:
    return docs.find(IX, org_id, sort="due_date", **terms)


def get(org_id: str, oid: str) -> dict | None:
    return docs.get_in(IX, org_id, oid)


def _role(ob: dict) -> str:
    return t.CUSTOMER if ob["direction"] == t.RECEIVE else t.SUPPLIER


def settle(ob: dict, at: date, by: str, amount: int | None = None) -> dict:
    """"Đã trả" / "Đã thu" (or a delivery received): done, and the ledger learns how late it was."""
    if ob["status"] != t.OPEN:                 # done, or cancelled (a renewal lost): nothing to pay any more
        raise ValueError("done")
    late = max(0, (at - date.fromisoformat(ob["due_date"])).days)
    ob.update(status=t.DONE, done_at=at.isoformat(), done_by=by)
    docs.save(IX, ob)
    kind = t.DELIVERED if ob["kind"] == t.DELIVERY else (t.RECEIVED if ob["direction"] == t.RECEIVE else t.PAID)
    if ob.get("company_id"):
        events.record(ob["org_id"], ob["company_id"], _role(ob), kind, at, by, contract_id=ob["contract_id"],
                      obligation_id=ob["id"], days_late=late, amount=amount if amount is not None else ob.get("amount"))
    return ob


def postpone(ob: dict, to: date, by: str, today: date, note: str | None = None) -> dict:
    """"Khách hẹn lại": the instalment moves; the partner's ledger keeps that it moved."""
    if ob["status"] != t.OPEN:
        raise ValueError("done")
    if to <= date.fromisoformat(ob["due_date"]):
        raise ValueError("date")
    was = ob["due_date"]
    ob.update(due_date=to.isoformat(), postponed_to=to.isoformat(), postpones=ob.get("postpones", 0) + 1, updated_at=now())
    docs.save(IX, ob)
    if ob.get("company_id"):
        events.record(ob["org_id"], ob["company_id"], _role(ob), t.POSTPONED, today, by,
                      contract_id=ob["contract_id"], obligation_id=ob["id"], note=note, to=to.isoformat(), was=was)
    return ob


def _forget(ob: dict) -> None:
    """An instalment replaced by a new schedule: its "Quá hạn" lines can never be answered now (nothing will settle
    that id), so they are struck off; and nobody is reminded about it any more."""
    from app.ledger import followups
    for e in events.list_for(ob["org_id"], ob.get("company_id")):
        if e.get("obligation_id") == ob["id"] and e["type"] == t.OVERDUE:
            events.void(ob["org_id"], e["id"], t.SYSTEM_BY)
    followups.end_for(ob["org_id"], ob["id"])


def undo(e: dict) -> None:
    """A voided event takes back what it did to its instalment: a payment marked by mistake reopens it, a
    postponement returns the old date, a reminder stops counting. Only while the instalment is still as it left it."""
    ob = get(e["org_id"], e["obligation_id"]) if e.get("obligation_id") else None
    if not ob:
        return
    if e["type"] in (t.PAID, t.RECEIVED, t.DELIVERED) and ob["status"] == t.DONE:
        ob.update(status=t.OPEN, done_at=None, done_by=None)
    elif e["type"] == t.POSTPONED and e.get("was") and ob["status"] != t.DONE and ob["due_date"] == e.get("to"):
        n = max(0, ob.get("postpones", 0) - 1)
        ob.update(due_date=e["was"], postpones=n, postponed_to=None if not n else ob.get("postponed_to"))
    elif e["type"] == t.REMINDED:
        ob["reminders"] = max(0, ob.get("reminders", 0) - 1)
    else:
        return
    ob["updated_at"] = now()
    docs.save(IX, ob)


def remind(ob: dict, at: date, by: str) -> dict:
    """"Đã nhắc": we had to chase the partner; reputation counts how often. Only while it is still owed: a reminder
    about a settled or cancelled instalment would lower a score for nothing."""
    if ob["status"] != t.OPEN:
        raise ValueError("done")
    if ob.get("company_id"):
        events.record(ob["org_id"], ob["company_id"], _role(ob), t.REMINDED, at, by,
                      contract_id=ob["contract_id"], obligation_id=ob["id"])
    ob["reminders"] = ob.get("reminders", 0) + 1
    return docs.save(IX, ob)


def replace_schedule(rec: dict, rows: list[dict], source: str) -> list[dict]:
    """Open instalments are rewritten; settled ones stay, so redoing a schedule never forgets a payment."""
    keep = [o for o in for_contract(rec["org_id"], rec["id"]) if o["status"] == t.DONE]
    for o in for_contract(rec["org_id"], rec["id"]):
        if o["status"] != t.DONE:
            _forget(o)
            docs.delete(IX, o["id"])
    start = max((o["seq"] for o in keep), default=0)
    return keep + [create(rec, r["due_date"], r.get("amount"), seq=start + i + 1, kind=r.get("kind", t.PAYMENT),
                          source=source) for i, r in enumerate(rows)]
