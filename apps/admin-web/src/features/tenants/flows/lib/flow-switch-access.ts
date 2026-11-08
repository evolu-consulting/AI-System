// CR-123 · FLOW3-FR-09: công tắc "Dùng quy trình mới" chỉ cho quản trị nền tảng và quản trị công ty; người dùng khác không thấy
// (Hub cũng từ chối GET/PUT của họ). Thuần.
export const canSeeFlowSwitch = (role: string | undefined): boolean =>
  role === "platform_admin" || role === "tenant_admin";

/**
 * CR-125 · c2 · trạng thái hiển thị của khối "quy trình mới": KHÔNG còn công tắc bật bắt buộc — "Lưu và áp dụng" (hoặc gán quy trình) là đủ.
 *  - `on`   : đang dùng ⇒ chỉ có nút "Tạm dừng quy trình mới" (cứu hộ, quản trị công ty);
 *  - `idle` : có quy trình nhưng chưa dùng (chưa áp dụng / đã tạm dừng) ⇒ chỉ lời chỉ dẫn "Lưu và áp dụng ở một quy trình";
 *  - `none` : chưa có quy trình nào ⇒ lời chỉ dẫn gán.
 */
export type SwitchState = "on" | "idle" | "none";
export const switchStateOf = (s: {
  flow_triggers: boolean;
  has_active_flow: boolean;
}): SwitchState => (s.flow_triggers ? "on" : s.has_active_flow ? "idle" : "none");
