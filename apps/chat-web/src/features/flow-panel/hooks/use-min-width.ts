// CHAT-AC-17 · ≥ 640px: khung flow là `aside` phải; dưới đó: Sheet đáy (plan-frontend §8).
import { useCallback, useSyncExternalStore } from "react";

export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof matchMedia !== "function") return () => {};
      const mq = matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    [query],
  );
  const snapshot = () => typeof matchMedia !== "function" || matchMedia(query).matches;
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
