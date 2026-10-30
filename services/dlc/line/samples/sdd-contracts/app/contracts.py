"""A tiny contract library: create a contract of a known kind with its required fields."""

KINDS = {
    "sale": ["buyer", "seller", "price_cents"],
    "lease": ["tenant", "landlord", "rent_cents"],
}


class ContractError(ValueError):
    pass


def create(kind, fields):
    if kind not in KINDS:
        raise ContractError("kind: unknown contract kind %r" % kind)
    missing = [f for f in KINDS[kind] if f not in fields]
    if missing:
        raise ContractError("%s: required" % missing[0])
    for f in fields:
        if f.endswith("_cents") and not isinstance(fields[f], int):
            raise ContractError("%s: must be an integer number of cents" % f)
    return dict(fields, kind=kind)
