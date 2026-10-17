"""Thanh toán: the instalments of the contracts a user sees, as one list — what we must pay, what we must collect,
what is overdue. Pure over contracts and obligations, so the route only has to scope them."""
from datetime import date, timedelta

from app.ledger import types as t

FILTERS = ("all", "receive", "pay", "overdue", "done")
DONE_DAYS = 60                 # "Đã xong" shows what was settled in the last two months


def _party(rec: dict) -> str | None:
    side = "buyer" if rec.get("direction") == "sale" else "supplier"
    return rec["fields"][f"{side}_name"]["value"]


def board(recs: list[dict], obligations: list[dict], today: date, filter: str = "all") -> dict:
    by_id = {r["id"]: r for r in recs}
    count: dict[str, int] = {}
    for o in obligations:
        count[o["contract_id"]] = count.get(o["contract_id"], 0) + 1
    rows = []
    for o in obligations:
        rec = by_id.get(o["contract_id"])
        if not rec or o.get("kind", t.PAYMENT) != t.PAYMENT:
            continue
        f = rec["fields"]
        late = (today - date.fromisoformat(o["due_date"])).days
        rows.append({**{k: o.get(k) for k in ("id", "contract_id", "company_id", "direction", "seq", "due_date", "amount",
                                               "status", "done_at", "postpones")},
                     "reminders": o.get("reminders", 0), "of": count[o["contract_id"]],
                     "party": _party(rec), "contract_title": f["title"]["value"] or f["number"]["value"] or rec.get("title"),
                     "days_late": max(0, late) if o["status"] == t.OPEN else 0})
    open_ = [r for r in rows if r["status"] == t.OPEN]        # a cancelled instalment (a renewal lost) is owed by nobody
    week = (today + timedelta(days=7)).isoformat()
    stats = {"receive_open": sum(r["amount"] or 0 for r in open_ if r["direction"] == t.RECEIVE),
             "pay_open": sum(r["amount"] or 0 for r in open_ if r["direction"] == t.PAY),
             "overdue_count": sum(1 for r in open_ if r["days_late"] > 0),
             "overdue_amount": sum(r["amount"] or 0 for r in open_ if r["days_late"] > 0),
             "due_7d": sum(r["amount"] or 0 for r in open_ if r["days_late"] == 0 and r["due_date"] <= week)}
    if filter == "done":
        since = (today - timedelta(days=DONE_DAYS)).isoformat()
        out = sorted((r for r in rows if r["status"] == t.DONE and (r["done_at"] or "") >= since),
                     key=lambda r: r["done_at"] or "", reverse=True)
    else:
        keep = {"receive": lambda r: r["direction"] == t.RECEIVE, "pay": lambda r: r["direction"] == t.PAY,
                "overdue": lambda r: r["days_late"] > 0}.get(filter, lambda r: True)
        out = sorted((r for r in open_ if keep(r)), key=lambda r: (-r["days_late"], r["due_date"]))
    return {"stats": stats, "rows": out}
