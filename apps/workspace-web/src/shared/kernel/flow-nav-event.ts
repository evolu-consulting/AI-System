// CR-121 C-7 · số đếm menu "hàng việc" (Community + Sổ Hợp Tác) tải lại sau MỘT thao tác duyệt — không poll.
// Module nào vừa quyết (duyệt/từ chối/xử lý) gọi `notifyFlowNavChanged()`; shell (use-flow-caps) lắng nghe và tải lại.
// Dùng sự kiện cửa sổ để module không phải import shell (luật web-shell-manifest-only).
export const FLOW_NAV_CHANGED = "flow-nav:changed";

export function notifyFlowNavChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FLOW_NAV_CHANGED));
}
