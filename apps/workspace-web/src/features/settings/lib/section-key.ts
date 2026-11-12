// CR-110 · COM-FR-41/42 · `/settings?sec=<key>`: khoá mục → mục của hộp thoại Cài đặt (hàm thuần). Khoá lạ ⇒ mục mặc định ("co").
import type { SectionId, SettingsNavId } from "./types";

export const SECTION_KEYS: readonly SectionId[] = ["co", "rep", "biz", "scout", "flow"];
export const DEFAULT_SECTION: SectionId = "co";

/** Có `sec` (chuỗi không rỗng) ⇒ mục tương ứng hoặc mặc định nếu lạ; không có `sec` ⇒ `null` (giữ hành vi cũ của `/settings`). */
export function sectionFromKey(raw: unknown): SectionId | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (raw === "apps") return "flow"; // CR-125 · S2: mục cũ "Ứng dụng & quy trình" đã gộp vào "Quy trình duyệt"
  return SECTION_KEYS.find((k) => k === raw) ?? DEFAULT_SECTION;
}

/** CR-130 · như `sectionFromKey` nhưng nhận thêm "feed" (ngăn Bảng tin ▸ Thông báo): `?sec=feed` mở thẳng ngăn đó. */
export function navFromKey(raw: unknown): SettingsNavId | null {
  return raw === "feed" ? "feed" : sectionFromKey(raw);
}

/** CR-130 · mục đang hiển thị: mục được chọn nếu nhóm của nó có mặt; không thì mục đầu của nhóm có mặt (người chỉ có Cộng đồng ⇒ "feed"). */
export function pickNav(want: SettingsNavId, contracts: boolean, feed: boolean): SettingsNavId {
  if (want === "feed" ? feed : contracts) return want;
  return contracts ? DEFAULT_SECTION : "feed";
}
