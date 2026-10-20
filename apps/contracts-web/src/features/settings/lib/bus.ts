// V2-L · mở/đóng hộp thoại Cài đặt từ menu avatar (kho nhỏ, không phụ thuộc cây React).
import { useSyncExternalStore } from "react";

let open = false;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};
export const settingsBus = {
  isOpen: () => open,
  set(v: boolean) {
    open = v;
    emit();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};
export const useSettingsOpen = (): boolean =>
  useSyncExternalStore(settingsBus.subscribe, settingsBus.isOpen);
export const openSettings = (): void => settingsBus.set(true);
