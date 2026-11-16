// CR-180 · điện thoại = ≤ 640px (cùng ngưỡng `max-sm` của Tailwind). Dùng khi CẦN đổi cấu trúc DOM (không chỉ ẩn/hiện bằng CSS).
import { useSyncExternalStore } from "react";

export const MOBILE_QUERY = "(max-width: 639.98px)";

const mq = (): MediaQueryList | null =>
  typeof matchMedia === "function" ? matchMedia(MOBILE_QUERY) : null;

const subscribe = (cb: () => void): (() => void) => {
  const m = mq();
  m?.addEventListener("change", cb);
  return () => m?.removeEventListener("change", cb);
};

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mq()?.matches ?? false,
    () => false,
  );
}
