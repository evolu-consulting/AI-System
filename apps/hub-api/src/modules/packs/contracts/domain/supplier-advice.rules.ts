// V2-J2 · BA v2 §3.3 SP-04/05/06: so sánh giá NCC với giá vốn BQ của mình + 4 gợi ý hợp tác. Thuần (không DB/mạng).
// Gợi ý theo ba yếu tố: đã mua bao nhiêu (tỉ trọng chi tiêu), giá (chênh so với nơi rẻ nhất), uy tín (V2-E vai NCC).
import type {
  SupplierAdvice,
  SupplierOverviewOut,
  SupplierPriceKind,
  SupplierPriceRow,
  SupplierPriceSource,
  SupplierSummaryRow,
} from "./supplier-prices.types";

/** Chênh giá còn chấp nhận được / quá cao so với NCC rẻ nhất (%). */
export const GAP_OK_PCT = 5;
export const GAP_HIGH_PCT = 15;
/** NCC chiếm ≥ 50% tiền đã nhập của SP ⇒ nguồn chính (mockup-niti: share>=50). */
export const MAIN_SHARE = 0.5;

type Rep = SupplierPriceRow["reputation"];

export type PurchaseAgg = {
  party_key: string;
  name: string | null;
  qty: string;
  times: number;
  amount: number;
  last_on: string | null;
  last_price: number;
  best_price: number;
};
export type SavedPrice = {
  id: string;
  supplier_name: string;
  party_key: string | null;
  kind: SupplierPriceKind;
  price: number;
  unit: string | null;
  source: Exclude<SupplierPriceSource, "purchase">;
  url: string | null;
  seen_on: string;
};
export type OverviewData = {
  product: SupplierOverviewOut["product"];
  components: { mode: string; avg_cost: number }[];
  purchases: PurchaseAgg[];
  saved: SavedPrice[];
};

/** Giá vốn BQ của SP = BQ của thành phần chính (thành phần đầu có cách lấy hàng ≠ `none`); chưa có kho (0) ⇒ null. */
export function ownAvgCost(components: OverviewData["components"]): number | null {
  const main = components.find((c) => c.mode !== "none");
  return main && main.avg_cost > 0 ? main.avg_cost : null;
}

/** % chênh của `price` so với `base` (làm tròn 1 số lẻ); base ≤ 0/null ⇒ null. */
export function pctOver(price: number, base: number | null): number | null {
  if (base === null || base <= 0) return null;
  return Math.round(((price - base) / base) * 1000) / 10;
}

export type AdviceIn = {
  bought: boolean;
  /** Tỉ trọng tiền đã nhập của NCC trong tổng (0..1). */
  share: number;
  /** % giá của NCC cao hơn NCC rẻ nhất (≥ 0; null = không so được). */
  gapPct: number | null;
  rep: Rep;
};

/**
 * 4 gợi ý (SP-06): Hợp tác tiếp · Duy trì nguồn phụ · Tìm nguồn thay thế · Có thể mua thử.
 * Đã mua: uy tín kém hoặc giá cao > 15% ⇒ thay thế; nguồn chính (≥ 50%) giá chênh ≤ 5% ⇒ hợp tác tiếp; còn lại ⇒ nguồn phụ.
 * Chưa mua: uy tín không kém và giá chênh ≤ 5% ⇒ mua thử; không thì chưa gợi ý (null).
 */
export function adviseSupplier(i: AdviceIn): SupplierAdvice | null {
  const bad = i.rep?.level === "watch";
  const gap = i.gapPct ?? 0;
  if (!i.bought) return !bad && gap <= GAP_OK_PCT ? "trial" : null;
  if (bad || gap > GAP_HIGH_PCT) return "replace";
  return i.share >= MAIN_SHARE && gap <= GAP_OK_PCT ? "keep" : "backup";
}

const repOf = (scores: ReadonlyMap<string, NonNullable<Rep>>, key: string | null): Rep =>
  (key ? scores.get(key) : undefined) ?? null;
const nameOf = (key: string) => key.replace(/^(tax|name):/, "");

/** Dòng giá từ sổ kho: một dòng mỗi NCC = giá nhập gần nhất (Mua mới). */
function purchaseRows(
  d: OverviewData,
  own: number | null,
  scores: ReadonlyMap<string, NonNullable<Rep>>,
): SupplierPriceRow[] {
  return d.purchases.map((p) => ({
    id: null,
    supplier_name: p.name ?? nameOf(p.party_key),
    party_key: p.party_key,
    kind: "new",
    price: p.last_price,
    unit: d.product.unit,
    source: "purchase",
    url: null,
    on: p.last_on,
    vs_own_pct: pctOver(p.last_price, own),
    reputation: repOf(scores, p.party_key),
  }));
}
const savedRows = (
  d: OverviewData,
  own: number | null,
  scores: ReadonlyMap<string, NonNullable<Rep>>,
): SupplierPriceRow[] =>
  d.saved.map((s) => ({
    id: s.id,
    supplier_name: s.supplier_name,
    party_key: s.party_key,
    kind: s.kind,
    price: s.price,
    unit: s.unit,
    source: s.source,
    url: s.url,
    on: s.seen_on,
    vs_own_pct: pctOver(s.price, own),
    reputation: repOf(scores, s.party_key),
  }));

/** Khoá gom NCC: khoá đối tác, thiếu thì tên viết thường. */
const keyOf = (r: Pick<SupplierPriceRow, "party_key" | "supplier_name">) =>
  r.party_key ?? `name:${r.supplier_name.trim().toLowerCase()}`;

/** Bảng so sánh + tóm tắt từng NCC (đã mua bao nhiêu, giá, uy tín, gợi ý). Hàng sắp: giá tăng dần, cùng giá thì mới trước. */
export function buildOverview(
  d: OverviewData,
  scores: ReadonlyMap<string, NonNullable<Rep>>,
): SupplierOverviewOut {
  const own = ownAvgCost(d.components);
  const rows = [...purchaseRows(d, own, scores), ...savedRows(d, own, scores)].sort(
    (a, b) => a.price - b.price || (b.on ?? "").localeCompare(a.on ?? ""),
  );
  const bought = new Map(d.purchases.map((p) => [p.party_key, p]));
  const totalSpend = d.purchases.reduce((s, p) => s + p.amount, 0);
  const low = rows.length ? Math.min(...rows.map((r) => r.price)) : null;
  const groups = new Map<string, SupplierPriceRow[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const suppliers: SupplierSummaryRow[] = [...groups].map(([key, rs]) => {
    const p = bought.get(key);
    const best = Math.min(...rs.map((r) => r.price));
    const rep = rs.find((r) => r.reputation)?.reputation ?? null;
    return {
      supplier_name: p?.name ?? rs[0]?.supplier_name ?? nameOf(key),
      party_key: key,
      bought_qty: p?.qty ?? "0",
      bought_times: p?.times ?? 0,
      bought_amount: p?.amount ?? 0,
      share_pct: p && totalSpend > 0 ? Math.round((p.amount / totalSpend) * 100) : 0,
      last_on: p?.last_on ?? null,
      last_price: p?.last_price ?? null,
      best_price: best,
      reputation: rep,
      advice: adviseSupplier({
        bought: p !== undefined,
        share: p && totalSpend > 0 ? p.amount / totalSpend : 0,
        gapPct: pctOver(best, low),
        rep,
      }),
    };
  });
  suppliers.sort((a, b) => b.bought_amount - a.bought_amount || a.best_price - b.best_price);
  return { product: d.product, own_avg_cost: own, rows, suppliers };
}
