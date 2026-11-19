// CR-187 · mở/đóng hộp «Đổi mật khẩu» từ menu tài khoản (menu đóng ngay khi bấm nên trạng thái nằm ngoài menu; kho nhỏ như settings/bus).
import { useSyncExternalStore } from "react";

let open = false;
const subs = new Set<() => void>();
const set = (v: boolean) => {
  open = v;
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
export const openChangePassword = (): void => set(true);
export const closeChangePassword = (): void => set(false);
export const useChangePasswordOpen = (): boolean => useSyncExternalStore(subscribe, () => open);
