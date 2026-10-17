"""Reputation of every partner of an organisation: the config it uses, the facts from its contracts, its ledger."""
from datetime import date

from app.companies import store as cstore
from app.contracts import products
from app.contracts import store as contracts
from app.contracts.fields import CONFIRMED
from app.contracts.store import now
from app.ledger import events, obligations
from app.ledger import types as t
from app.scoring import config, engine
from app.store import docs
from app.store import opensearch as os_store


def get_config(org_id: str, role: str) -> dict:
    cfg = docs.get(os_store.SCORE_CONFIGS, f"{org_id}:{role}")
    return config.normalise(cfg) if cfg else config.default(role)


def _summary(before: dict, after: dict) -> str:
    """What changed, in one line for the history list."""
    before, after = config.normalise(before), config.normalise(after)
    b = {c["key"]: c for c in before["criteria"]}
    now_keys = {c["key"] for c in after["criteria"]}
    parts = [f"xoá {c['label']}" for c in before["criteria"] if c["key"] not in now_keys]
    for c in after["criteria"]:
        o, name = b.get(c["key"]), c["label"]
        if o is None:
            parts.append(f"thêm {name} {c['weight']}%")
            continue
        if o["label"] != name:
            parts.append(f"đổi tên {o['label']} → {name}")
        if o["enabled"] != c["enabled"]:
            parts.append(f"{'bật' if c['enabled'] else 'tắt'} {name}")
        elif c["enabled"] and o["weight"] != c["weight"]:
            parts.append(f"{name} {o['weight']}→{c['weight']}%")
    for k, v in after["rules"].items():
        if before["rules"].get(k) != v:
            parts.append(f"{k} {before['rules'].get(k)}→{v}")
    return ", ".join(parts) or "lưu lại, không đổi"


def _price_gaps(org_id: str, contract_ids: list[str], today: date) -> dict[str, float]:
    """Supplier company → how far its prices in force sit above the cheapest offer for the same product, averaged (%).
    Offers are contract prices in force and the latest quote of suppliers we have no such price from, as on p03.
    Only products someone else also offers count: being the only seller says nothing about price."""
    offers: dict[str, dict[str, int]] = {}         # product → seller → lowest price
    companies: dict[str, str] = {}                  # seller → company id, for sellers we have a contract with
    for r in products.lines(contract_ids, today.isoformat()):
        if r["role"] != "supplier" or not r["current"] or r["price"] is None:
            continue
        seller = r["party"]["key"] or r["party"]["name"]
        by = offers.setdefault(r["product"], {})
        by[seller] = min(by.get(seller, r["price"]), r["price"])
        if r["party"]["company_id"]:
            companies[seller] = r["party"]["company_id"]
    in_force = {p: set(by) for p, by in offers.items()}
    for q in sorted(docs.find(os_store.QUOTES, org_id), key=lambda q: q["quoted_at"]):
        seller = q.get("supplier_company_id") or q["supplier_name"]
        if q["product"] in in_force and seller not in in_force[q["product"]] and q.get("price"):
            offers[q["product"]][seller] = q["price"]
    gaps: dict[str, list[float]] = {}
    for by in offers.values():
        low = min(by.values())
        if len(by) < 2 or low <= 0:
            continue
        for seller, price in by.items():
            if seller in companies:
                gaps.setdefault(companies[seller], []).append(100 * (price - low) / low)
    return {cid: sum(g) / len(g) for cid, g in gaps.items()}


def _facts(org_id: str, today: date) -> dict[tuple[str, str], dict]:
    """(company, role) → {contracts, first_start, name, price_gap_pct} from the organisation's confirmed contracts."""
    out: dict[tuple[str, str], dict] = {}
    # a CKS renewal the customer took elsewhere never happened: no dealing with them, no tenure (cks/sales.lost)
    confirmed = [r for r in contracts.list_org(org_id) if r.get("org_id") == org_id and r["status"] in CONFIRMED
                 and not r.get("lost_renewal")]
    gaps = _price_gaps(org_id, [r["id"] for r in confirmed], today)
    for r in confirmed:
        if r["kind"] != "contract":
            continue
        cid, _, role = obligations.counterparty(r)
        if not cid:
            continue
        f = out.setdefault((cid, role), {"contracts": 0, "first_start": None, "name": None})
        f["contracts"] += 1
        start = r["fields"]["start_date"]["value"] or r["fields"]["signed_date"]["value"]
        if start and (not f["first_start"] or start < f["first_start"]):
            f["first_start"] = start
        side = "buyer" if role == "customer" else "supplier"
        f["name"] = f["name"] or r["fields"][f"{side}_name"]["value"]
        if role == "supplier" and cid in gaps:
            f["price_gap_pct"] = gaps[cid]
    return out


def partners(org_id: str, today: date, role: str | None = None, cfgs: dict[str, dict] | None = None,
             view=None) -> list[dict]:
    """`view` (access.View): only the partners this member sees; scores still come from the whole ledger."""
    facts = {k: v for k, v in _facts(org_id, today).items() if view is None or view.company(k[0])}
    by: dict[tuple[str, str], list[dict]] = {}
    for e in events.list_for(org_id):
        by.setdefault((e["company_id"], e["role"]), []).append(e)
    roles_of: dict[str, list[str]] = {}
    for cid, r in facts:
        roles_of.setdefault(cid, []).append(r)
    cfgs = cfgs or {}
    rows = []
    for (cid, r), f in facts.items():
        if role and r != role:
            continue
        cfg = cfgs.get(r) or get_config(org_id, r)
        s = engine.score(by.get((cid, r), []), cfg, today, r, f)
        c = cstore.get(cid) or {}
        rows.append({"company_id": cid, "name": c.get("short_name") or c.get("name") or f["name"], "role": r,
                     "roles": sorted(roles_of[cid]), "score": s["score"], "band": s["band"], "reason": s["reason"],
                     "event_count": s["event_count"], "breakdown": s["breakdown"], "adjust": s["adjust"],
                     "contracts": f["contracts"]})
    rows.sort(key=lambda x: (x["score"] is None, -(x["score"] or 0), x["name"] or ""))
    return rows


def one(org_id: str, cid: str, role: str, today: date, view=None) -> dict | None:
    return next((p for p in partners(org_id, today, role, view=view) if p["company_id"] == cid), None)


def preview(org_id: str, role: str, draft: dict, today: date, view=None) -> dict:
    """Each partner's score now and under `draft`; nothing is written."""
    old = {p["company_id"]: p for p in partners(org_id, today, role, view=view)}
    new = partners(org_id, today, role, {role: draft}, view=view)
    changes = [{"company_id": p["company_id"], "name": p["name"], "old": old[p["company_id"]]["score"], "new": p["score"],
                "band_old": old[p["company_id"]]["band"], "band_new": p["band"]}
               for p in new if p["score"] != old[p["company_id"]]["score"]]
    changes.sort(key=lambda c: abs((c["new"] or 0) - (c["old"] or 0)), reverse=True)
    return {"changes": changes, "changed_band": sum(c["band_old"] != c["band_new"] for c in changes), "total": len(new)}


def save_config(org_id: str, role: str, draft: dict, by: str, today: date) -> dict:
    before = get_config(org_id, role)
    cfg = {"id": f"{org_id}:{role}", "org_id": org_id, "role": role, "version": before["version"] + 1,
           "criteria": draft["criteria"], "rules": draft["rules"], "updated_by": by, "updated_at": now()}
    docs.save(os_store.SCORE_CONFIGS, cfg)
    docs.save(os_store.SCORE_HISTORY, {"org_id": org_id, "role": role, "version": cfg["version"], "at": now(), "by": by,
                                       "summary": _summary(before, cfg),
                                       "before": {k: before[k] for k in ("criteria", "rules")},
                                       "after": {k: cfg[k] for k in ("criteria", "rules")}})
    docs.save_many(os_store.SCORE_SNAPSHOTS, [
        {"org_id": org_id, "company_id": p["company_id"], "role": role, "config_version": cfg["version"],
         "score": p["score"], "band": p["band"], "at": now()} for p in partners(org_id, today, role)])
    return cfg


def ratings(org_id: str, cid: str, role: str, today: date) -> dict:
    """The role's hand-rated criteria with this partner's current rating, and every rating given (newest first),
    also on criteria since removed. `counts`: the rating is inside the window, so the score uses it."""
    cfg = get_config(org_id, role)
    rows = [e for e in events.list_for(org_id, cid, role) if e["type"] == t.RATING]
    rows.sort(key=lambda e: (e["at"], e.get("rated_at") or ""), reverse=True)
    names = config.labels(cfg)
    start = engine.window_start(cfg["rules"], today)
    out = []
    for c in cfg["criteria"]:
        if c["kind"] != config.MANUAL:
            continue
        last = next((e for e in rows if e.get("criterion") == c["key"]), None)
        out.append({"key": c["key"], "label": c["label"], "weight": c["weight"], "enabled": c["enabled"],
                    "current": last and {**_rating(last), "counts": last["at"] >= start}})
    return {"criteria": out, "history": [{**_rating(e), "criterion": e["criterion"],
                                          "label": names.get(e["criterion"], "Tiêu chí đã xoá")} for e in rows]}


def _rating(e: dict) -> dict:
    return {"id": e["id"], "value": e["value"], "note": e.get("note"), "by": e["by"], "at": e["at"],
            "rated_at": e.get("rated_at")}


def rate(org_id: str, cid: str, role: str, criterion: str, value: int, note: str | None, by: str, today: date) -> dict:
    """Raises KeyError when the criterion is not one the role's config rates by hand."""
    if criterion not in config.manual_keys(get_config(org_id, role)):
        raise KeyError(criterion)
    return events.record(org_id, cid, role, t.RATING, today, by, source="rating", note=(note or "").strip() or None,
                         criterion=criterion, value=value)


def history(org_id: str, role: str) -> list[dict]:
    return [{k: h[k] for k in ("version", "at", "by", "summary")}
            for h in docs.find(os_store.SCORE_HISTORY, org_id, sort="-version", role=role)]
