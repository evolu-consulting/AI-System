// ADM-FR-23 · X1 F4 · ≥ 1024px: panel "Chạy thử" là cột phải; hẹp hơn: tab "Chạy thử" (ui-admin §7.4 responsive).
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}
