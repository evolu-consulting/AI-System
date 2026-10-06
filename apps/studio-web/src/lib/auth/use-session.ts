// HUB-FR-72 · đọc phiên bằng useSyncExternalStore + selector (CONVENTIONS §6: tránh re-render thừa).
import { useSyncExternalStore } from "react";
import { type SessionState, session } from "./session";

/** `selector` phải trả giá trị ổn định (primitive hoặc tham chiếu trong state). */
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useSyncExternalStore(session.subscribe, () => selector(session.getState()));
}
