"""Where each line we sell is bought, what is left on it, and which sales hang on a purchase running out.

Worked out on read from the price lines (`products.lines`) and the sale records' `items[i].source`, so it never goes
stale when a purchase contract is edited or re-projected."""


def _same_unit(a: str | None, b: str | None) -> bool:
    return not a or not b or a.strip().lower() == b.strip().lower()


def _ref(b: dict) -> dict:
    return {"contract_id": b["contract_id"], "number": b["number"], "line": b["line"], "supplier": b["party"],
            "price": b["price"], "unit": b["unit"], "current": b["current"], "status": b["status"],
            "end_date": b["end_date"]}


def sales(lines: list[dict], recs: dict[str, dict]) -> list[dict]:
    """Every sale line in force, with its source purchase line (chosen by a person, else the cheapest in force)."""
    buys: dict[str, list[dict]] = {}
    for b in lines:
        if b["role"] == "supplier":
            buys.setdefault(b["product"], []).append(b)
    out = []
    for s in lines:
        if s["role"] != "customer" or not s["current"]:
            continue
        cands = sorted(buys.get(s["product"], []), key=lambda b: (not b["current"], b["price"] is None, b["price"] or 0))
        items = (recs.get(s["contract_id"]) or {}).get("items") or []
        chosen = (items[s["line"]] if s["line"] < len(items) else {}).get("source")
        src = chosen and next((b for b in cands if (b["contract_id"], b["line"]) == (chosen["contract_id"], chosen["line"])), None)
        mode = "chosen" if src else None
        if not src:
            src = next((b for b in cands if _same_unit(b["unit"], s["unit"])), None)
            mode = "auto" if src else None
        margin = (s["price"] - src["price"] if src and s["price"] is not None and src["price"] is not None
                  and _same_unit(src["unit"], s["unit"]) else None)
        # no purchase at all is not a risk: much of what is sold is the organisation's own service
        risk = (None if not src else "source_ended" if not src["current"]
                else "source_expiring" if src["status"] == "expiring" else None)
        out.append({k: s[k] for k in ("product", "name", "code", "unit", "qty", "price", "contract_id", "number", "line",
                                      "kind", "end_date")}
                   | {"customer": s["party"], "source": src and {**_ref(src), "mode": mode},
                      "candidates": [_ref(b) for b in cands], "margin": margin,
                      "margin_pct": margin / s["price"] * 100 if margin is not None and s["price"] else None,
                      "profit": margin * s["qty"] if margin is not None and s["qty"] else None, "risk": risk})
    return sorted(out, key=lambda x: (x["risk"] is None, x["number"] or "", x["line"]))


def by_supplier(rows: list[dict]) -> list[dict]:
    """For each supplier: how many sale lines and which customers depend on it, how many are at risk."""
    out: dict[str, dict] = {}
    for r in rows:
        if not r["source"]:
            continue
        sup = r["source"]["supplier"]
        s = out.setdefault(sup["key"] or sup["name"], {"supplier": sup, "lines": 0, "customers": set(), "at_risk": 0,
                                                       "profit": 0})
        s["lines"] += 1
        s["customers"].add(r["customer"]["name"])
        s["at_risk"] += r["risk"] is not None
        s["profit"] += r["profit"] or 0
    return sorted(({**s, "customers": sorted(filter(None, s["customers"]))} for s in out.values()),
                  key=lambda s: (-s["at_risk"], -s["lines"]))
