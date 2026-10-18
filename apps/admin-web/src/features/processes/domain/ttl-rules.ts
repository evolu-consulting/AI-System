// ADM-FR-71 · HUB-FR-115 · P-d1 · "Thời hạn lượt chạy (ngày)": 1…365 hoặc null (không hết hạn). Thuần, built-in.
import { PROCESS_TTL_DAYS } from "./limits";

export function ttlIssue(text: string, noExpiry: boolean): "range" | null {
  if (noExpiry) return null;
  const t = text.trim();
  return /^\d+$/.test(t) && Number(t) >= PROCESS_TTL_DAYS.min && Number(t) <= PROCESS_TTL_DAYS.max
    ? null
    : "range";
}

/** Giá trị gửi lên: null = không hết hạn; ô lỗi ⇒ null (người gọi chặn bằng `ttlIssue`). */
export function ttlToValue(text: string, noExpiry: boolean): number | null {
  if (noExpiry || ttlIssue(text, false)) return null;
  return Number(text.trim());
}

export function ttlFromValue(v: number | null): { text: string; noExpiry: boolean } {
  return v === null ? { text: "", noExpiry: true } : { text: String(v), noExpiry: false };
}
