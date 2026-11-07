// CR-123 · u3a · FLOW3-FR-14: node module nhiều stage (Ký số = gửi + chờ) là MỘT ô — xoá / sao chép / mặc định đi cả cụm. Thuần.
// Luật cụm (liên tiếp, đủ, đúng thứ tự) ở `@ai/contracts/hub-admin` (`process-module-nodes`); canvas / panel nhập từ đây hoặc từ contracts.
import { type ClusterStage, clusterOf, type ModuleCluster } from "@ai/contracts/hub-admin";
import type { StageDraft } from "./draft-types";
import { nextUid } from "./stage-convert";
import { insertStepAfter, normalizeSteps, type StepOpResult } from "./step-ops";

export { clusterOf, type ModuleCluster, moduleClusters } from "@ai/contracts/hub-admin";

const asCluster = (s: StageDraft): ClusterStage => ({ node: s.node, executor: s.executor });

/** Cụm chứa stage `i` của bản nháp (null ⇒ stage đứng riêng). */
export const draftClusterOf = (stages: readonly StageDraft[], i: number): ModuleCluster | null =>
  clusterOf(stages.map(asCluster), i);

/** Chỉ số mọi stage cùng ô với stage `i` (stage đứng riêng ⇒ chỉ `[i]`; `i` không có ⇒ rỗng). */
export function clusterIndexes(stages: readonly StageDraft[], i: number): number[] {
  if (!stages[i]) return [];
  const c = draftClusterOf(stages, i);
  return c ? Array.from({ length: c.end - c.start }, (_, k) => c.start + k) : [i];
}

/** `uids` + mọi stage cùng cụm với từng uid (p25: Delete / Ctrl+C trên nhiều node đi qua đây). */
export function expandToClusters(stages: readonly StageDraft[], uids: readonly string[]): string[] {
  const out = new Set<string>();
  stages.forEach((s, i) => {
    if (!uids.includes(s.uid)) return;
    for (const j of clusterIndexes(stages, i)) out.add((stages[j] as StageDraft).uid);
  });
  return [...out];
}

/** Xoá stage `i` KÈM cả cụm của nó; cụm là toàn bộ flow ⇒ không đổi (luôn còn ≥ 1 stage). */
export function removeCluster(stages: readonly StageDraft[], i: number): StageDraft[] {
  const gone = new Set(clusterIndexes(stages, i));
  if (gone.size === 0 || gone.size >= stages.length) return [...stages];
  return normalizeSteps(stages.filter((_, j) => !gone.has(j)));
}

/** Mã stage chưa trùng: `<key>_copy`, `_copy2`… */
function freeKey(key: string, taken: ReadonlySet<string>): string {
  let k = `${key}_copy`;
  for (let n = 2; taken.has(k); n++) k = `${key}_copy${n}`;
  return k;
}

/**
 * Sao chép stage `i` KÈM cả cụm: các bản sao nối tiếp nhau, thành các bước mới ngay SAU cụm gốc (đích bước trỏ ra ngoài cụm giữ nguyên).
 * Đầy số stage ⇒ `error` (không sao chép nửa cụm). `uids` = uid các bản sao theo thứ tự cụm.
 */
export function duplicateCluster(
  stages: readonly StageDraft[],
  i: number,
): StepOpResult<StageDraft> & { uids?: string[] } {
  const idx = clusterIndexes(stages, i);
  let out: StageDraft[] = [...stages];
  const taken = new Set(stages.map((s) => s.key));
  const uids: string[] = [];
  let after = Math.max(...idx.map((j) => (stages[j] as StageDraft).step));
  for (const j of idx) {
    const src = stages[j] as StageDraft;
    const key = freeKey(src.key, taken);
    taken.add(key);
    const copy: StageDraft = { ...src, uid: nextUid(), key, keyAuto: false, backTo: [] };
    const r = insertStepAfter(out, after, copy);
    if ("error" in r) return r;
    out = r.stages;
    uids.push(copy.uid);
    after = out.find((s) => s.uid === copy.uid)?.step ?? after + 1;
  }
  return { stages: out, uids };
}

/**
 * Mặc định của cụm có stage chờ sự kiện (Ký số): nhánh "bị từ chối / bị huỷ / hết hạn" đều đi tới node Kết thúc · Từ chối nếu flow
 * đã có (kết quả `rejected`). Chỉ đặt khi stage chờ chưa có nhánh nào và thuộc một cụm hợp lệ; ngược lại ⇒ null (không đổi).
 */
export function waitBranchDefaults(
  stages: readonly StageDraft[],
  waitUid: string,
): Partial<StageDraft> | null {
  const i = stages.findIndex((s) => s.uid === waitUid);
  const s = stages[i];
  if (s?.executor !== "wait_event" || !s.node || !draftClusterOf(stages, i)) return null;
  if ((s.wait.branches ?? []).length > 0) return null;
  const reject = stages.find((x) => x.outcome === "rejected");
  if (!reject) return null;
  const on = [...(s.wait.also ?? []), "timeout"];
  return { wait: { ...s.wait, branches: on.map((o) => ({ on: o, step: reject.step })) } };
}
