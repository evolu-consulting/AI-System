// CR-178 · M3 · «yêu cầu nhảy tới tin»: danh sách (kết quả tìm) mở cuộc rồi khung chat nhận yêu cầu — hai bên không biết nhau, nối qua kho nhỏ này.
import { useSyncExternalStore } from "react";

export type JumpRequest = { id: string; seq: number; n: number } | null;
let cur: JumpRequest = null;
let counter = 0;
const subs = new Set<() => void>();

export function requestJump(id: string, seq: number): void {
  cur = { id, seq, n: ++counter };
  for (const f of subs) f();
}
export function useJumpRequest(): JumpRequest {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => cur,
    () => null,
  );
}
