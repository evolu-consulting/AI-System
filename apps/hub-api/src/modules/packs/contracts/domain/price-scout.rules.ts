// price-scout · luật thuần của dò giá thị trường: gộp cấu hình (mặc định hệ thống ⊕ mặc định nhóm ⊕ ghi đè SP), dựng lời nhắc dữ
// liệu gửi agent (CHỈ tên SP + cấu hình dò — riêng tư Q8), lịch dò kế tiếp, trần tháng, quy đổi VAT, cảnh báo giá. Lớp 1.
import {
  PRICE_SCOUT_DEFAULT,
  type PriceScoutConfig,
  type PriceScoutOverride,
  type PriceScoutQuotaRow,
  type PriceScoutUsage,
} from "./price-scout.types";
import type { SupplierSearchItem } from "./supplier-prices.types";

export const SCOUT_AGENT = "price-scout";
export const SCOUT_FEATURE = "contracts.price_scout";
export const SCOUT_APP = "contracts";
/** Trần tháng mặc định của hệ thống khi tenant/platform chưa đặt (env `CONTRACTS_PRICE_SCOUT_MONTHLY` ghi đè). */
export const SCOUT_MONTHLY_DEFAULT = 300;
const VAT_RATE = 0.1;

/** Mặc định nhóm (đầy đủ) = mặc định hệ thống ⊕ cấu hình nhóm đã lưu (đã làm sạch ở adapter). */
export const groupDefaults = (saved: PriceScoutOverride): PriceScoutConfig => ({
  ...PRICE_SCOUT_DEFAULT,
  ...saved,
});

/** Cấu hình hiệu lực của SP = mặc định nhóm ⊕ ghi đè riêng. */
export const effectiveConfig = (
  defaults: PriceScoutConfig,
  override: PriceScoutOverride,
): PriceScoutConfig => ({ ...defaults, ...override });

/**
 * Lời nhắc người dùng gửi agent: MỘT đối tượng JSON dữ liệu (JSON-quote ⇒ chuỗi người dùng không thành chỉ dẫn). CHỈ tên SP +
 * cấu hình dò (từ khoá, quy cách, đơn vị, trang, NCC theo dõi — tên công khai người dùng gõ, khu vực, VAT). Không MST/HĐ/đối tác.
 */
export function scoutPrompt(productName: string, c: PriceScoutConfig): string {
  const data = {
    product: productName.trim().slice(0, 300),
    keywords: c.keywords,
    spec: c.spec,
    unit: c.unit,
    include_sites: c.include_sites,
    exclude_sites: c.exclude_sites,
    watched_suppliers: c.watched_suppliers,
    region: c.region,
    vat: c.vat,
  };
  return JSON.stringify(data);
}

const DAY_MS = 86_400_000;
/** Cùng ngày tháng sau (UTC; 31/1 ⇒ 28|29/2 nhờ kẹp ngày cuối tháng). */
function addMonth(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const n = new Date(d);
  n.setUTCFullYear(y, m, Math.min(d.getUTCDate(), last));
  return n;
}

/** Lần dò theo lịch kế tiếp: tắt / lịch off ⇒ null; chưa dò lần nào ⇒ ngay (`now`); còn lại = lần trước + kỳ. */
export function nextScoutAt(c: PriceScoutConfig, lastAt: Date | null, now: Date): Date | null {
  if (!c.enabled || c.schedule === "off") return null;
  if (!lastAt) return now;
  return c.schedule === "weekly" ? new Date(lastAt.getTime() + 7 * DAY_MS) : addMonth(lastAt);
}

/** SP tới hạn dò theo lịch (cùng luật với câu chọn ở DB — dùng cho test luật). */
export const isDue = (r: { nextAt: Date | null; leaseUntil: Date | null }, now: Date): boolean =>
  r.nextAt !== null &&
  r.nextAt.getTime() <= now.getTime() &&
  (r.leaseUntil === null || r.leaseUntil.getTime() < now.getTime());

export type ScoutLimits = { searches: number | null; tokens: number | null };
/** Trần đang áp: platform ghi đè ?? tenant đặt ?? mặc định hệ thống (token: không trần nếu không ai đặt). */
export function scoutLimits(q: PriceScoutQuotaRow | null, systemSearches: number): ScoutLimits {
  return {
    searches: q?.platform_searches_month ?? q?.searches_month ?? systemSearches,
    tokens: q?.platform_tokens_month ?? q?.tokens_month ?? null,
  };
}

/** Còn được dò thêm `n` lượt tháng này? (hết lượt hoặc hết token ⇒ false). */
export const underCap = (u: Pick<PriceScoutUsage, "searches" | "tokens">, l: ScoutLimits, n = 1) =>
  (l.searches === null || u.searches + n <= l.searches) &&
  (l.tokens === null || u.tokens < l.tokens);

/** Đầu tháng (YYYY-MM-01) của ngày lịch `today`. */
export const monthStart = (today: string): string => `${today.slice(0, 7)}-01`;

/** Giá gồm VAT ⇒ quy về chưa VAT (bảng so sánh lưu giá chưa VAT), ghi chú cách quy đổi. */
export function toExVat(
  items: SupplierSearchItem[],
  vat: PriceScoutConfig["vat"],
): SupplierSearchItem[] {
  if (vat === "excl") return items;
  return items.map((i) => ({
    ...i,
    price: Math.round(i.price / (1 + VAT_RATE)),
    note: `${i.note ? `${i.note} · ` : ""}quy đổi từ giá gồm VAT 10%: ${i.price}`.slice(0, 500),
  }));
}

export type ScoutAlert = {
  kind: "threshold" | "watched";
  detail: string;
  supplier_name: string | null;
  price: number | null;
};
const fold = (s: string) => s.trim().toLowerCase();

/**
 * Cảnh báo sau lượt dò theo lịch: (1) giá thấp nhất lệch giá vốn BQ ≥ `alert_pct`% (BQ 0/null ⇒ không so); (2) NCC theo dõi có giá
 * khác lần lưu trước (`previous`: tên NCC (thường) ⇒ giá mua mới gần nhất).
 */
export function scoutAlerts(
  items: SupplierSearchItem[],
  c: PriceScoutConfig,
  avgCost: number | null,
  previous: ReadonlyMap<string, number>,
): ScoutAlert[] {
  const t = thresholdAlert(items, c.alert_pct, avgCost);
  return [...(t ? [t] : []), ...(c.alert_watched ? watchedAlerts(items, c, previous) : [])];
}

function thresholdAlert(
  items: SupplierSearchItem[],
  alertPct: number | null,
  avgCost: number | null,
): ScoutAlert | null {
  const best = items.filter((i) => i.kind === "new").sort((a, b) => a.price - b.price)[0];
  if (alertPct === null || !best || !avgCost || avgCost <= 0) return null;
  const pct = Math.round(((best.price - avgCost) / avgCost) * 100);
  if (Math.abs(pct) < alertPct) return null;
  return {
    kind: "threshold",
    detail: `Giá thị trường ${pct < 0 ? "thấp" : "cao"} hơn giá vốn ${Math.abs(pct)}%`,
    supplier_name: best.supplier_name,
    price: best.price,
  };
}

function watchedAlerts(
  items: SupplierSearchItem[],
  c: PriceScoutConfig,
  previous: ReadonlyMap<string, number>,
): ScoutAlert[] {
  const watched = new Set(c.watched_suppliers.map(fold));
  return items
    .filter((i) => {
      const before = previous.get(fold(i.supplier_name));
      return (
        i.kind === "new" &&
        watched.has(fold(i.supplier_name)) &&
        before !== undefined &&
        before !== i.price
      );
    })
    .map((i) => ({
      kind: "watched" as const,
      detail: `Giá NCC theo dõi đổi: ${previous.get(fold(i.supplier_name))} → ${i.price}`,
      supplier_name: i.supplier_name,
      price: i.price,
    }));
}
