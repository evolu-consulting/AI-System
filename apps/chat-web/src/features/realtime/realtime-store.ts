// HUB-FR-100 · trạng thái kết nối `/me/stream` (store ngoài React như run-store): phase + id sự kiện cuối (chỉ bộ nhớ).
import { useSyncExternalStore } from "react";

export type RealtimePhase = "idle" | "connecting" | "open" | "reconnecting" | "down";
export type RealtimeState = { phase: RealtimePhase; lastEventId: string | null };

export type RealtimeStore = ReturnType<typeof createRealtimeStore>;

export function createRealtimeStore() {
  let state: RealtimeState = { phase: "idle", lastEventId: null };
  const listeners = new Set<() => void>();
  const commit = (next: RealtimeState) => {
    if (next.phase === state.phase && next.lastEventId === state.lastEventId) return;
    state = next;
    for (const l of listeners) l();
  };
  return {
    get: (): RealtimeState => state,
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setPhase: (phase: RealtimePhase) => commit({ ...state, phase }),
    setLastEventId: (lastEventId: string | null) => commit({ ...state, lastEventId }),
    reset: () => commit({ phase: "idle", lastEventId: null }),
  };
}

export const realtimeStore = createRealtimeStore();

export function useRealtimePhase(): RealtimePhase {
  return useSyncExternalStore(realtimeStore.subscribe, () => realtimeStore.get().phase);
}
