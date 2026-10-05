// HUB-FR-91 · H2b-R02, R03, R07, R10 · luật tag `@` (plan-rules; câu chữ plan-errors §2). Thuần.
import { RESPONDER_NAME_MAX, type Responder } from "@ai/contracts/chat";
import { suggestCommands } from "../commands/suggest.rules";

export type MentionLocale = "vi" | "en";

/** plan-errors §2: tiền tố phần chưa làm của run `direct` (nối sau `"\n\n"`). */
export const PARTIAL_PREFIX: Record<MentionLocale, string> = {
  vi: "Phần chưa làm được: ",
  en: "Not done yet: ",
};

/** R03: key agent gần `typed` (≤ 3) — dùng lại `suggestCommands`; `typed` lower; key không kèm `@`. */
export function suggestAgents(typed: string, keys: readonly string[]): string[] {
  return suggestCommands(
    typed.toLowerCase(),
    keys.map((k) => ({ name: k, aliases: [] })),
  );
}

/** R02: tag đầu tiên không thuộc AU; null khi mọi tag hợp lệ. */
export function firstUnknownTag(tags: readonly string[], au: ReadonlySet<string>): string | null {
  return tags.find((t) => !au.has(t)) ?? null;
}

/** R07: kết quả `partial` của run `direct` → `text` + câu tĩnh phần chưa làm (`plan-errors` §2). */
export function directText(
  r: { status: "partial"; text: string; missing: string },
  locale: MentionLocale,
): string {
  return `${r.text}\n\n${PARTIAL_PREFIX[locale]}${r.missing}`;
}

/** Cắt ≤ `max` đơn vị UTF-16, không tách cặp surrogate. */
function cutUtf16(s: string, max: number): string {
  if (s.length <= max) return s;
  const hi = s.charCodeAt(max - 1);
  return s.slice(0, hi >= 0xd800 && hi <= 0xdbff ? max - 1 : max);
}

/** R10: `responder` của run `direct` (`name` theo locale, ≤ 100 đơn vị UTF-16 không tách surrogate). */
export function responderOf(
  a: { key: string; name: { vi: string; en: string } },
  locale: MentionLocale,
): Responder {
  return { key: a.key, name: cutUtf16(a.name[locale], RESPONDER_NAME_MAX) };
}
