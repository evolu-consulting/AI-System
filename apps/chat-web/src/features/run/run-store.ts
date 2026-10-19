// UC-02, UC-08 · store run ngoài React (plan-frontend §3): không gắn route → stream sống tiếp khi `/c/new` → `/c/:id`.
// Đọc bằng `useSyncExternalStore` + selector; mỗi thay đổi thay mảng `runs` (tham chiếu run không đổi thì giữ nguyên).
import { useSyncExternalStore } from "react";
import { isRunActive, isTerminal, type RunAction, type RunState, runReducer } from "./lib/reducer";

/**
 * Trần run đã kết thúc giữ trong store (review C1 #4). Bình thường view gọi `drop` khi query đã có `answerId`;
 * rời hội thoại trước lúc đó thì run nằm lại — chọn trần thay vì dọn theo route vì store cố ý không gắn route
 * (stream sống qua `/c/new` → `/c/:id`). Khi thêm run mới, bỏ run đã kết thúc cũ nhất vượt trần.
 */
export const MAX_SETTLED_RUNS = 20;

/** Giữ mọi run chưa kết thúc + `max` run đã kết thúc mới nhất (thứ tự giữ nguyên). */
export function pruneSettled(
  runs: readonly RunState[],
  max = MAX_SETTLED_RUNS,
): readonly RunState[] {
  let excess = runs.filter((r) => isTerminal(r.phase)).length - max;
  if (excess <= 0) return runs;
  return runs.filter((r) => !(isTerminal(r.phase) && excess-- > 0));
}

export type RunStore = ReturnType<typeof createRunStore>;

export function createRunStore() {
  let runs: readonly RunState[] = [];
  // UC-02 · quota là trạng thái của phiên (theo `run.started` mới nhất), KHÔNG của một bản ghi run: run bị `remove`
  // khi kết thúc/đã vào query và composer dựng lại khi `/c/new` → `/c/:id`, nên nhắc "quota over" phải sống ngoài run.
  let quotaOver = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const commit = (next: readonly RunState[]) => {
    runs = next;
    notify();
  };
  return {
    getRuns: (): readonly RunState[] => runs,
    /** `run.started.quota.state = over` của run gần nhất đã bắt đầu trong phiên này. */
    isQuotaOver: (): boolean => quotaOver,
    get: (key: string): RunState | undefined => runs.find((r) => r.key === key),
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    add(run: RunState): void {
      commit(pruneSettled([...runs.filter((r) => r.key !== run.key), run]));
    },
    dispatch(key: string, action: RunAction): void {
      const cur = runs.find((r) => r.key === key);
      if (!cur) return;
      const next = runReducer(cur, action);
      if (next === cur) return;
      if (next.quota && next.quota !== cur.quota) quotaOver = next.quota.state === "over";
      commit(runs.map((r) => (r === cur ? next : r)));
    },
    remove(key: string): void {
      if (runs.some((r) => r.key === key)) commit(runs.filter((r) => r.key !== key));
    },
    clear(): void {
      const changed = runs.length > 0 || quotaOver;
      quotaOver = false;
      if (changed) commit([]);
    },
  };
}

export const runStore = createRunStore();

/** Run mới nhất của một flow (theo `flowId`). */
export function selectFlowRun(runs: readonly RunState[], flowId: string): RunState | undefined {
  return runs.findLast((r) => r.flowId === flowId);
}

/** Run đang chạy của hội thoại — một hội thoại chỉ một run (UC-02). */
export function selectActiveRun(runs: readonly RunState[], convId: string): RunState | undefined {
  return runs.find((r) => r.convId === convId && isRunActive(r));
}

/** Nhắc quota (UC-02): bền qua `remove` run và qua việc composer dựng lại khi đổi route. */
export function useQuotaOver(): boolean {
  return useSyncExternalStore(runStore.subscribe, runStore.isQuotaOver, runStore.isQuotaOver);
}

/** `selector` phải trả giá trị ổn định (primitive hoặc tham chiếu có sẵn trong store). */
export function useRuns<T>(selector: (runs: readonly RunState[]) => T): T {
  const get = () => selector(runStore.getRuns());
  return useSyncExternalStore(runStore.subscribe, get, get);
}
