// HUB-FR-91 · H2b-R02, R03, R07, R10 · luật tag `@` (plan-rules). Thuần. B0: chỉ chữ ký (B4, B6).
import type { Responder } from "@ai/contracts/chat";

export type MentionLocale = "vi" | "en";

/** R03: key agent gần `typed` (≤ 3) — dùng lại `suggestCommands`; key không kèm `@`. */
export function suggestAgents(_typed: string, _keys: readonly string[]): string[] {
  throw new Error("not implemented: suggestAgents");
}

/** R02: tag đầu tiên không thuộc AU; null khi mọi tag hợp lệ. */
export function firstUnknownTag(_tags: readonly string[], _au: ReadonlySet<string>): string | null {
  throw new Error("not implemented: firstUnknownTag");
}

/** R07: kết quả `partial` của run `direct` → `text` + câu tĩnh phần chưa làm (`plan-errors` §2). */
export function directText(
  _r: { status: "partial"; text: string; missing: string },
  _locale: MentionLocale,
): string {
  throw new Error("not implemented: directText");
}

/** R10: `responder` của run `direct` (`name` theo locale, ≤ 100). */
export function responderOf(
  _a: { key: string; name: { vi: string; en: string } },
  _locale: MentionLocale,
): Responder {
  throw new Error("not implemented: responderOf");
}
