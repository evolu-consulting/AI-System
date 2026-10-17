"""Who signs a contract for each side, read again for contracts read before the buyer's signer was a field.

    python -m app.contracts.signers --owner tien@annam.test        # fills the empty ones of that organisation

The person's own edits are never touched; a name is kept only if its quote is in the contract's text."""
import logging

from pydantic import BaseModel

from app.contracts import store
from app.contracts.verify import norm, quote_found
from app.llm import CLAUDE_KW, claude
from app.settings import settings

log = logging.getLogger(__name__)
SIDES = ("supplier_representative", "buyer_representative")


class _Q(BaseModel):
    value: str | None
    quote: str


class _Signers(BaseModel):
    supplier_representative: _Q
    buyer_representative: _Q


SYSTEM = """From a Vietnamese contract, give who signs for each party: supplier (Bên bán / bên cung cấp) and buyer (Bên mua).
value: "Nguyễn Văn A – Giám đốc" (name, then title when stated; no Ông/Bà), or null if the text names nobody. quote: the
words copied VERBATIM from the text that name that person ("" when null)."""


def _ask(md: str) -> _Signers | None:
    r = claude().beta.messages.parse(max_tokens=600, system=SYSTEM, output_format=_Signers,
                                     messages=[{"role": "user", "content": md[:30_000]}],
                                     **{**CLAUDE_KW, "model": settings.assistant_light_model})
    return r.parsed_output


def fill(rec: dict, ask=_ask) -> bool:
    """Set the empty signer fields of one contract from its text. True if something was set."""
    want = [k for k in SIDES if not rec["fields"][k]["value"] and not rec["fields"][k].get("edited")]
    if not want or not rec.get("source_md"):
        return False
    try:
        got = ask(rec["source_md"])
    except Exception:  # noqa: BLE001 - best effort, the contract stays as it was
        log.warning("signers for %s failed", rec["id"], exc_info=True)
        return False
    md = norm(rec["source_md"])
    changed = False
    for k in want:
        q = getattr(got, k, None) if got else None
        if q and q.value and q.quote and quote_found(q.quote, md):
            rec["fields"][k] = {"value": q.value.strip()[:120], "quote": q.quote, "verified": True, "edited": False}
            changed = True
    if changed:
        store.save(rec)
    return changed


def fill_org(org_id: str, ask=_ask) -> int:
    return sum(fill(r, ask) for r in store.list_org(org_id))


if __name__ == "__main__":
    import argparse

    from app import orgs
    p = argparse.ArgumentParser()
    p.add_argument("--owner", required=True)
    a = p.parse_args()
    m = orgs.membership(a.owner.strip().lower())
    print(fill_org(m["org_id"]), "hợp đồng được điền người ký")
