// ADM-FR-01 · hook đọc phiên bằng useSyncExternalStore + selector (CONVENTIONS §6: tránh re-render thừa).
import { useSyncExternalStore } from "react";
import { type SessionState, session } from "./session";

/** `selector` phải trả giá trị ổn định (primitive hoặc tham chiếu trong state), ví dụ `(s) => s.me?.role`. */
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useSyncExternalStore(session.subscribe, () => selector(session.getState()));
}
