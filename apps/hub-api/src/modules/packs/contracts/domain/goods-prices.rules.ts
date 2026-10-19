// HD8-FR-05 · HD8-FR-06 · port NGUYÊN `mgmt-app/api/app/contracts/products.py::lines`, `prices/compare.py` (`product_list`,
// `compare`) và `scoring/service.py::_price_gaps`. Giá theo dòng HĐ đã duyệt, phụ lục thay giá theo HD5 (`applyAppendixPricing`,
// D8-05 thay cạnh SUPERSEDES của graph mgmt). Thuần. Tiền = số nguyên đồng; % chênh giá là số thực như mgmt (chỉ để chấm điểm).
import {
  applyAppendixPricingKeyed,
  type PriceItem,
  type PriceSource,
} from "./appendix-pricing.rules";
import type { Role } from "./scoring-config.rules";

function pushTo<K, V>(m: Map<K, V[]>, key: K, v: V): void {
  const a = m.get(key);
  if (a) a.push(v);
  else m.set(key, [v]);
}

/** Một HĐ đã duyệt (mọi loại) + dòng hàng; bên đối tác đã quy về HĐ gốc khi là phụ lục (`coalesce(ps, s)` của mgmt). */
export type PricedContract = {
  id: string;
  kind: "contract" | "appendix";
  status: string;
  parent: string | null;
  direction: string | null;
  party: string | null;
  party_name: string | null;
  title: string;
  eff: string | null;
  items: PriceItem[];
};
export type Line = {
  product: string;
  name: string;
  price: number | null;
  unit: string | null;
  valid_from: string | null;
  contract_id: string;
  role: Role;
  current: boolean;
  party: { key: string | null; name: string | null };
};
export type Quote = {
  id: string;
  product_key: string;
  product_name: string;
  unit: string | null;
  supplier_name: string;
  supplier_party_key: string;
  price: number;
  quoted_at: string;
  source: "quote" | "website";
  url: string | null;
};

/** `products.LIVE`: chỉ HĐ đang hiệu lực mới có "giá đang áp dụng". */
const LIVE = new Set(["active", "expiring", "renewed"]);

const src = (c: PricedContract): PriceSource => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  effective_date: c.kind === "appendix" ? c.eff : null,
  items: c.items,
});

/** `products.lines`: mọi dòng giá của các HĐ, kèm đối tác và có phải giá đang áp dụng hôm nay không. */
/** Nhóm theo HĐ gốc (phụ lục về gốc), giữ thứ tự HĐ. */
function families(contracts: readonly PricedContract[]): Map<string, PricedContract[]> {
  const groups = new Map<string, PricedContract[]>();
  for (const c of contracts) {
    const root = c.kind === "appendix" && c.parent ? c.parent : c.id;
    pushTo(groups, root, c);
  }
  return groups;
}

const EMPTY_ROOT = (id: string): PriceSource => ({
  id,
  kind: "contract",
  title: "",
  effective_date: null,
  items: [],
});

export function priceLines(contracts: readonly PricedContract[], today: string): Line[] {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const out: Line[] = [];
  for (const [root, fam] of families(contracts)) {
    const head = byId.get(root);
    const parent = head?.kind === "contract" ? src(head) : EMPTY_ROOT(root);
    const apps = fam.filter((c) => c.id !== root).map(src);
    for (const l of applyAppendixPricingKeyed(parent, apps, today)) {
      const c = byId.get(l.source.id);
      if (c) out.push(lineOf(l, c));
    }
  }
  return out;
}

function lineOf(l: ReturnType<typeof applyAppendixPricingKeyed>[number], c: PricedContract): Line {
  return {
    product: l.key,
    name: l.item.name,
    price: l.item.unit_price,
    unit: l.item.unit,
    valid_from: l.valid_from,
    contract_id: c.id,
    role: c.direction === "sale" ? "customer" : "supplier", // không rõ chiều ⇒ mua (như mgmt)
    current: l.superseded_by === null && LIVE.has(c.status) && l.current,
    party: { key: c.party, name: c.party_name },
  };
}

type Offers = Map<string, Map<string, number>>;

/** Giá đang áp dụng thấp nhất của mỗi NCC cho mỗi sản phẩm (+ NCC → khoá đối tác). */
function contractOffers(lines: readonly Line[]) {
  const offers: Offers = new Map();
  const companies = new Map<string, string>();
  for (const r of lines) {
    const seller = r.party.key || r.party.name;
    if (r.role !== "supplier" || !r.current || r.price === null || !seller) continue;
    const by = offers.get(r.product) ?? new Map<string, number>();
    offers.set(r.product, by);
    by.set(seller, Math.min(by.get(seller) ?? r.price, r.price));
    if (r.party.key) companies.set(seller, r.party.key);
  }
  return { offers, companies };
}

/** Báo giá mới nhất của NCC chưa có giá HĐ, chỉ cho sản phẩm đã có giá HĐ. */
function addQuotes(offers: Offers, quotes: readonly Quote[]): void {
  const inForce = new Map([...offers].map(([p, by]) => [p, new Set(by.keys())]));
  for (const q of sortByQuoted(quotes)) {
    const seller = q.supplier_party_key || q.supplier_name;
    const have = inForce.get(q.product_key);
    if (have && !have.has(seller) && q.price) offers.get(q.product_key)?.set(seller, q.price);
  }
}

/** `service._price_gaps`: NCC → giá đang áp dụng cao hơn nơi rẻ nhất cùng sản phẩm bao nhiêu % (trung bình). */
export function priceGaps(lines: readonly Line[], quotes: readonly Quote[]): Map<string, number> {
  const { offers, companies } = contractOffers(lines);
  addQuotes(offers, quotes);
  const gaps = new Map<string, number[]>();
  for (const by of offers.values()) {
    const low = Math.min(...by.values());
    if (by.size < 2 || low <= 0) continue;
    for (const [seller, price] of by) {
      const cid = companies.get(seller);
      if (cid) pushTo(gaps, cid, (100 * (price - low)) / low);
    }
  }
  return new Map([...gaps].map(([cid, g]) => [cid, g.reduce((s, x) => s + x, 0) / g.length]));
}

/** `sorted(quotes, key=quoted_at)` — ổn định (giữ thứ tự thêm khi trùng ngày). */
const sortByQuoted = (qs: readonly Quote[]) =>
  [...qs].sort((a, b) => (a.quoted_at < b.quoted_at ? -1 : a.quoted_at > b.quoted_at ? 1 : 0));

/** `compare._label`: không có danh mục sản phẩm (D8-06) ⇒ "tên (đ/đơn vị)". */
export const productLabel = (name: string, unit: string | null): string =>
  unit ? `${name} (đ/${unit})` : name;

/** `compare.product_list`: sản phẩm có người bán cho mình (dòng mua hoặc báo giá); nhiều NCC nhất lên đầu. */
export function productList(lines: readonly Line[], quotes: readonly Quote[]) {
  const out = new Map<string, { key: string; label: string; unit: string | null }>();
  const sellers = new Map<string, Set<string>>();
  const add = (key: string, seller: string | null) => {
    const s = sellers.get(key) ?? new Set<string>();
    sellers.set(key, s);
    if (seller) s.add(seller);
  };
  for (const r of lines) {
    if (r.role !== "supplier") continue;
    if (!out.has(r.product))
      out.set(r.product, { key: r.product, label: productLabel(r.name, r.unit), unit: r.unit });
    add(r.product, r.party.key || r.party.name);
  }
  for (const q of quotes) {
    if (!out.has(q.product_key))
      out.set(q.product_key, {
        key: q.product_key,
        label: productLabel(q.product_name, q.unit),
        unit: q.unit,
      });
    add(q.product_key, q.supplier_party_key || q.supplier_name);
  }
  const lower = (s: string) => s.toLowerCase();
  return [...out.values()].sort(
    (a, b) =>
      (sellers.get(b.key)?.size ?? 0) - (sellers.get(a.key)?.size ?? 0) ||
      (lower(a.label) < lower(b.label) ? -1 : lower(a.label) > lower(b.label) ? 1 : 0),
  );
}

type Scores = ReadonlyMap<string, { score: number | null; band: string | null }>;

/** Giá HĐ đang áp dụng thấp nhất của mỗi NCC cho một sản phẩm. */
function contractRows(mine: readonly Line[]) {
  const rows = new Map<string, Row>();
  const contractSuppliers = new Set<string>();
  for (const r of mine) {
    if (r.role !== "supplier" || !r.current || r.price === null) continue;
    const key = r.party.key || r.party.name || "";
    contractSuppliers.add(key);
    const had = rows.get(key);
    if (had && had.price <= r.price) continue;
    rows.set(key, {
      supplier: r.party.name ?? "",
      party: key,
      price: r.price,
      unit: r.unit,
      source: { type: "contract", date: r.valid_from, contract_id: r.contract_id },
    });
  }
  return { rows, contractSuppliers };
}

/** `compare.compare`: một sản phẩm, giá từng NCC cạnh điểm uy tín và nguồn giá. Giá thị trường hàng hoá chưa có (D8-08). */
export function compareGoods(
  lines: readonly Line[],
  quotes: readonly Quote[],
  product: string,
  scores: Scores,
) {
  const mine = lines.filter((r) => r.product === product);
  const { rows, contractSuppliers } = contractRows(mine);
  const qs = sortByQuoted(quotes.filter((q) => q.product_key === product));
  for (const q of qs) {
    const key = q.supplier_party_key || q.supplier_name;
    if (contractSuppliers.has(key)) continue; // HĐ đang áp dụng mới là giá thật phải trả
    rows.set(key, {
      supplier: q.supplier_name,
      party: q.supplier_party_key,
      price: q.price,
      unit: q.unit,
      source: { type: q.source, date: q.quoted_at, quote_id: q.id, url: q.url },
    });
  }
  const out = [...rows].map(([key, r]) => {
    const s = scores.get(r.party);
    const known = contractSuppliers.has(key) || scores.has(r.party);
    return { ...r, score: s?.score ?? null, band: s?.band ?? null, is_new: !known };
  });
  out.sort(
    (a, b) =>
      Number(a.is_new) - Number(b.is_new) ||
      Number(a.source.type !== "contract") - Number(b.source.type !== "contract") ||
      a.price - b.price,
  );
  const first = mine[0];
  const name = first ? first.name : (qs[0]?.product_name ?? product);
  return {
    product: { key: product, label: name, unit: first ? first.unit : null },
    rows: out,
    market: { status: "tbd" as const },
  };
}
type Row = {
  supplier: string;
  party: string;
  price: number;
  unit: string | null;
  source: {
    type: "contract" | "quote" | "website";
    date: string | null;
    contract_id?: string;
    quote_id?: string;
    url?: string | null;
  };
};
