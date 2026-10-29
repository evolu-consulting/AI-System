// CR-103 · fnr-unfreeze · chế độ route công khai của module quy trình (luật thuần, không đọc env):
// `off` = không mount (module đóng băng) · `admin` = chỉ editor/lượt chạy cho tenant_admin/platform_admin (admin-web) ·
// `all` = mọi route như trước (chat-web dùng hộp việc, asks…).

export const PROCESS_ROUTE_MODES = ["off", "admin", "all"] as const;
export type ProcessRoutesMode = (typeof PROCESS_ROUTE_MODES)[number];

/** fnr-fix-unfreeze · header trả kèm `GET /process-defs` ở chế độ `admin` (admin-web dò ⇒ cảnh báo người duyệt/trả lời). */
export const PROCESS_ROUTES_HEADER = "X-Process-Routes";

/** `processRoutes` đặt rõ (`HUB_PROCESS_ROUTES`) thắng; vắng ⇒ theo cờ đóng băng (`frozenModules` vắng/true ⇒ `all`, false ⇒ `off`). */
export function resolveProcessRoutes(o: {
  frozenModules?: boolean;
  processRoutes?: ProcessRoutesMode;
}): ProcessRoutesMode {
  return o.processRoutes ?? (o.frozenModules === false ? "off" : "all");
}
