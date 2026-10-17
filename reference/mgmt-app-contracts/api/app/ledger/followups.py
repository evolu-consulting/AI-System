"""Hẹn nhắc: a reminder at a date AND time, for one person, about one thing (an instalment, a renewal, a contract,
a partner). Buttons set it as they act ("Khách hẹn lại" → remind me when they promised, "Đã nhắc" → remind me to chase
again, "Gia hạn" → remind me to finish it); "Hẹn nhắc" sets one alone.

At its time the jobs process (connectors/poll.py, every minute) delivers it once: in-app notification, email when SMTP
is set up, push when the person has a device. Until the person says "Xong" or moves it ("Nhắc lại sau"), the
assistant panel shows it as a card. Settling an instalment or finishing a renewal ends its reminders."""
import logging
from datetime import datetime, timedelta, timezone

from app.store import docs
from app.store import opensearch as os_store

log = logging.getLogger(__name__)
IX = os_store.FOLLOWUPS
VN = timezone(timedelta(hours=7))
PENDING, SENT, DONE = "pending", "sent", "done"


def parse_at(s: str) -> str:
    """"2026-11-15T09:00" (what a date-time field sends: Vietnam time) or any ISO time → ISO with +07:00."""
    try:
        dt = datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("at") from None
    dt = dt.replace(tzinfo=VN) if dt.tzinfo is None else dt.astimezone(VN)
    return dt.replace(microsecond=0).isoformat()


def upsert(org_id: str, user_email: str, at: str, title: str, link: str, subject_kind: str, subject_id: str,
           by: str, note: str | None = None, contract_id: str | None = None) -> dict:
    """One open reminder per person and subject: setting it again moves it."""
    open_ = [f for f in docs.find(IX, org_id, user_email=user_email, subject_id=subject_id) if f["status"] != DONE]
    f = open_[0] if open_ else {"id": docs.new_id(), "org_id": org_id, "user_email": user_email,
                                "subject_kind": subject_kind, "subject_id": subject_id, "by": by}
    f.update(at=at, title=title, link=link, note=note, contract_id=contract_id, status=PENDING, sent_at=None)
    return docs.save(IX, f)


def mine(org_id: str, user_email: str, subject_id: str | None = None, include_done: bool = False) -> list[dict]:
    rows = docs.find(IX, org_id, sort="at", user_email=user_email, subject_id=subject_id)
    return rows if include_done else [f for f in rows if f["status"] != DONE]


def get(org_id: str, fid: str) -> dict | None:
    return docs.get_in(IX, org_id, fid)


def done(f: dict) -> dict:
    f.update(status=DONE, done_at=datetime.now(VN).isoformat(timespec="seconds"))
    return docs.save(IX, f)


def snooze(f: dict, at: str) -> dict:
    f.update(at=at, status=PENDING, sent_at=None)
    return docs.save(IX, f)


def end_for(org_id: str, subject_id: str) -> int:
    """The thing is settled: every reminder about it, whoever set it, is done."""
    n = 0
    for f in docs.find(IX, org_id, subject_id=subject_id):
        if f["status"] != DONE:
            done(f)
            n += 1
    return n


def due_now(org_id: str, user_email: str, now: datetime | None = None) -> list[dict]:
    """What the assistant shows: reminders whose time has come and that are not done, delivered or not yet."""
    now = (now or datetime.now(VN)).isoformat()
    return [f for f in mine(org_id, user_email) if f["at"] <= now]


def _deliver(f: dict) -> None:
    from app.contracts import notify, push
    when = datetime.fromisoformat(f["at"]).strftime("%H:%M %d/%m")
    body = (f.get("note") or "") + f"\nĐã hẹn nhắc lúc {when}."
    notify.create(f["user_email"], f.get("contract_id") or "", 0, f["title"], body.strip(), link=f.get("link"))
    notify.send_email(f["user_email"], f"Nhắc việc: {f['title']}", body.strip())
    try:
        push.send(f["user_email"], f["title"], body.strip(), f.get("link") or "/")
    except Exception:  # noqa: BLE001 - push is best-effort; the notification and the card are there anyway
        log.warning("push for follow-up %s failed", f["id"], exc_info=True)


def deliver_due(now: datetime | None = None) -> int:
    """Every organisation's reminders whose time has come, once each (jobs process, every minute)."""
    now = (now or datetime.now(VN)).astimezone(VN).isoformat()
    r = os_store.client().search(index=IX, body={"size": 500, "query": {"bool": {"filter": [
        {"term": {"status": PENDING}}, {"range": {"at": {"lte": now}}}]}}})
    n = 0
    for h in r["hits"]["hits"]:
        f = h["_source"]
        try:
            _deliver(f)
        except Exception:  # noqa: BLE001 - one bad reminder must not stop the others
            log.exception("follow-up %s failed", f["id"])
            continue
        f.update(status=SENT, sent_at=now)
        docs.save(IX, f)
        from app import audit
        audit.write({"kind": "job", "org_id": f["org_id"], "user_email": f["user_email"], "path": "followup_sent",
                     "text": f["title"], "data": {"id": f["id"], "at": f["at"], "subject": f"{f['subject_kind']}:{f['subject_id']}"}})
        n += 1
    return n


def tick() -> int:
    return deliver_due()
