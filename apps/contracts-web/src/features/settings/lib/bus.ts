// V2-L · mở/đóng hộp thoại Cài đặt từ menu avatar (kho nhỏ, không phụ thuộc cây React).
// contract-flow S4: `openSettings("flow")` mở thẳng một mục (vd "Quy trình duyệt" từ thẻ duyệt); hộp thoại đọc `takeSection()` khi mở.
import { useSyncExternalStore } from "react";
import type { SectionId } from "./types";

let open = false;
let wanted: SectionId | null = null;
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
  /** Mục được yêu cầu mở (đọc một lần). */
  takeSection(): SectionId | null {
    const s = wanted;
    wanted = null;
    return s;
  },
};
export const useSettingsOpen = (): boolean =>
  useSyncExternalStore(settingsBus.subscribe, settingsBus.isOpen);
export const openSettings = (section?: SectionId): void => {
  wanted = section ?? null;
  settingsBus.set(true);
};
