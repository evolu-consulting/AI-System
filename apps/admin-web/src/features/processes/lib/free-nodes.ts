// CR-123 · u5 · FLOW3-FR-04: node thả từ menu / bảng mẫu đứng RIÊNG (`StageDraft.free`) — MỘT nguồn cho canvas (không vẽ cạnh tự động),
// luật lưu (chặn kèm lý do), gợi ý trên node và nối mũi tên (gỡ cờ khi có mũi tên tới). Thuần.
import type { DraftErrors, StageDraft } from "./draft-types";
import { clusterIndexes } from "./module-cluster";

/** Khoá câu lỗi: "chưa được nối — kéo mũi tên từ bước trước tới bước này". */
export const FREE_ERR = "process.admin.canvas.err.unlinked";

export const isFree = (s: { free?: boolean | undefined }): boolean => s.free === true;

/** Đánh dấu các stage vừa thả là node đứng riêng. */
export const markFree = (stages: readonly StageDraft[], uids: readonly string[]): StageDraft[] =>
  stages.map((s) => (uids.includes(s.uid) ? { ...s, free: true } : s));

/** Có mũi tên tới node `uid` ⇒ bỏ cờ đứng riêng cho cả cụm của nó (Ký số = gửi + chờ). */
export function clearFree(stages: readonly StageDraft[], uid: string): StageDraft[] {
  const at = stages.findIndex((s) => s.uid === uid);
  const cluster = new Set(clusterIndexes(stages, at));
  return stages.map((s, i) => {
    if (!cluster.has(i) || s.free !== true) return s;
    const { free: _free, ...rest } = s;
    return rest;
  });
}

/** Lỗi theo ô `stages.i.free` cho mỗi stage còn đứng riêng (hiện ngay trên node + chặn Lưu). */
export function freeErrors(stages: readonly StageDraft[]): DraftErrors {
  return Object.fromEntries(
    stages.flatMap((s, i) => (isFree(s) ? [[`stages.${i}.free`, FREE_ERR] as const] : [])),
  );
}

/** Bỏ mọi cạnh có đầu nối vào/ra node đứng riêng (không tự nối). */
export function dropFreeEdges<E extends { source: string; target: string }>(
  edges: readonly E[],
  free: ReadonlySet<string>,
): E[] {
  return free.size === 0
    ? [...edges]
    : edges.filter((e) => !free.has(e.source) && !free.has(e.target));
}

/**
 * Cột có node đứng riêng vẫn có nút gộp `jN` (vì đếm > 1 stage): sau khi bỏ cạnh của node đứng riêng, nút gộp chỉ còn ≤ 1 cạnh vào ⇒ bỏ nút
 * và nối thẳng nguồn → đích (không vẽ nút gộp thừa, không đổi số cạnh của phần còn lại).
 */
export function collapseLoneJoins<
  N extends { id: string },
  E extends { id: string; source: string; target: string },
>(nodes: readonly N[], edges: readonly E[]): { nodes: N[]; edges: E[] } {
  let es = [...edges];
  const gone = new Set<string>();
  for (const id of nodes.map((n) => n.id).filter((i) => /^j\d+$/.test(i))) {
    const ins = es.filter((e) => e.target === id);
    if (ins.length > 1) continue;
    const outs = es.filter((e) => e.source === id);
    gone.add(id);
    es = es.filter((e) => e.source !== id && e.target !== id);
    const from = ins[0];
    if (from)
      for (const o of outs)
        es.push({ ...o, id: `${from.source}>${o.target}`, source: from.source });
  }
  return { nodes: nodes.filter((n) => !gone.has(n.id)), edges: es };
}
