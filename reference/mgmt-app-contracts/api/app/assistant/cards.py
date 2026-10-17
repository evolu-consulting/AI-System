"""Action cards the assistant shows. Built here, never by the model: each action is a path the UI calls as written."""


def money(n: int | None) -> str | None:
    """85 000 000 → "85 tr", 92 500 000 → "92,5 tr", 1 650 000 → "1,65 tr"."""
    if n is None:
        return None
    if n >= 1_000_000_000:
        return f"{n / 1e9:.2f}".rstrip("0").rstrip(".").replace(".", ",") + " tỷ"
    if n >= 1_000_000:
        return f"{n / 1e6:.2f}".rstrip("0").rstrip(".").replace(".", ",") + " tr"
    return f"{n:,}".replace(",", ".") + " đ"


def post(label: str, path: str, body: dict | None = None, primary: bool = False) -> dict:
    return {"label": label, "method": "POST", "path": path, "body": body or {}, "primary": primary}


def link(label: str, href: str, primary: bool = False) -> dict:
    return {"label": label, "href": href, "primary": primary}


def card(id: str, type: str, tone: str, lead: str, title: str, *, amount: int | None = None, body: str | None = None,
         actions: list[dict] | None = None, fields: list[list[str]] | None = None) -> dict:
    return {"id": id, "type": type, "tone": tone, "lead": lead, "title": title, "amount": money(amount),
            "body": body, "actions": actions or [], "fields": fields}
