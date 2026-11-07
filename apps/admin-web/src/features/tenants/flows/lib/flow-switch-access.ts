// CR-123 · FLOW3-FR-09: công tắc "Dùng quy trình mới" chỉ cho quản trị nền tảng và quản trị công ty; người dùng khác không thấy
// (Hub cũng từ chối GET/PUT của họ). Thuần.
export const canSeeFlowSwitch = (role: string | undefined): boolean =>
  role === "platform_admin" || role === "tenant_admin";
