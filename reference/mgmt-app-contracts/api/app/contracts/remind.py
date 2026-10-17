import logging
from datetime import date, datetime, timezone

from app import orgs
from app.contracts import notify, push, store
from app.contracts.clock import VN, today_vn
from app.contracts.fields import CONFIRMED
from app.settings import settings
from app.store import opensearch as os_store

log = logging.getLogger(__name__)
__all__ = ["VN", "today_vn"]   # re-exported from clock; callers use remind.today_vn


DAY_OPTIONS = (60, 30, 14, 7, 3, 1, 0)        # the milestones a person can pick from in their settings
TEAM_FROM = 7                                  # a manager hears about a report's contract from this many days out


def milestones() -> list[int]:
    return sorted({int(x) for x in settings.remind_days.split(",") if x.strip()}, reverse=True)


def prefs(email: str) -> dict:
    """A person's reminder settings; anything they never set follows the system defaults."""
    r = os_store.client().get(index=os_store.USERS, id=email, ignore=[404], _source_includes=["notify"])
    p = (r.get("_source") or {}).get("notify") or {}
    return {"days": p.get("days", milestones()), "email": p.get("email", True),
            "team": p.get("team", True), "price": p.get("price", True)}


def save_prefs(email: str, change: dict) -> dict:
    p = {**prefs(email), **change}
    p["days"] = sorted(set(p["days"]), reverse=True)
    os_store.client().update(index=os_store.USERS, id=email, body={"doc": {"notify": p}}, refresh=True)
    return p


def status_for(rec: dict, today: date) -> str:
    outcome = (rec.get("handled") or {}).get("outcome")
    if outcome == "renewed":
        return "renewed"
    if outcome in ("not_renewed", "replaced"):
        return "terminated"
    end = rec["fields"]["end_date"]["value"]
    if end and today.isoformat() > end:
        return "expired"
    dl = rec.get("action_deadline")
    if dl and (date.fromisoformat(dl) - today).days <= max(milestones() or [0]):
        return "expiring"
    return "active"


def due(deadline: date, today: date, ms: list[int], sent: set[int]) -> tuple[int | None, list[int]]:
    """The one milestone to send today, and older reached ones to mark as sent without sending."""
    left = (deadline - today).days
    reached = [m for m in ms if left <= m]
    if not reached or min(reached) in sent:        # only the nearest milestone is ever worth sending
        return None, []
    now = min(reached)
    return now, [m for m in reached if m != now and m not in sent]


def state_key(rec: dict, milestone: int, email: str, what: str | None = None) -> str:
    """Per deadline and person, so a moved deadline starts afresh and each person keeps their own milestones."""
    return f"remind:{rec['id']}:{what or rec['action_deadline']}:{milestone}:{email}"


def forget(contract_id: str) -> None:
    """Drop a deleted contract's notifications and reminder markers."""
    c = os_store.client()
    c.delete_by_query(index=os_store.NOTIFICATIONS, body={"query": {"term": {"contract_id": contract_id}}},
                      refresh=True, conflicts="proceed")
    # ponytail: _id cannot be prefix-queried, so scan the small state index; key by a field if it ever grows large
    prefix = f"remind:{contract_id}:"
    r = c.search(index=os_store.STATE, body={"query": {"match_all": {}}, "size": 10000, "_source": False})
    ids = [h["_id"] for h in r["hits"]["hits"] if h["_id"].startswith(prefix)]
    if ids:
        c.delete_by_query(index=os_store.STATE, body={"query": {"ids": {"values": ids}}},
                          refresh=True, conflicts="proceed")


def _vi_date(iso: str | None) -> str:
    return "/".join(reversed(iso.split("-"))) if iso else "—"


def _partner(rec: dict, f: dict) -> str:
    """Who the contract is with: the buyer of a sale, the supplier of a purchase (the other side is us); both while
    the side is not known yet, so the notice never names our own company as the partner."""
    seller, buyer = f.get("supplier_name") or "—", f.get("buyer_name") or "—"
    return {"sale": buyer, "purchase": seller}.get(rec.get("direction") or "", f"{seller} → {buyer}")


def _message(rec: dict, milestone: int) -> tuple[str, str]:
    f = {k: v["value"] for k, v in rec["fields"].items()}
    number = f["number"] or "—"
    title = f"Hợp đồng {number} — hạn chót hành động {_vi_date(rec['action_deadline'])}"
    when = "hôm nay" if milestone == 0 else f"còn {milestone} ngày"
    money = f"{int(f['total_value']):,} đ".replace(",", ".") if f["total_value"] is not None else "—"
    body = (f"Hợp đồng {number} với {_partner(rec, f)} cần được xử lý ({when}).\n"
            f"Hạn chót hành động: {_vi_date(rec['action_deadline'])} (hết hạn {_vi_date(f['end_date'])}).\n"
            f"Tự động gia hạn: {'có' if f['auto_renew'] else 'không'}. "
            f"Giá trị: {money}.\n"
            f"Mở hợp đồng: {settings.cm_public_url.rstrip('/')}/contracts/{rec['id']}")
    return title, body


def refresh_statuses(today: date) -> int:
    from app.contracts import project
    changed = 0
    for rec in store.list_all():
        if rec["status"] not in CONFIRMED or rec["kind"] != "contract":
            continue
        try:
            st = status_for(rec, today)
            if st != rec["status"]:
                rec["status"] = st
                store.save(rec)
                project.project_contract(rec["id"])
                changed += 1
        except Exception:  # noqa: BLE001 - one bad record must not stop the others
            log.exception("status refresh failed for contract %s", rec.get("id"))
    return changed


def _send(rec: dict, email: str, what: str, deadline: date, ms: list[int], today: date, message) -> bool:
    """Remind one person about one date of one contract, at the nearest of their milestones not yet sent."""
    def sent_before(m: int) -> bool:
        legacy = what == rec.get("action_deadline") and os_store.get_state(f"remind:{rec['id']}:{what}:{m}")
        return bool(os_store.get_state(state_key(rec, m, email, what)) or legacy)   # legacy: keyed per contract
    now, older = due(deadline, today, ms, {m for m in ms if sent_before(m)})
    if now is None:
        return False
    title, body = message(rec, now)
    p = prefs(email)
    notify.create(email, rec["id"], now, title, body)
    for m in [now, *older]:        # marked before mail, so a mail failure never repeats the in-app reminder
        os_store.set_state(state_key(rec, m, email, what), {"at": today.isoformat(), "sent": m == now})
    push.send(email, title, body.split("\n")[0], f"/contracts/{rec['id']}")
    if p["email"]:
        notify.send_email(email, title, body)
    return True


def _price_message(rec: dict, milestone: int, valid_to: str) -> tuple[str, str]:
    number = rec["fields"]["number"]["value"] or "—"
    n = sum(1 for i in rec.get("items") or [] if i.get("valid_to") == valid_to)
    when = "hôm nay" if milestone == 0 else f"còn {milestone} ngày"
    title = f"Bảng giá HĐ {number} hết hiệu lực {valid_to}"
    body = (f"{n} mặt hàng trong hợp đồng {number} hết hiệu lực giá ngày {valid_to} ({when}).\n"
            f"Mở hợp đồng: {settings.cm_public_url.rstrip('/')}/contracts/{rec['id']}")
    return title, body


def _remind_one(rec: dict, today: date) -> bool:
    m = orgs.membership(rec["owner_email"])
    if not m or m["org_id"] != rec.get("org_id") or m["status"] != "active":
        return False                      # the owner left the organisation: nobody to remind
    sent = False
    if rec.get("action_deadline") and not rec.get("handled"):
        deadline = date.fromisoformat(rec["action_deadline"])
        sent |= _send(rec, m["email"], rec["action_deadline"], deadline, prefs(m["email"])["days"], today, _message)
        boss = orgs.membership(m["manager_email"]) if m.get("manager_email") else None
        if boss and boss["org_id"] == m["org_id"] and boss["status"] == "active" and prefs(boss["email"])["team"]:
            ms = [d for d in prefs(boss["email"])["days"] if d <= TEAM_FROM]
            sent |= _send(rec, boss["email"], rec["action_deadline"], deadline, ms, today, _message)
    if rec["status"] in ("active", "expiring") and prefs(m["email"])["price"]:
        for valid_to in sorted({i["valid_to"] for i in rec.get("items") or [] if i.get("valid_to")}):
            if valid_to >= today.isoformat():          # a price that already lapsed is old news, not a reminder
                sent |= _send(rec, m["email"], f"price-{valid_to}", date.fromisoformat(valid_to),
                              prefs(m["email"])["days"], today, lambda r, n, v=valid_to: _price_message(r, n, v))
    return sent


def remind_contract(contract_id: str, today: date | None = None) -> bool:
    """Run today's reminders for one contract now, e.g. right after it is confirmed, instead of at the next daily run."""
    rec = store.get(contract_id)
    if not settings.remind_enabled or not rec or not _remindable(rec):
        return False
    try:
        return _remind_one(rec, today or today_vn())
    except Exception:  # noqa: BLE001 - runs after the response; the daily run will retry
        log.exception("reminder failed for contract %s", contract_id)
        return False


def _remindable(rec: dict) -> bool:
    return (rec["kind"] == "contract" and rec["status"] in ("active", "expiring", "expired")
            and bool(rec.get("owner_email")))


def run_daily(today: date | None = None) -> int:
    today = today or today_vn()
    refresh_statuses(today)
    sent_count = 0
    for rec in store.list_all():
        if not _remindable(rec):
            continue
        try:
            sent_count += _remind_one(rec, today)
        except Exception:  # noqa: BLE001 - one bad record must not stop the others
            log.exception("reminder failed for contract %s", rec.get("id"))
    return sent_count


def tick(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(VN)
    last = (os_store.get_state("remind:last_run") or {}).get("date")
    if local.hour < settings.remind_hour or last == local.date().isoformat():
        return 0
    n = run_daily(local.date())
    os_store.set_state("remind:last_run", {"date": local.date().isoformat()})
    return n
