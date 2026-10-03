// UC-02, UC-08 · store run ngoài React (plan-frontend §3): không gắn route → stream sống tiếp khi `/c/new` → `/c/:id`.
// Đọc bằng `useSyncExternalStore` + selector; mỗi thay đổi thay mảng `runs` (tham chiếu run không đổi thì giữ nguyên).
import { useSyncExternalStore } from "react";
import { isRunActive, type RunAction, type RunState, runReducer } from "./lib/reducer";

export type RunStore = ReturnType<typeof createRunStore>;

export function createRunStore() {
  let runs: readonly RunState[] = [];
  const listeners = new Set<() => void>();
  const commit = (next: readonly RunState[]) => {
    runs = next;
    for (const l of listeners) l();
  };
  return {
    getRuns: (): readonly RunState[] => runs,
    get: (key: string): RunState | undefined => runs.find((r) => r.key === key),
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    add(run: RunState): void {
      commit([...runs.filter((r) => r.key !== run.key), run]);
    },
    dispatch(key: string, action: RunAction): void {
      const cur = runs.find((r) => r.key === key);
      if (!cur) return;
      const next = runReducer(cur, action);
      if (next !== cur) commit(runs.map((r) => (r === cur ? next : r)));
    },
    remove(key: string): void {
      if (runs.some((r) => r.key === key)) commit(runs.filter((r) => r.key !== key));
    },
    clear(): void {
      if (runs.length > 0) commit([]);
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

/** `selector` phải trả giá trị ổn định (primitive hoặc tham chiếu có sẵn trong store). */
export function useRuns<T>(selector: (runs: readonly RunState[]) => T): T {
  const get = () => selector(runStore.getRuns());
  return useSyncExternalStore(runStore.subscribe, get, get);
}
