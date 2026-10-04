// HUB-FR-11 · H2a-R04, AC-H02 · gợi ý lệnh gần đúng (plan-rules). Thuần. B0: chỉ chữ ký (B3).

export type SuggestCandidate = { name: string; aliases: readonly string[] };

/** Khoảng cách Levenshtein trên `normalize("NFC")`, theo code point. */
export function levenshtein(a: string, b: string): number {
  throw new Error(`not implemented: levenshtein(${a.length}, ${b.length})`);
}

/** R04: tên chính của lệnh trong `usable` gần `typed` (≤ 3, sắp khoảng cách rồi tên). */
export function suggestCommands(typed: string, usable: readonly SuggestCandidate[]): string[] {
  throw new Error(`not implemented: suggestCommands(${typed.length}, ${usable.length})`);
}
