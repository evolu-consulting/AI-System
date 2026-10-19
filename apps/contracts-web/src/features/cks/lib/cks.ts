// HD-FR-92…95 · S10/S11 · luật thuần của màn CKS — port `pages/cks/{CksPage,CksCustomerPage,dialogs}.tsx` (ngày theo giờ Việt
// Nam, hạn tự động theo lô, số tiền gõ có dấu chấm, câu báo tải văn bản, câu lỗi theo mã API).
import { ApiError } from "@ai/web-kit/http";

type T = (key: string, o?: Record<string, unknown>) => string;

/** Ngày địa phương (Việt Nam) `YYYY-MM-DD`, cộng `n` ngày (`followups.dayPlus`): trước 07:00 UTC vẫn là hôm qua theo UTC. */
export function dayPlus(n: number, now: Date = new Date()): string {
  const local = new Date(now.getTime() + n * 86_400_000);
  return local.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** "1.650.000" ⇒ 1650000 (bỏ mọi ký tự không phải số, như `dialogs.tsx:8`). */
export const num = (v: FormDataEntryValue | null): number =>
  Number(String(v ?? "").replace(/\D/g, ""));

/** Hạn tự động = ngày ký + `years` năm (29/2 ⇒ 28/2 năm không nhuận) — `dialogs.tsx:114-116`. */
export function autoValid(signed: string, years: number): string {
  const later = `${Number(signed.slice(0, 4)) + years}${signed.slice(4)}`;
  const y = Number(later.slice(0, 4));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return later.endsWith("-02-29") && !leap ? later.replace(/29$/, "28") : later;
}

/** Số ngày từ hôm nay tới `iso` (`CksCustomerPage.tsx:87`). */
export const daysUntil = (iso: string, today = dayPlus(0)): number =>
  Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);

/** Câu báo sau khi tải văn bản (`CksCustomerPage.tsx:59-67`). */
export function uploadReport(
  r: { added: number; skipped: number; unmatched: number; unreadable: number },
  t: T,
): { toast: string | null; issues: string | null } {
  const matched = r.added - r.unmatched;
  const issues = [
    r.unmatched ? t("contracts.cks.customer.unmatched", { n: r.unmatched }) : "",
    r.skipped ? t("contracts.cks.customer.skipped", { n: r.skipped }) : "",
    r.unreadable ? t("contracts.cks.customer.unreadable", { n: r.unreadable }) : "",
  ].filter(Boolean);
  return {
    toast: matched > 0 ? t("contracts.cks.customer.attached", { n: matched }) : null,
    issues: issues.length ? issues.join(" · ") : null,
  };
}

const KNOWN = new Set([
  "CKS_STOCK",
  "CKS_SERIAL_TAKEN",
  "CKS_RENEWAL_OPEN",
  "CKS_RENEWAL_CLOSED",
  "CKS_DATES",
  "NOT_FOUND",
  "AGENT_UNAVAILABLE",
  "VALIDATION_ERROR",
  "PAYLOAD_TOO_LARGE",
]);
/** Câu lỗi theo mã API (không hiện thông điệp thô của máy chủ); mất mạng / khác ⇒ câu chung. */
export function cksErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    if (KNOWN.has(e.code)) return t(`contracts.cks.errors.${e.code}`);
    if (e.code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}
