// CHAT-AC-23 · ≥ 1024px: sidebar cố định; dưới đó: Sheet (640–1023 và < 640 cùng cơ chế, header ☰).
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const snapshot = (): boolean => typeof matchMedia !== "function" || matchMedia(QUERY).matches;

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
