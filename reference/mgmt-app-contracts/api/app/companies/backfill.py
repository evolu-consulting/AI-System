"""Tie contracts uploaded before the directory existed to it: `python -m app.companies.backfill`.

Asks the registry once per distinct MST, at its own pace (≈1.5 s each), then enriches from the warm cache."""
import math
import time

from app.companies import enrich, registry
from app.contracts import project, store
from app.contracts.fields import CONFIRMED
from app.contracts.verify import warnings_for
from app.store import opensearch as os_store


def main() -> None:
    os_store.ensure_indices()
    recs = [r for r in store.list_all() if r.get("fields")]
    taxes = {t for r in recs for side in ("supplier", "buyer")
             if (t := registry.normalize_tax_id(str((r["fields"].get(f"{side}_tax_id") or {}).get("value") or "")))}
    for i, tax in enumerate(sorted(taxes), 1):
        look = registry.lookup(tax, max_wait=math.inf)
        for _ in range(3):                      # banned anyway: sit the ban out rather than skip the company
            if look.result != "unavailable" or not look.retry_after:
                break
            time.sleep(look.retry_after + 1)
            look = registry.lookup(tax, max_wait=math.inf)
        print(f"[{i}/{len(taxes)}] {tax}: {look.result}")
    for r in sorted(recs, key=lambda r: r["kind"] != "contract"):      # contracts first, addenda inherit from them
        enrich.enrich(r)
        r["warnings"] = warnings_for(r)
        store.save(r)
        if r["status"] in CONFIRMED:
            project.project_contract(r["id"])
    print(f"{len(recs)} contracts linked to the directory")


if __name__ == "__main__":
    main()
