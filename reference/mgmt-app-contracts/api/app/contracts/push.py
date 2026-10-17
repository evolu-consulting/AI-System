"""Web Push: a reminder pops up on the person's computer or phone even with the site closed."""
import base64
import json
import logging
from urllib.parse import urlparse

from app.settings import settings
from app.store import opensearch as os_store

log = logging.getLogger(__name__)
MAX_DEVICES = 10
# Only the browsers' own push services: an endpoint is a URL the server will POST to, so anything else is SSRF.
PUSH_HOSTS = ("fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com")


def valid_endpoint(url: str) -> bool:
    try:
        u = urlparse(url)
        host, port = (u.hostname or "").lower(), u.port
    except ValueError:                    # a malformed port
        return False
    return (u.scheme == "https" and port in (None, 443) and not u.username
            and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS))


def devices(email: str) -> list[dict]:
    r = os_store.client().get(index=os_store.USERS, id=email, ignore=[404], _source_includes=["push_subs"])
    return (r.get("_source") or {}).get("push_subs") or []


def _store(email: str, subs: list[dict]) -> None:
    os_store.client().update(index=os_store.USERS, id=email, body={"doc": {"push_subs": subs}}, refresh=True)


def subscribe(email: str, sub: dict) -> None:
    keep = [s for s in devices(email) if s["endpoint"] != sub["endpoint"]]
    _store(email, [*keep, sub][-MAX_DEVICES:])


def unsubscribe(email: str, endpoint: str) -> None:
    _store(email, [s for s in devices(email) if s["endpoint"] != endpoint])


def _deliver(sub: dict, payload: str) -> int:
    from pywebpush import WebPushException, webpush
    try:
        r = webpush(sub, payload, vapid_private_key=settings.vapid_private_key,
                    vapid_claims={"sub": settings.vapid_subject}, ttl=86400, timeout=10)
        return r.status_code
    except WebPushException as e:
        return e.response.status_code if e.response is not None else 0


def send(email: str, title: str, body: str, url: str = "/") -> int:
    """Best effort, like email: the in-app notification already exists. Returns how many devices took it."""
    if not settings.vapid_private_key:
        return 0
    payload, ok, gone = json.dumps({"title": title, "body": body, "url": url}), 0, []
    for sub in devices(email):
        try:
            status = _deliver(sub, payload)
        except Exception:  # noqa: BLE001 - one unreachable device must not stop the rest
            log.warning("push to %s failed", email, exc_info=True)
            continue
        if status in (404, 410):          # the browser dropped the subscription
            gone.append(sub["endpoint"])
        ok += 200 <= status < 300
    if gone:
        _store(email, [s for s in devices(email) if s["endpoint"] not in gone])
    return ok


if __name__ == "__main__":       # prints a fresh key pair as .env lines
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    key = ec.generate_private_key(ec.SECP256R1())
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    print(f"VAPID_PUBLIC_KEY={b64(pub)}")
    print(f"VAPID_PRIVATE_KEY={b64(key.private_numbers().private_value.to_bytes(32, 'big'))}")
