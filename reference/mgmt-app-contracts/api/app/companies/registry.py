"""Company facts by MST from VietQR (mirrors the GDT site, no key). Gentle with it: cached, spaced, backs off on 429."""
import logging
import math
import re
import threading
import time
from dataclasses import dataclass

import httpx2 as httpx

log = logging.getLogger(__name__)
URL = "https://api.vietqr.io/v2/business/{}"
INTERVAL = 2.0                  # seconds between calls; 1.5 s got a 429, a burst a 77 s ban, 2.3 s never did
MAX_WAIT = 2.0                  # a request waits this long for a slot at most, then answers "unavailable"
BACKGROUND_WAIT = 120.0         # extraction runs in the background and can queue behind other uploads
TIMEOUT = 20.0                  # an MST VietQR has not seen lately takes it 10-17 s (it asks GDT); a known one 0.3 s
FAST = 4.0                      # what saving a contract waits; slower answers are fetched in the background
TTL = {"found": 86400, "not_found": 3600}


@dataclass
class Lookup:
    result: str                 # found | not_found | unavailable | invalid
    data: dict | None = None
    retry_after: int | None = None


def normalize_tax_id(raw: str | None) -> str | None:
    """10 digits (company), 10+3 (branch, written with a dash), or 12 (personal, the CCCD since 2025-07-01)."""
    s = re.sub(r"[\s.]", "", raw or "")
    if "-" in s and not re.fullmatch(r"\d{10}-\d{3}", s):     # a dash only ever splits off the branch number
        return None
    digits = s.replace("-", "")
    if not digits.isdigit():
        return None
    if len(digits) == 13:
        return f"{digits[:10]}-{digits[10:]}"
    return digits if len(digits) in (10, 12) else None


def is_active(status: str | None) -> bool | None:
    s = (status or "").lower()
    if "đang hoạt động" in s:
        return True
    if any(w in s for w in ("ngừng", "đóng", "chấm dứt")):
        return False
    return None


_client = httpx.Client(timeout=httpx.Timeout(TIMEOUT, connect=2.0), headers={"Accept": "application/json"})
_now, _sleep = time.monotonic, time.sleep
_lock = threading.Lock()
_next_at = 0.0
_cool_until = 0.0
_cache: dict[str, tuple[float, Lookup]] = {}


def clear() -> None:
    global _next_at, _cool_until
    _cache.clear()
    _next_at = _cool_until = 0.0


def _slot(max_wait: float) -> int | None:
    """Reserve the next call slot and wait for it; a number back means busy, retry after that many seconds."""
    global _next_at
    with _lock:
        now = _now()
        if now < _cool_until:
            return math.ceil(_cool_until - now)
        start = max(now, _next_at)
        if start - now > max_wait:
            return math.ceil(start - now)
        _next_at = start + INTERVAL
    if start > now:
        _sleep(start - now)
    return None


def _ask(tax_id: str, timeout: float) -> Lookup:
    global _cool_until
    try:
        r = _client.get(URL.format(tax_id), timeout=httpx.Timeout(timeout, connect=2.0))
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After") or 60)
            with _lock:
                _cool_until = _now() + wait
            log.warning("VietQR rate limit, cooling down %ss", wait)
            return Lookup("unavailable", retry_after=wait)
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.warning("VietQR lookup %s failed: %s", tax_id, e)
        return Lookup("unavailable")
    if body.get("code") == "51":
        return Lookup("not_found")
    d = body.get("data") if body.get("code") == "00" else None
    if not isinstance(d, dict) or not d.get("name"):
        return Lookup("unavailable")
    return Lookup("found", {"tax_id": tax_id, "name": d["name"], "international_name": d.get("internationalName"),
                            "short_name": d.get("shortName"), "address": d.get("address"),
                            "status": d.get("status"), "active": is_active(d.get("status"))})


def lookup(raw: str | None, max_wait: float = MAX_WAIT, timeout: float = TIMEOUT) -> Lookup:
    tax_id = normalize_tax_id(raw)
    if not tax_id:
        return Lookup("invalid")
    hit = _cache.get(tax_id)
    if hit and hit[0] > _now():
        return hit[1]
    deadline = _now() + max_wait
    while True:
        busy = _slot(deadline - _now())
        if busy is None:
            out = _ask(tax_id, timeout)
            if not (out.retry_after and _now() + out.retry_after <= deadline):
                break                       # a short 429 within the budget loops back and waits it out
        elif _now() + busy > deadline:
            return Lookup("unavailable", retry_after=busy)
        else:
            _sleep(busy)
    if out.result in TTL:
        _cache[tax_id] = (_now() + TTL[out.result], out)
    return out
