// HUB-FR-60 · H4a-R08 · badge "Mô tả trùng ý": dùng `similarAgents` của contract (Jaccard ≥ 0,6), chỉ cảnh báo, không chặn.
import { type AgentListItem, type SimilarAgent, similarAgents } from "@ai/contracts/studio";

/** Chỉ agent đang bật mới có thể "trùng" (Orchestrator chỉ thấy agent bật); trả các agent có ít nhất một đối tượng trùng. */
export function overlapByAgent(items: readonly AgentListItem[]): Map<string, SimilarAgent[]> {
  const out = new Map<string, SimilarAgent[]>();
  for (const a of items) {
    if (!a.enabled) continue;
    const similar = similarAgents(a, items);
    if (similar.length > 0) out.set(a.id, similar);
  }
  return out;
}
