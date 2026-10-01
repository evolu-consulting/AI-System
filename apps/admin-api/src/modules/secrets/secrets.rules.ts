// ADM-FR-50, ADM-BR-04 · luật thuần secrets (plan M2 §4). Không import I/O.
import type { ErrorCode } from "@ai/contracts";

export type RuleError = { code: ErrorCode; details?: unknown };

/** 4 code point cuối (không cắt cặp thay thế UTF-16), khớp CHECK `char_length = 4` của DB. */
export function secretLast4(value: string): string {
  return Array.from(value).slice(-4).join("");
}

/** Còn workflow tham chiếu → SECRET_IN_USE {used_by} (M2-R05). */
export function checkSecretDelete(usedBy: readonly string[]): RuleError | null {
  return usedBy.length > 0 ? { code: "SECRET_IN_USE", details: { used_by: [...usedBy] } } : null;
}
