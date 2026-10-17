"""Reputation as a pure function: events + config + today (+ a few facts from contracts) → score, band, reasons.
Every criterion is 0–100; only criteria that are enabled and have data count, their weights renormalised.
A criterion rated by hand counts its latest rating in the window; a partner nobody rated has no data on it."""
from datetime import date, timedelta

from app.ledger import types as t
from app.scoring import config


def band(score: int | None, rules: dict) -> str | None:
    if score is None:
        return None
    return "good" if score >= rules["good_from"] else "fair" if score >= rules["fair_from"] else "watch"


def _clamp(x: float, lo: float = 0, hi: float = 100) -> int:
    return int(round(max(lo, min(hi, x))))


def window_start(rules: dict, today: date) -> str:
    return (today - timedelta(days=round(rules["window_months"] * 30.44))).isoformat()


def _in_window(events: list[dict], rules: dict, today: date) -> list[tuple[dict, float]]:
    """(event, weight) inside the window; recent ones count double when the rule says so."""
    start = window_start(rules, today)
    recent = (today - timedelta(days=round(rules["recency_months"] * 30.44))).isoformat()
    out = []
    for e in events:
        if e.get("voided") or e["at"] < start or e["at"] > today.isoformat():
            continue
        out.append((e, 2.0 if rules["recency_boost"] and e["at"] >= recent else 1.0))
    return out


def _on_time(rows: list[tuple[dict, float]], label: str, unit: str) -> dict:
    if not rows:
        return {"value": None, "detail": None}
    w = sum(x for _, x in rows)
    on = sum(x for e, x in rows if not e.get("days_late"))
    late_days = sum((e.get("days_late") or 0) * x for e, x in rows) / w
    n_on, n = sum(1 for e, _ in rows if not e.get("days_late")), len(rows)
    return {"value": _clamp(100 * on / w - 2 * late_days), "detail": f"{label} {n_on}/{n} {unit}", "on": n_on, "total": n}


def _pending_overdue(win: list[tuple[dict, float]], today: str) -> list[tuple[dict, float]]:
    """"Quá hạn" lines the system logged that nothing has answered yet, as late rows growing by the day. Answered:
    the instalment was settled (its own row says how late), or moved to a new date after it went late."""
    settled = {e.get("obligation_id") for e, _ in win if e["type"] in t.SETTLED}
    moved = [(e.get("obligation_id"), e["at"]) for e, _ in win if e["type"] == t.POSTPONED]
    out = []
    for e, x in win:
        if e["type"] != t.OVERDUE or not e.get("party_late") or e.get("obligation_id") in settled:
            continue
        if any(o == e.get("obligation_id") and at >= e["at"] for o, at in moved):
            continue
        days = (date.fromisoformat(today) - date.fromisoformat(e["due_date"])).days
        out.append(({**e, "days_late": max(1, days)}, x))
    return out


def _criteria(win: list[tuple[dict, float]], role: str, facts: dict) -> dict[str, dict]:
    of = lambda *types: [(e, x) for e, x in win if e["type"] in types]   # noqa: E731
    out: dict[str, dict] = {}
    pending = _pending_overdue(win, facts["today"])
    if role == t.CUSTOMER:
        out["payment_on_time"] = _on_time(of(t.RECEIVED) + [p for p in pending if p[0].get("kind") != t.DELIVERY],
                                          "Thanh toán đúng hạn", "đợt")
    else:
        out["delivery_on_time"] = _on_time(of(t.DELIVERED) + [p for p in pending if p[0].get("kind") == t.DELIVERY],
                                           "Giao đúng hạn", "lần")
    renew = of(t.CKS_RENEWED, t.CKS_LAPSED)
    if renew:
        vals = [0 if e["type"] == t.CKS_LAPSED or not e.get("with_us", True)
                else 100 if (e.get("days_before_expiry") or 0) >= 0 else max(0, 100 + 10 * e["days_before_expiry"])
                for e, _ in renew]
        out["cks_renewal"] = {"value": _clamp(sum(vals) / len(vals)), "detail": f"{len(renew)} lần gia hạn chữ ký số"}
    else:
        out["cks_renewal"] = {"value": None, "detail": None}
    reminded = len(of(t.REMINDED))
    has_dealings = bool(of(t.RECEIVED, t.PAID, t.DELIVERED, t.POSTPONED, t.REMINDED))
    per = reminded / max(1, facts.get("contracts") or 1)
    out["reminders"] = {"value": _clamp(100 - 15 * per) if has_dealings else None,
                        "detail": f"Phải nhắc {reminded} lần", "count": reminded}
    kept, moved = len(of(t.APPOINTMENT_KEPT)), len(of(t.POSTPONED, t.APPOINTMENT_MISSED))
    out["appointments"] = {"value": _clamp(100 * kept / (kept + moved)) if kept + moved else None,
                           "detail": f"Giữ hẹn {kept}/{kept + moved} lần", "postponed": len(of(t.POSTPONED))}
    first = facts.get("first_start")
    if first:
        # a first contract already earns trust (40); each year together and each renewal adds to it
        years = max(0.0, (date.fromisoformat(facts["today"]) - date.fromisoformat(first)).days / 365)
        renewals = max(0, (facts.get("contracts") or 1) - 1)
        out["tenure"] = {"value": _clamp(40 + 20 * years + 10 * renewals),
                         "detail": f"Hợp tác {int(years)} năm, gia hạn {renewals} lần"}
    else:
        out["tenure"] = {"value": None, "detail": None}
    complaints = len(of(t.COMPLAINT))
    out["complaints"] = {"value": _clamp(100 - 25 * complaints) if has_dealings or complaints else None,
                         "detail": f"{complaints} lần khiếu nại"}
    if role == t.SUPPLIER:
        gap = facts.get("price_gap_pct")         # % above the cheapest supplier of the same product
        out["price"] = {"value": None if gap is None else _clamp(100 - 5 * gap),
                        "detail": None if gap is None else ("Giá rẻ nhất" if gap <= 0 else f"Đắt hơn {gap:.1f}%")}
    return out


def _reason(score: int | None, role: str, crit: dict, band_: str | None) -> str:
    if score is None:
        return "Chưa đủ dữ liệu để chấm"
    if role == t.SUPPLIER:
        d = crit.get("delivery_on_time") or {}
        if d.get("total"):
            late = d["total"] - d["on"]
            return f"Giao đúng hạn {d['on']}/{d['total']} lần" if late / d["total"] <= 0.05 else f"Giao trễ {late}/{d['total']} lần"
        return "Chưa có lần giao nào"
    nag, moved = crit["reminders"].get("count", 0), crit["appointments"].get("postponed", 0)
    if band_ == "watch" or nag + moved >= 5:
        return f"Phải nhắc thanh toán {nag} lần, dời hẹn {moved} lần"
    return crit["payment_on_time"]["detail"] or "Chưa có đợt thanh toán nào"


def _rated(win: list[tuple[dict, float]], key: str) -> dict:
    """A criterion people rate by hand: the latest rating inside the window (older opinions expire like any event)."""
    rows = sorted((e for e, _ in win if e["type"] == t.RATING and e.get("criterion") == key),
                  key=lambda e: (e["at"], e.get("rated_at") or ""))
    if not rows:
        return {"value": None, "detail": None}
    e = rows[-1]
    return {"value": _clamp(e["value"]), "detail": f"Chấm tay {e['value']}/100 ngày {date.fromisoformat(e['at'][:10]):%d/%m/%Y}", "by": e.get("by"),
            "at": e["at"]}


def score(events: list[dict], cfg: dict, today: date, role: str, facts: dict | None = None) -> dict:
    rules, cfg = cfg["rules"], config.normalise(cfg)
    facts = {**(facts or {}), "today": today.isoformat()}
    win = _in_window(events, rules, today)
    # opinions are not dealings; a "Quá hạn" line is the same dealing as the payment that answers it
    counted = [e for e, _ in win if e["type"] not in (t.MANUAL_ADJUST, t.RATING, t.OVERDUE)]
    crit = _criteria(win, role, facts)
    for c in cfg["criteria"]:
        if c["kind"] == config.MANUAL:
            crit[c["key"]] = _rated(win, c["key"])
    on = [c for c in cfg["criteria"] if c["enabled"] and c["weight"] > 0 and (crit.get(c["key"]) or {}).get("value") is not None]
    adjust = 0
    if rules["manual_adjust"]:
        adjust = max(-10, min(10, sum(e.get("delta") or 0 for e, _ in win if e["type"] == t.MANUAL_ADJUST)))
    # Too few dealings to judge, unless a person rated the partner themselves: that is judging it already
    # (a new organisation has no history yet, and a rating that changes nothing on screen looks broken).
    rated = any(c["kind"] == config.MANUAL for c in on)
    if (len(counted) < rules["min_events"] and not rated) or not on:
        value = None
    else:
        total = sum(c["weight"] for c in on)
        value = _clamp(sum(crit[c["key"]]["value"] * c["weight"] for c in on) / total + adjust)
    b = band(value, rules)
    shown = {c["key"]: {**(crit.get(c["key"]) or {"value": None, "detail": None}), "label": c["label"]}
             for c in cfg["criteria"]}                  # what the owner removed is not shown
    return {"score": value, "band": b, "reason": _reason(value, role, crit, b), "breakdown": shown,
            "adjust": adjust, "event_count": len(counted)}
