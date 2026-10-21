// V2-J2 · BA v2 §4.4 · intake §4 Q8 (SP-05): đọc kết quả agent dò giá thành dòng giá. Model + lệnh hệ thống (định dạng JSON đầu ra)
// nay ở agent Hub `price-scout` (Studio sửa được — price-scout); lời nhắc dữ liệu ở `price-scout.rules.ts::scoutPrompt`. Kết quả là
// DỮ LIỆU web không tin: parse chặt từng dòng, bỏ dòng sai (giá/URL/ngày, url ở trang bị loại), tối đa 10 dòng. Thuần.
import type { SupplierSearchItem } from "./supplier-prices.types";

export const SEARCH_MAX_ITEMS = 10;
const PRICE_MIN = 1_000;
const PRICE_MAX = 1_000_000_000_000;

export const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

function urlOf(v: unknown): string | null {
  const s = text(v, 2000);
  if (!s) return null;
  try {
    return /^https?:$/.test(new URL(s).protocol) ? s : null;
  } catch {
    return null;
  }
}
export const dateOf = (v: unknown, today: string): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today ? v : null;

function itemOf(raw: unknown, today: string): SupplierSearchItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const supplier = text(r.supplier_name, 300);
  const price = typeof r.price === "number" && Number.isFinite(r.price) ? Math.round(r.price) : 0;
  const url = urlOf(r.url);
  if (!supplier || price < PRICE_MIN || price > PRICE_MAX || !url) return null; // không nguồn ⇒ không tin
  return {
    supplier_name: supplier,
    kind: r.kind === "renew" ? "renew" : "new",
    price,
    unit: text(r.unit, 40),
    url,
    seen_on: dateOf(r.seen_on, today),
    note: text(r.note, 500),
  };
}

/** URL thuộc trang bị loại (tên miền trùng hoặc tên miền con). */
function excluded(url: string | null, sites: readonly string[]): boolean {
  if (!url || sites.length === 0) return false;
  const host = new URL(url).hostname.toLowerCase();
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

/** JSON trong thân trả lời (có thể bọc ```). Hỏng ⇒ null. */
export function jsonOf(reply: string): unknown {
  const m = /\{[\s\S]*\}/.exec(reply.replace(/```(?:json)?/gi, ""));
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Trả lời AI ⇒ dòng giá hợp lệ (null = không đọc được JSON/`items`). Trùng (NCC + loại) giữ giá rẻ nhất. */
export function parseSearchReply(
  reply: string,
  today: string,
  excludeSites: readonly string[] = [],
): SupplierSearchItem[] | null {
  const j = jsonOf(reply) as { items?: unknown } | null;
  if (!j || !Array.isArray(j.items)) return null;
  const best = new Map<string, SupplierSearchItem>();
  for (const raw of j.items) {
    const it = itemOf(raw, today);
    if (!it || excluded(it.url, excludeSites)) continue;
    const key = `${it.supplier_name.toLowerCase()}|${it.kind}`;
    const had = best.get(key);
    if (!had || it.price < had.price) best.set(key, it);
  }
  return [...best.values()].sort((a, b) => a.price - b.price).slice(0, SEARCH_MAX_ITEMS);
}
