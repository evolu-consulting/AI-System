// ADM-FR-40, ADM-FR-41, ADM-FR-42 · M4-R02, R06 · định dạng và mức quota dùng chung (QuotaBar, QuotaBanner, bảng Tenants/Usage).
// Hàm thuần: `locale` truyền vào (không đọc i18n) để test được.
import type { QuotaLevel } from "@ai/contracts";

export type QuotaKind = "runs" | "tokens" | "usd";

const INTL: Record<string, string> = { vi: "vi-VN", en: "en-US" };
const intl = (locale: string) => INTL[locale] ?? locale;

/** Ngưỡng cảnh báo / vượt (spec M4-R06): từ 80% là `warn`, từ 100% là `over`. */
export const WARN_PCT = 80;
export const OVER_PCT = 100;

/** `used / limit` làm tròn xuống thành %. `limit` rỗng hoặc ≤ 0 → `null` (không giới hạn). */
export function pctOf(used: number, limit: number | null): number | null {
  if (limit === null || !(limit > 0)) return null;
  return Math.floor((used / limit) * 100);
}

export function pctLevel(pct: number | null): QuotaLevel {
  if (pct === null) return "none";
  if (pct >= OVER_PCT) return "over";
  return pct >= WARN_PCT ? "warn" : "none";
}

/** Số lượng: `820`, `1.000` (vi) / `1,000` (en); từ 1 triệu: `4,1M` / `4.1M`. */
export function formatCount(n: number, locale: string): string {
  const l = intl(locale);
  if (Math.abs(n) >= 1_000_000) {
    const m = new Intl.NumberFormat(l, { maximumFractionDigits: 1 }).format(n / 1_000_000);
    return `${m}M`;
  }
  return new Intl.NumberFormat(l).format(n);
}

/** USD: `212,40 US$` (vi) / `$212.40` (en). Nhận chuỗi thập phân của API hoặc số. */
export function formatUsd(value: string | number, locale: string): string {
  return new Intl.NumberFormat(intl(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatQuotaValue(kind: QuotaKind, value: string | number, locale: string): string {
  return kind === "usd" ? formatUsd(value, locale) : formatCount(Number(value), locale);
}
