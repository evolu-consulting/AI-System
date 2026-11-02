// CR-110 · COM-FR-41/42 · `/settings?sec=<key>`: khoá mục → mục của hộp thoại Cài đặt (hàm thuần). Khoá lạ ⇒ mục mặc định ("co").
import type { SectionId } from "./types";

export const SECTION_KEYS: readonly SectionId[] = ["co", "rep", "biz", "scout", "flow"];
export const DEFAULT_SECTION: SectionId = "co";

/** Có `sec` (chuỗi không rỗng) ⇒ mục tương ứng hoặc mặc định nếu lạ; không có `sec` ⇒ `null` (giữ hành vi cũ của `/settings`). */
export function sectionFromKey(raw: unknown): SectionId | null {
  if (typeof raw !== "string" || raw === "") return null;
  return SECTION_KEYS.find((k) => k === raw) ?? DEFAULT_SECTION;
}
