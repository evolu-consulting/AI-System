import logging
import smtplib
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage

from app.settings import settings
from app.store import opensearch as os_store

log = logging.getLogger(__name__)


def create(user_email: str, contract_id: str, milestone: int, title: str, body: str, link: str | None = None) -> dict:
    """`link`: where the bell takes the person (a contract's page when empty)."""
    n = {"id": str(uuid.uuid4()), "user_email": user_email, "contract_id": contract_id, "milestone": milestone,
         "title": title, "body": body, "link": link or (f"/contracts/{contract_id}" if contract_id else None),
         "created_at": datetime.now(timezone.utc).isoformat(), "read_at": None}
    os_store.client().index(index=os_store.NOTIFICATIONS, id=n["id"], body=n, refresh=True)
    return n


def list_for(email: str, unread_only: bool = False) -> list[dict]:
    must = [{"term": {"user_email": email}}]
    q = {"bool": {"filter": must, **({"must_not": [{"exists": {"field": "read_at"}}]} if unread_only else {})}}
    r = os_store.client().search(index=os_store.NOTIFICATIONS,
                                 body={"query": q, "size": 200, "sort": [{"created_at": "desc"}]})
    return [h["_source"] for h in r["hits"]["hits"]]


def mark_read(notification_id: str, email: str) -> bool:
    r = os_store.client().get(index=os_store.NOTIFICATIONS, id=notification_id, ignore=[404])
    if not r.get("found") or r["_source"]["user_email"] != email:
        return False
    os_store.client().update(index=os_store.NOTIFICATIONS, id=notification_id, refresh=True,
                             body={"doc": {"read_at": datetime.now(timezone.utc).isoformat()}})
    return True


def _smtp_send(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
        if settings.smtp_starttls:
            s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


def send_email(to: str, subject: str, body: str) -> bool:
    if not settings.smtp_host:
        return False
    try:
        msg = EmailMessage()
        msg["From"], msg["To"] = settings.smtp_from or settings.smtp_user, to
        msg["Subject"] = " ".join(subject.splitlines())     # CR/LF would inject headers
        msg.set_content(body)
        _smtp_send(msg)
        return True
    except Exception:  # noqa: BLE001 - the in-app notification already exists; mail is best-effort
        log.warning("reminder email to %s failed", to, exc_info=True)
        return False
