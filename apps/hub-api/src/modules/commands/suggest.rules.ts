// HUB-FR-11 · H2a-R04, AC-H02 · gợi ý lệnh gần đúng (plan-rules). Thuần.

export type SuggestCandidate = { name: string; aliases: readonly string[] };

const SUGGEST_MAX = 3;

/** Khoảng cách Levenshtein trên `normalize("NFC")`, theo code point. */
export function levenshtein(a: string, b: string): number {
  const x = [...a.normalize("NFC")];
  const y = [...b.normalize("NFC")];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[y.length] ?? 0;
}

/** R04: tên chính của lệnh trong `usable` gần `typed` (≤ 3, sắp khoảng cách rồi tên). */
export function suggestCommands(typed: string, usable: readonly SuggestCandidate[]): string[] {
  if (typed === "") return [];
  const limit = Math.max(2, Math.floor([...typed.normalize("NFC")].length / 3));
  const best = new Map<string, number>();
  for (const c of usable) {
    const d = Math.min(...[c.name, ...c.aliases].map((n) => levenshtein(typed, n)));
    if (d <= limit && d < (best.get(c.name) ?? Number.POSITIVE_INFINITY)) best.set(c.name, d);
  }
  return [...best.entries()]
    .sort(([na, da], [nb, db]) => da - db || (na < nb ? -1 : na > nb ? 1 : 0))
    .slice(0, SUGGEST_MAX)
    .map(([n]) => n);
}
