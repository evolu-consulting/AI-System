// CR-178 · luật thuần thanh lọc danh sách «Tất cả · Chưa đọc · Đối tác ▾»: MỘT danh sách gần đây, lọc bằng tab (không còn danh bạ theo phòng ban trong danh sách).
import { type CompanyFilter, parseFilter } from "./company-filter";

export type ListTab = "all" | "unread" | "partner";
/** `company` chỉ có nghĩa ở tab `partner` (id công ty đối tác đã chọn). */
export type ListView = { tab: ListTab; company: string | null };

export const ALL_VIEW: ListView = { tab: "all", company: null };

/** Bộ lọc công ty gửi lên API: chỉ tab Đối tác đã chọn công ty mới lọc; còn lại «all». */
export const viewFilter = (v: ListView): CompanyFilter =>
  v.tab === "partner" && v.company ? v.company : "all";

/** Chỉ tab «Chưa đọc» gọi `unread=true`. */
export const viewUnread = (v: ListView): boolean => v.tab === "unread";

/** `?company=` (nút «Nhắn tin» ở trang đối tác) ⇒ view: id công ty khác ⇒ tab Đối tác; còn lại (rỗng/own/all) ⇒ Tất cả. */
export function viewFromParam(raw: string | null | undefined, ownId: string): ListView {
  const f = parseFilter(raw, ownId);
  return f === "all" || f === "own" ? ALL_VIEW : { tab: "partner", company: f };
}

/** Chọn tab: Đối tác chưa có công ty thì giữ nguyên view cũ (menu chọn công ty mở ra, chưa đổi danh sách). */
export const pickTab = (v: ListView, tab: ListTab): ListView =>
  tab === "partner" ? (v.company ? { tab, company: v.company } : v) : { tab, company: v.company };
