// CR-056 · P-a plan-frontend-i18n §1: số/giây theo ngôn ngữ UI. Thuần.
const nf = (lang: string) => new Intl.NumberFormat(lang);

/** Số nguyên có phân cách nghìn theo `lang`. */
export const formatTokens = (n: number, lang: string): string => nf(lang).format(n);

/** Giây một chữ số thập phân: `12,0s` (vi) / `12.0s` (en). `null` ⇒ "—". */
export function formatSeconds(ms: number | null, lang: string): string {
  if (ms === null) return "—";
  const f = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${f.format(ms / 1000)}s`;
}

/** Ngày giờ ngắn theo `lang` (lịch sử quay lại, người duyệt). ISO hỏng ⇒ chuỗi gốc. */
export function formatDateTime(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(d);
}
