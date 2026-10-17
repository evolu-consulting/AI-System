"""Product categories ("dịch vụ"): the organisation's own list and which product sits in which.

One document per organisation; products are graph projections, so their category lives here, keyed by product key."""
import logging
import threading
import uuid

from pydantic import BaseModel

from app.ingest.resolve import match_form
from app.llm import CLAUDE_KW, claude
from app.settings import settings
from app.store import opensearch as os_store

log = logging.getLogger(__name__)


def get(org_id: str) -> dict:
    r = os_store.client().get(index=os_store.CATALOGS, id=org_id, ignore=[404])
    doc = r["_source"] if r.get("found") else {"org_id": org_id, "categories": [], "assign": []}
    doc.setdefault("aliases", [])     # [{product, into, name, code, spec}]: a product merged into another
    doc.setdefault("decided", [])     # products a person placed or took out by hand: the AI leaves them be
    return doc


def save(doc: dict) -> dict:
    os_store.client().index(index=os_store.CATALOGS, id=doc["org_id"], body=doc, refresh=True)
    return doc


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def by_product(doc: dict) -> dict[str, dict]:
    """product key → {id, name} of its category."""
    named = {c["id"]: c for c in doc["categories"]}
    return {a["product"]: named[a["category"]] for a in doc["assign"] if a["category"] in named}


def assign(doc: dict, product: str, category: str | None) -> None:
    doc["assign"] = [a for a in doc["assign"] if a["product"] != product]
    if category:
        doc["assign"].append({"product": product, "category": category})


def aliases(doc: dict) -> dict[str, str]:
    """product key as the contract text gives it → the product it was merged into."""
    return {a["product"]: a["into"] for a in doc["aliases"]}


def alias_map(org_id: str | None) -> dict[str, str]:
    return aliases(get(org_id)) if org_id else {}


class _Guess(BaseModel):
    index: int
    category_id: str | None


class _Guesses(BaseModel):
    items: list[_Guess]


SYSTEM = """You sort a Vietnamese company's purchased and sold products into ITS OWN categories.
You get the category list (id: name) and numbered products (name, code, spec, unit). For each product return its index
and the id of the one category it belongs to, or null when none fits. Never invent a category id."""


def guess(products: list[dict], categories: list[dict]) -> dict[str, str | None]:
    """product key → a category id from `categories` (callers drop anything else). Best effort: {} on failure."""
    if settings.fake_llm or not products or not categories:
        return {}
    text = "CATEGORIES:\n" + "\n".join(f"{c['id']}: {c['name']}" for c in categories) + "\n\nPRODUCTS:\n" + "\n".join(
        f"{i}. {p['name']} | {p.get('code') or ''} | {p.get('spec') or ''} | {p.get('unit') or ''}"
        for i, p in enumerate(products))
    try:
        if settings.llm_provider == "openai":
            from app.ingest.extract import _openai_parse
            out = _openai_parse(SYSTEM, text, _Guesses)
        else:
            r = claude().beta.messages.parse(max_tokens=8000, system=SYSTEM, output_format=_Guesses,
                                             messages=[{"role": "user", "content": text}], **CLAUDE_KW)
            out = r.parsed_output
    except Exception:  # noqa: BLE001 - a suggestion is optional
        log.warning("category suggestion failed", exc_info=True)
        return {}
    return {products[g.index]["key"]: g.category_id for g in (out.items if out else []) if 0 <= g.index < len(products)}


class _Sort(BaseModel):
    index: int
    category_id: str | None = None      # one of the list
    new_category: str | None = None     # or a new group, when none fits


class _Sorts(BaseModel):
    items: list[_Sort]


SORT = """You sort a Vietnamese company's purchased and sold goods and services into a FEW broad categories ("Loại
hàng"), for filtering its contract list. You get its current categories (id: name, maybe none) and numbered products
(name | code | spec | unit). For each product give its index and EITHER the id of the existing category it belongs to
OR, only when none fits, a new category name: 1–3 Vietnamese words, broad and reusable (e.g. "Bao bì", "Nguyên liệu",
"Thực phẩm", "Vận chuyển", "Phần mềm", "Văn phòng phẩm", "Chữ ký số"), never a single product's name. Give the same
new name to every product that belongs together; keep the total number of categories small (about 8 at most).
Never invent a category id."""
MAX_CATEGORIES = 12
_sorting = threading.Lock()


def _ask_sort(products: list[dict], categories: list[dict]) -> list[_Sort]:
    text = "CATEGORIES:\n" + ("\n".join(f"{c['id']}: {c['name']}" for c in categories) or "(none yet)") + \
           "\n\nPRODUCTS:\n" + "\n".join(f"{i}. {p['name']} | {p.get('code') or ''} | {p.get('spec') or ''} | "
                                         f"{p.get('unit') or ''}" for i, p in enumerate(products))
    # a cheap model: sorting names into groups needs no deep reasoning
    r = claude().beta.messages.parse(max_tokens=8000, system=SORT, output_format=_Sorts,
                                     messages=[{"role": "user", "content": text}],
                                     **{**CLAUDE_KW, "model": settings.assistant_light_model})
    return r.parsed_output.items if r.parsed_output else []


def autosort(org_id: str, products: list[dict]) -> int:
    """Products with no category yet go into one, made by the AI when none fits; a person's choice is never
    touched. Best effort, returns how many were sorted (0 on failure)."""
    if settings.fake_llm or settings.llm_provider != "anthropic":
        return 0
    with _sorting:                     # two confirmations at once must not both create "Bao bì"
        doc = get(org_id)
        skip = set(by_product(doc)) | set(doc["decided"])
        todo = [p for p in products if p["key"] not in skip][:200]
        if not todo:
            return 0
        try:
            got = _ask_sort(todo, doc["categories"])
        except Exception:  # noqa: BLE001 - a suggestion is optional
            log.warning("category autosort failed", exc_info=True)
            return 0
        ids = {c["id"] for c in doc["categories"]}
        by_name = {match_form(c["name"]): c["id"] for c in doc["categories"]}
        n = 0
        for g in got:
            if not 0 <= g.index < len(todo):
                continue
            cid = g.category_id if g.category_id in ids else None
            name = (g.new_category or "").strip()[:40]
            if not cid and name:
                cid = by_name.get(match_form(name))
                if not cid and len(doc["categories"]) < MAX_CATEGORIES:
                    cid = new_id()
                    doc["categories"].append({"id": cid, "name": name[0].upper() + name[1:], "auto": True})
                    ids.add(cid)
                    by_name[match_form(name)] = cid
            if cid:
                assign(doc, todo[g.index]["key"], cid)
                n += 1
        if n:
            save(doc)
        return n


def autosort_org(org_id: str) -> int:
    """Every product of the organisation's contracts that has no category yet."""
    from app import usage
    from app.contracts import products, store
    from app.contracts.clock import today_vn
    ids = [r["id"] for r in store.list_org(org_id)]
    with usage.actor(org_id), usage.feature("contracts.sort_categories"):     # also run by the poller, off any request
        return autosort(org_id, products.summary(products.lines(ids, today_vn().isoformat()))) if ids else 0


def tick() -> int:
    """Products that came in another way (a CKS sale, a lot, an import) are sorted within minutes too."""
    r = os_store.client().search(index=os_store.ORGS, body={"size": 1000, "query": {"match_all": {}}, "_source": False})
    return sum(autosort_org(h["_id"]) for h in r["hits"]["hits"])


class _Twin(BaseModel):
    index: int
    name: str


class _Twins(BaseModel):
    groups: list[list[_Twin]]


TWINS = """You find duplicate products in a Vietnamese company's price lists: the SAME goods or service written in
different words, abbreviations or codes (e.g. "DN CM 1 năm" = "Tổ chức, doanh nghiệp - Thuê bao đăng ký mới - 1 Năm").
Variants are NOT duplicates: a different term, size, quantity tier, package, option or customer type is a different
product: new vs renewal (đăng ký mới / cấp mới vs gia hạn), and a product for a person — including "cá nhân thuộc tổ
chức doanh nghiệp", a person employed by a company — vs one for the organisation itself ("tổ chức, doanh nghiệp", "DN"). Each line gives a price and its supplier: the same product bought or sold twice is priced alike, so prices
far apart (say more than double) mean different products. Only group products you are sure are identical; when in
doubt leave them out. Return groups, each two or more products that are one and the same; give every product as its
index AND its name copied exactly."""


def twins(products: list[dict]) -> list[list[str]]:
    """Groups of product keys the model takes for the same product. Best effort: [] on failure."""
    if settings.fake_llm or len(products) < 2:
        return []
    def price(p: dict) -> str:
        best = p.get("buy_price") or p.get("sell_price")
        return f"{best['price']} VND/{best.get('unit') or p.get('unit') or '?'} ({best.get('party') or ''})" if best else ""
    text = "\n".join(f"{i}. {p['name']} | {p.get('code') or ''} | {p.get('spec') or ''} | {price(p)}"
                     for i, p in enumerate(products))
    try:
        if settings.llm_provider == "openai":
            from app.ingest.extract import _openai_parse
            out = _openai_parse(TWINS, text, _Twins)
        else:
            out = claude().beta.messages.parse(max_tokens=8000, system=TWINS, output_format=_Twins,
                                               messages=[{"role": "user", "content": text}], **CLAUDE_KW).parsed_output
    except Exception:  # noqa: BLE001 - a suggestion is optional
        log.warning("duplicate search failed", exc_info=True)
        return []
    by_name: dict[str, list[int]] = {}
    for i, p in enumerate(products):
        by_name.setdefault(match_form(p["name"]), []).append(i)

    def where(t: _Twin) -> int | None:
        """The product the model meant: its index when the copied name agrees, else the one product of that name."""
        if 0 <= t.index < len(products) and match_form(products[t.index]["name"]) == match_form(t.name):
            return t.index
        hits = by_name.get(match_form(t.name), [])
        return hits[0] if len(hits) == 1 else None
    groups = [sorted({i for t in g if (i := where(t)) is not None}) for g in (out.groups if out else [])]
    return [[products[i]["key"] for i in g] for g in groups if len(g) > 1]
