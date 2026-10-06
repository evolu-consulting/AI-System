// HUB-FR-60 · H4a-R08 · plan §2.2/§4.1 — mô tả trùng ý (Jaccard) + dòng agent trong prompt Orchestrator. Một cài đặt cho FE + Hub.

export function descriptionTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of s
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u))
    if ([...t].length >= 3) out.add(t);
  return out;
}

/** Jaccard |A∩B|/|A∪B|; hai tập rỗng ⇒ 0. */
export function descriptionOverlap(a: string, b: string): number {
  const x = descriptionTokens(a);
  const y = descriptionTokens(b);
  const union = new Set([...x, ...y]).size;
  if (union === 0) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / union;
}

export type SimilarAgent = { agent_id: string; agent_key: string; score: number };

/** Bỏ chính nó + agent tắt; score ≥ threshold; giảm dần; tối đa 5. */
export function similarAgents(
  target: { id: string; description: string },
  others: readonly { id: string; key: string; description: string; enabled: boolean }[],
  threshold = 0.6,
): SimilarAgent[] {
  return others
    .filter((o) => o.id !== target.id && o.enabled)
    .map((o) => ({
      agent_id: o.id,
      agent_key: o.key,
      score: descriptionOverlap(target.description, o.description),
    }))
    .filter((r) => r.score >= threshold)
    .sort((p, q) => q.score - p.score)
    .slice(0, 5);
}

/** Phần tử `<agents>` trong prompt Orchestrator (E7). */
export function formatAgentForOrchestrator(a: { key: string; description: string }): string {
  return JSON.stringify({ key: a.key, description: a.description });
}
