// gap-d1 #19 · BA v2 KN-09: bảng rủi ro phụ thuộc NCC của một SP = hợp của NCC đã mua (tỉ trọng giá trị nhập kho) và NCC đã khai báo ở
// "Cách lấy hàng" (nguồn dự phòng). Thuần.
import type { DependencyRow, ProductSourceOut } from "./product-sources.types";

export type PurchaseShare = { party_key: string; name: string | null; amount: number };

export const HIGH_SHARE_PCT = 70;
export const MID_SHARE_PCT = 50;

type Level = DependencyRow["level"];

/** Mức rủi ro của một NCC: nguồn đơn ⇒ high; ≥ 70% giá trị ⇒ high (không dự phòng) / medium; ≥ 50% ⇒ medium (không dự phòng) / low. */
export function levelOf(share: number, hasBackup: boolean): Level {
  if (!hasBackup)
    return share >= HIGH_SHARE_PCT ? "high" : share >= MID_SHARE_PCT ? "medium" : "low";
  return share >= HIGH_SHARE_PCT ? "medium" : "low";
}

export function dependencyRisk(
  sources: readonly ProductSourceOut[],
  purchases: readonly PurchaseShare[],
): { risk: DependencyRow[]; single_source: boolean } {
  const total = purchases.reduce((s, p) => s + p.amount, 0);
  const by = new Map<string, DependencyRow>();
  for (const p of purchases)
    by.set(p.party_key, {
      supplier_name: p.name ?? p.party_key,
      party_key: p.party_key,
      share_pct: total > 0 ? Math.round((p.amount * 100) / total) : 0,
      declared: false,
      lead_days: null,
      level: "low",
    });
  for (const s of sources) {
    const had = by.get(s.party_key);
    by.set(s.party_key, {
      supplier_name: s.supplier_name,
      party_key: s.party_key,
      share_pct: had?.share_pct ?? 0,
      declared: true,
      lead_days: s.lead_days,
      level: "low",
    });
  }
  const rows = [...by.values()];
  const single = rows.length === 1;
  const risk = rows
    .map((r) => ({
      ...r,
      level: single ? ("high" as const) : levelOf(r.share_pct, rows.length > 1),
    }))
    .sort((a, b) => b.share_pct - a.share_pct || a.supplier_name.localeCompare(b.supplier_name));
  return { risk, single_source: single };
}
