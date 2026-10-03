// CHAT-AC-01 · hook đọc phiên bằng useSyncExternalStore + selector (CONVENTIONS §6: tránh re-render thừa).
import { useSyncExternalStore } from "react";
import { type SessionState, session } from "./session";

/** `selector` phải trả giá trị ổn định (primitive hoặc tham chiếu trong state), ví dụ `(s) => s.me`. */
export function useSession<T>(selector: (s: SessionState) => T): T {
  const get = () => selector(session.getState());
  return useSyncExternalStore(session.subscribe, get, get);
}
