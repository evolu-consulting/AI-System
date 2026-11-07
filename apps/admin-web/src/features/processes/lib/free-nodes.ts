// CR-123 · u5 · FLOW3-FR-04: node thả từ menu / bảng mẫu đứng RIÊNG (`StageDraft.free`) — MỘT nguồn cho canvas (không vẽ cạnh tự động),
// luật lưu (chặn kèm lý do), gợi ý trên node và nối mũi tên (gỡ cờ khi có mũi tên tới). Thuần.
import type { DraftErrors, StageDraft } from "./draft-types";
import { clusterIndexes, moduleClusters } from "./module-cluster";
import { normalizeSteps } from "./step-ops";
import { remapStepRefs } from "./step-refs";

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

/** Đặt node (cả cụm) `uid` thành bước MỚI ngay sau bước `afterStep` (-1 ⇒ đầu tiên); đích trỏ tới các bước sau được đánh lại. */
export function placeAfter(
  stages: readonly StageDraft[],
  uid: string,
  afterStep: number,
): StageDraft[] {
  const at = stages.findIndex((s) => s.uid === uid);
  const idx = new Set(clusterIndexes(stages, at));
  const moving = stages
    .filter((_, i) => idx.has(i))
    .map((s, k) => ({ ...s, step: afterStep + 0.5 + k * 0.01 }));
  const rest = stages.filter((_, i) => !idx.has(i));
  const pos = rest.reduce((m, o, j) => (o.step <= afterStep ? j + 1 : m), 0);
  const merged = [...rest];
  merged.splice(pos, 0, ...moving);
  return remapStepRefs(stages, normalizeSteps(merged));
}

/**
 * Mũi tên từ `source` tới node ĐỨNG RIÊNG `target` nằm chưa sau nguồn ⇒ node được đặt thành bước mới ngay sau nguồn
 * (người dùng chỉ kéo mũi tên, không phải nghĩ tới "bước"); không phải node đứng riêng ⇒ null (giữ luật "chỉ nối tới bước sau").
 */
export function placeAfterSource(
  stages: readonly StageDraft[],
  source: string,
  target: string,
): StageDraft[] | null {
  const dst = stages.find((s) => s.uid === target);
  const si = stages.findIndex((s) => s.uid === source);
  if (!dst || !isFree(dst) || si < 0) return null;
  const after = Math.max(...clusterIndexes(stages, si).map((i) => (stages[i] as StageDraft).step));
  return placeAfter(stages, target, after);
}

/** Mũi tên từ "Bắt đầu khi": tới node đứng riêng ⇒ thành bước ĐẦU TIÊN; tới bước đầu sẵn có ⇒ không đổi; tới bước khác ⇒ lỗi. */
export function connectToTrigger(
  stages: readonly StageDraft[],
  target: string,
): { stages: StageDraft[] } | { error: "notFirst" } {
  const dst = stages.find((s) => s.uid === target);
  if (!dst) return { error: "notFirst" };
  if (isFree(dst)) return { stages: clearFree(placeAfter(stages, target, -1), target) };
  return dst.step === 0 ? { stages: [...stages] } : { error: "notFirst" };
}

/**
 * Thả node vào cột `step`: cột đang chứa stage của một node module nhiều stage (Ký số = gửi + chờ) mà thả vào đó sẽ XEN node mới vào giữa cụm
 * (cụm bị tách ⇒ hết là một ô, Lưu bị chặn) ⇒ dời sang bước ngay SAU cụm.
 */
export function safeDropStep(stages: readonly StageDraft[], step: number): number {
  let out = step;
  for (const c of moduleClusters(stages.map((s) => ({ node: s.node, executor: s.executor })))) {
    const steps = stages.slice(c.start, c.end).map((s) => s.step);
    const [lo, hi] = [Math.min(...steps), Math.max(...steps)];
    if (out >= lo && out <= hi) out = hi + 1;
  }
  return out;
}
