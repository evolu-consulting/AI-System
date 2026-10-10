// ADM-FR-67 · CR-056 · P-a F5: hàm thuần cho tab Token (định dạng số/giây, gộp cột Cache, nhãn vai) — cùng quy ước với chat-web.
import type { TokenTotals, UsageCall } from "@ai/contracts/chat";

/** Số nguyên có phân cách nghìn theo `lang`. */
export const formatTokens = (n: number, lang: string): string =>
  new Intl.NumberFormat(lang).format(n);

/** Giây một chữ số thập phân (`12,0s`); `null` ⇒ "—". */
export function formatSeconds(ms: number | null, lang: string): string {
  if (ms === null) return "—";
  const f = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${f.format(ms / 1000)}s`;
}

/** Cột Cache = đọc + ghi cache. */
export const cacheOf = (t: TokenTotals): number => t.cache_read + t.cache_write;

export const roleKey = (r: UsageCall["role"]): string =>
  `process.usage.role.${r === "plan" || r === "member" ? r : "agent"}`;

export const modelLabel = (m: string | null): string => m ?? "—";
