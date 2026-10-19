// W1 · "Mua hàng" (port `contracts/products.py::lines` + `contracts/sourcing.py`): thuần, không đọc DB/đồng hồ. Từ các HĐ đã duyệt
// (HĐ gốc + phụ lục, giá phụ lục thay giá gốc — HD5 `applyAppendixPricing`) dựng dòng giá, rồi: mỗi dòng ĐANG BÁN → nguồn mua (người
// chọn, không thì giá mua rẻ nhất còn hiệu lực cùng đơn vị) → lãi → rủi ro nguồn; và mỗi nhà cung cấp kéo theo bao nhiêu dòng bán.
// Quyết định: `current` theo NGÀY hiệu lực của dòng (giá phụ lục có ngày hiệu lực tương lai chưa thay giá cũ) và trạng thái HĐ còn
// sống; mgmt đánh dấu thêm "đã bị thay" theo đồ thị — ở đây ngày hiệu lực đã là nguồn duy nhất (D-HD5-01).
import {
  type SaleLine,
  SOURCING_CANDIDATES_MAX,
  type SourceRef,
  type SourcingOut,
  type SourcingParty,
  type SupplierExposure,
} from "@ai/contracts";
import {
  applyAppendixPricing,
  type PriceItem,
  type PriceSource,
  resolver,
} from "./appendix-pricing.rules";
import { foldVi } from "./fold.rules";

/** Trạng thái HĐ còn hiệu lực cho giá (`products.LIVE`). */
export const LIVE = new Set(["active", "expiring", "renewed"]);

export type RawParty = SourcingParty;
export type RawItem = PriceItem & { ord: number };
export type RawContract = {
  id: string;
  kind: "contract" | "appendix";
  parent_id: string | null;
  title: string;
  number: string | null;
  status: string;
  direction: "sale" | "purchase" | null;
  end_date: string | null;
  effective_date: string | null;
  seller: RawParty;
  buyer: RawParty;
  items: RawItem[];
};
export type RawChoice = {
  sale_contract_id: string;
  sale_line: number;
  source_contract_id: string;
  source_line: number;
};
export type RawSourcing = { contracts: RawContract[]; choices: RawChoice[]; truncated: boolean };

export type PriceLine = {
  product: string;
  name: string;
  code: string | null;
  unit: string | null;
  qty: number | null;
  price: number | null;
  valid_to: string | null;
  contract_id: string;
  number: string | null;
  line: number;
  kind: "contract" | "appendix";
  status: string;
  end_date: string | null;
  role: "customer" | "supplier";
  current: boolean;
  party: SourcingParty;
};

/** Hai đơn vị khớp: một bên rỗng (sau cắt) khớp mọi đơn vị; còn lại bằng nhau không phân biệt hoa/thường. */
const sameUnit = (a: string | null, b: string | null): boolean => {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return !x || !y || x === y;
};

const toSource = (c: RawContract): PriceSource => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  effective_date: c.effective_date,
  items: c.items,
});

/** Phụ lục không nhắc lại bên ký: bên và hướng là của HĐ gốc (`coalesce(parent, own)` như mgmt). */
function sidesOf(c: RawContract, parent: RawContract): { sale: boolean; party: SourcingParty } {
  const sale = (parent.direction ?? c.direction) === "sale";
  const pick = (x: RawContract) => (sale ? x.buyer : x.seller);
  const p = pick(parent);
  return { sale, party: p.key || p.name ? p : pick(c) };
}

/** Mọi dòng giá của một họ HĐ (gốc + phụ lục), `line` = `ord` của dòng trong HĐ chứa nó. */
function familyLines(
  parent: RawContract,
  apps: RawContract[],
  byId: Map<string, RawContract>,
  today: string,
): PriceLine[] {
  const keyOf = resolver(parent.items);
  const priced = applyAppendixPricing(parent, apps.map(toSource), today);
  const seen = new Map<string, number>();
  const out: PriceLine[] = [];
  for (const l of priced) {
    const c = byId.get(l.source.id) as RawContract;
    const n = seen.get(c.id) ?? 0;
    seen.set(c.id, n + 1);
    const item = c.items[n] as RawItem; // dòng của một HĐ xuất hiện theo đúng thứ tự `ord`
    const { sale, party } = sidesOf(c, parent);
    out.push({
      product: keyOf(item),
      name: item.name,
      code: item.code,
      unit: item.unit,
      qty: item.qty,
      price: item.unit_price,
      valid_to: l.valid_to,
      contract_id: c.id,
      number: c.number ?? c.title,
      line: item.ord,
      kind: c.kind,
      status: c.status,
      end_date: c.end_date,
      role: sale ? "customer" : "supplier",
      current: l.current && LIVE.has(c.status),
      party,
    });
  }
  return out;
}

/** `products.lines`: dòng giá của mọi HĐ đã duyệt (phụ lục mồ côi — HĐ gốc không thấy/không duyệt — bị bỏ). */
export function priceLines(contracts: readonly RawContract[], today: string): PriceLine[] {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const apps = new Map<string, RawContract[]>();
  for (const c of contracts)
    if (c.kind === "appendix" && c.parent_id && byId.get(c.parent_id)?.kind === "contract")
      apps.set(c.parent_id, [...(apps.get(c.parent_id) ?? []), c]);
  return contracts
    .filter((c) => c.kind === "contract")
    .flatMap((p) => familyLines(p, apps.get(p.id) ?? [], byId, today));
}

const ref = (b: PriceLine): SourceRef => ({
  contract_id: b.contract_id,
  number: b.number,
  line: b.line,
  supplier: b.party,
  price: b.price,
  unit: b.unit,
  current: b.current,
  status: b.status,
  end_date: b.end_date,
});

/** Còn hiệu lực trước, rồi giá thấp (không giá xếp sau), rồi theo HĐ/dòng cho ổn định. */
const byCandidate = (a: PriceLine, b: PriceLine): number =>
  Number(!a.current) - Number(!b.current) ||
  Number(a.price === null) - Number(b.price === null) ||
  (a.price ?? 0) - (b.price ?? 0) ||
  a.contract_id.localeCompare(b.contract_id) ||
  a.line - b.line;

const at = (c: { contract_id: string; line: number }) => `${c.contract_id}#${c.line}`;

/** Rủi ro nguồn: không có HĐ mua ≠ rủi ro (nhiều dòng bán là dịch vụ tự làm). */
export function riskOf(src: PriceLine | undefined): SaleLine["risk"] {
  if (!src) return null;
  if (!src.current) return "source_ended";
  return src.status === "expiring" ? "source_expiring" : null;
}

type Picked = { src: PriceLine; mode: "chosen" | "auto" } | null;

/** Nguồn của một dòng bán: người chọn (còn là ứng viên) thắng; không thì giá mua rẻ nhất còn hiệu lực cùng đơn vị. */
function pickSource(
  s: PriceLine,
  cands: readonly PriceLine[],
  pick: RawChoice | undefined,
): Picked {
  const chosen =
    pick &&
    cands.find((b) => b.contract_id === pick.source_contract_id && b.line === pick.source_line);
  if (chosen) return { src: chosen, mode: "chosen" };
  const auto = cands.find((b) => sameUnit(b.unit, s.unit));
  return auto ? { src: auto, mode: "auto" } : null;
}

/** Dòng bán kèm ứng viên ĐỦ (dùng kiểm hợp lệ khi đổi nguồn); ra ngoài thì ứng viên gom theo sản phẩm (`report`). */
export type FullSale = SaleLine & { cands: readonly PriceLine[] };

function saleLine(s: PriceLine, cands: readonly PriceLine[], p: Picked): FullSale {
  const src = p?.src;
  const margin =
    src && s.price !== null && src.price !== null && sameUnit(src.unit, s.unit)
      ? s.price - src.price
      : null;
  return {
    product: s.product,
    name: s.name,
    code: s.code,
    unit: s.unit,
    qty: s.qty,
    price: s.price,
    contract_id: s.contract_id,
    number: s.number,
    line: s.line,
    kind: s.kind,
    end_date: s.end_date,
    customer: s.party,
    source: p ? { ...ref(p.src), mode: p.mode } : null,
    cands,
    margin,
    margin_pct: margin !== null && s.price ? (margin / s.price) * 100 : null,
    profit: margin !== null && s.qty ? margin * s.qty : null,
    risk: riskOf(src),
  };
}

const bySaleOrder = (a: FullSale, b: FullSale): number =>
  Number(a.risk === null) - Number(b.risk === null) ||
  (a.number ?? "").localeCompare(b.number ?? "") ||
  a.line - b.line;

/** `sourcing.sales`: dòng bán đang áp dụng + nguồn + ứng viên (ĐỦ — chưa cắt) + lãi + rủi ro. */
export function sales(lines: readonly PriceLine[], choices: readonly RawChoice[]): FullSale[] {
  const buys = new Map<string, PriceLine[]>();
  for (const b of lines) {
    if (b.role !== "supplier") continue;
    const list = buys.get(b.product);
    if (list) list.push(b);
    else buys.set(b.product, [b]);
  }
  for (const v of buys.values()) v.sort(byCandidate);
  const chosen = new Map(choices.map((c) => [`${c.sale_contract_id}#${c.sale_line}`, c]));
  return lines
    .filter((s) => s.role === "customer" && s.current)
    .map((s) => {
      const cands = buys.get(s.product) ?? [];
      return saleLine(s, cands, pickSource(s, cands, chosen.get(at(s))));
    })
    .sort(bySaleOrder);
}
/** `sourcing.by_supplier`: mỗi nhà cung cấp — bao nhiêu dòng bán, khách nào, bao nhiêu dòng rủi ro, tổng lãi. */
export function bySupplier(rows: readonly SaleLine[]): SupplierExposure[] {
  const out = new Map<string, SupplierExposure & { set: Set<string> }>();
  for (const r of rows) {
    if (!r.source) continue;
    const sup = r.source.supplier;
    const k = sup.key ?? sup.name ?? "";
    const s = out.get(k) ?? {
      supplier: sup,
      lines: 0,
      customers: [],
      at_risk: 0,
      profit: 0,
      set: new Set<string>(),
    };
    s.lines += 1;
    if (r.customer.name) s.set.add(r.customer.name);
    s.at_risk += r.risk ? 1 : 0;
    s.profit += r.profit ?? 0;
    out.set(k, s);
  }
  return [...out.values()]
    .map(({ set, ...s }) => ({ ...s, customers: [...set].sort() }))
    .sort((a, b) => b.at_risk - a.at_risk || b.lines - a.lines);
}

/** Gom ứng viên theo sản phẩm, cắt về `SOURCING_CANDIDATES_MAX` nhưng luôn giữ nguồn đang dùng (để ô chọn hiện đúng). */
function candidatesByProduct(rows: readonly FullSale[]): Record<string, SourceRef[]> {
  const out: Record<string, SourceRef[]> = {};
  for (const r of rows) {
    if (r.cands.length === 0) continue; // không có ứng viên ⇒ không có mục (ô chọn không hiện)
    let head = out[r.product];
    if (!head) {
      head = r.cands.slice(0, SOURCING_CANDIDATES_MAX).map(ref);
      out[r.product] = head;
    }
    const s = r.source;
    if (s && !head.some((c) => at(c) === at(s))) {
      const c = r.cands.find((x) => at(x) === at(s));
      if (c) head.push(ref(c));
    }
  }
  return out;
}
export type ReportOpts = {
  contract?: string;
  q?: string;
  risk?: boolean;
  limit?: number;
  offset?: number;
};

/** Chữ để tìm của một dòng bán (khớp `concat_ws(' ', name, number, khách, nhà cung cấp, số HĐ nguồn)` trong SQL). */
const hay = (r: FullSale): string =>
  foldVi(
    [r.name, r.number, r.customer.name, r.source?.supplier.name, r.source?.number]
      .filter((x) => x != null)
      .join(" "),
  );

/**
 * Báo cáo trang từ các dòng bán đã tính (`sales`): lọc theo `contract` (dòng bán của HĐ đó, hoặc dòng bán mua từ HĐ đó) ⇒ số liệu +
 * nhà cung cấp trên tập đó; rồi tìm / lọc rủi ro ⇒ `total`; rồi cắt trang. Chỉ trang đi ra ngoài (không gửi mọi dòng về trình duyệt).
 */
export function reportOf(
  all: readonly FullSale[],
  truncated: boolean,
  o: ReportOpts = {},
): Omit<SourcingOut, "page" | "page_size"> {
  const rows = o.contract
    ? all.filter((r) => r.contract_id === o.contract || r.source?.contract_id === o.contract)
    : all;
  const needle = foldVi(o.q ?? "");
  const hit = rows.filter((r) => (!o.risk || r.risk) && (!needle || hay(r).includes(needle)));
  const page = hit.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? hit.length));
  return {
    stats: {
      lines: rows.length,
      profit: rows.reduce((s, r) => s + (r.profit ?? 0), 0),
      sourced: rows.filter((r) => r.source).length,
      at_risk: rows.filter((r) => r.risk).length,
    },
    total: hit.length,
    lines: page.map(({ cands: _c, ...r }) => r),
    candidates: candidatesByProduct(page),
    suppliers: bySupplier(rows),
    truncated,
  };
}

/** Như `reportOf` từ dữ liệu thô (HĐ + phụ lục + lựa chọn) — dùng trong test. */
export function report(raw: RawSourcing, today: string, o: ReportOpts = {}) {
  return reportOf(sales(priceLines(raw.contracts, today), raw.choices), raw.truncated, o);
}
/** Đổi nguồn hợp lệ: ứng viên phải là một dòng giá mua của cùng sản phẩm với dòng bán (mgmt 422 "Nguồn phải là…"). */
export function isCandidate(
  all: readonly FullSale[],
  sale: { contract_id: string; line: number },
  src: { contract_id: string; line: number },
): boolean {
  const row = all.find((r) => r.contract_id === sale.contract_id && r.line === sale.line);
  return !!row?.cands.some((c) => c.contract_id === src.contract_id && c.line === src.line);
}
