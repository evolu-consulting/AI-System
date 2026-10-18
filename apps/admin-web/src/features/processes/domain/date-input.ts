// HUB-FR-143 · P-d1 · ngày lịch `YYYY-MM-DD` có thật (2026-02-30 ⇒ false). Thuần, built-in.
import { ISO_DATE_RE } from "./limits";

/** Khoá i18n dưới trường `date` khi 400 `VALIDATION_ERROR` path `inputs.i.value`. */
export const DATE_INPUT_INVALID_KEY = "process.inputs.err.date.invalid";

export function isIsoCalendarDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d); // không dùng Date.UTC: năm 0–99 bị đổi thành 19xx
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
