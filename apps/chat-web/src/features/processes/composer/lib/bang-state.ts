// CHAT-AC-51 · trạng thái menu `!` để nút "Quy trình" biết `aria-expanded` và bật/tắt cùng listbox (Composer chỉ cho nút `onInsert`).
// Một composer có menu `!` tại một thời điểm (phòng hoặc Hỏi AI) ⇒ store mức module là đủ.
import { useSyncExternalStore } from "react";

export type BangState = { open: boolean; toggle(insert: (text: string) => void): void };

const IDLE: BangState = { open: false, toggle: (insert) => insert("!") };
let state: BangState = IDLE;
const subs = new Set<() => void>();

export function publishBangState(next: BangState | null): void {
  state = next ?? IDLE;
  for (const fn of subs) fn();
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useBangState = (): BangState => useSyncExternalStore(subscribe, () => state);
