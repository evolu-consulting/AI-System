// CR-121 · tab workspace công ty theo vai. Thứ tự: Hồ sơ · Ứng dụng (key `features`) · [Quy trình: c11 thêm key `processes`; tab `workflow-tools` đã gỡ ở c16, URL cũ → /ai-tools] ·
// Thành viên (key `users`) · Cài đặt (key `info`) · rồi các mục quản trị còn lại (Nhóm · Đối tác · Phân quyền · Agents · Quota).
// Bỏ tab "Tổng quan" (đã có "Tổng quan" ở thanh bên); số tóm tắt nằm một dòng ở đầu trang. Tab mặc định (không `?tab=`) = Hồ sơ.
// platform_admin đủ tab; tenant_admin: Hồ sơ (chỉ xem), Ứng dụng (chỉ xem), Thành viên, Cài đặt (chỉ xem), Nhóm, Đối tác, Phân quyền,
// Agents, Quota rút gọn (chỉ đọc, không tiền). "packs"/"overview" chỉ còn là key URL cũ (activeTab chuyển đi), không nằm trong danh sách.
export type TenantTab =
  | "profile"
  | "info"
  | "features"
  | "packs"
  | "users"
  | "groups"
  | "partners"
  | "access"
  | "agents"
  | "quota";

export const TENANT_TABS: readonly TenantTab[] = [
  "profile",
  "features",
  "users",
  "info",
  "groups",
  "partners",
  "access",
  "agents",
  "quota",
];
const TENANT_ADMIN: readonly TenantTab[] = [
  "profile",
  "features",
  "users",
  "info",
  "groups",
  "partners",
  "access",
  "agents",
  "quota",
];

export const TAB_LABEL = {
  profile: "tenants.tab.profile",
  info: "tenants.tab.info",
  features: "tenants.tab.features",
  packs: "tenants.tab.packs",
  users: "tenants.tab.users",
  groups: "tenants.tab.groups",
  partners: "tenants.tab.partners",
  access: "tenants.tab.access",
  agents: "tenants.tab.agents",
  quota: "tenants.tab.quota",
} as const satisfies Record<TenantTab, string>;

export const visibleTabs = (isPlatform: boolean): readonly TenantTab[] =>
  isPlatform ? TENANT_TABS : TENANT_ADMIN;

/** Tab trên URL không thuộc vai (hoặc không còn, vd `overview`) ⇒ "profile" (không render nội dung tab chỉ-platform). */
export function activeTab(tab: TenantTab | undefined, isPlatform: boolean): TenantTab {
  const t = tab === "packs" ? "features" : tab; // CR-112 S4: tab Gói đã gộp vào "Ứng dụng" (URL cũ vẫn mở được)
  return t && visibleTabs(isPlatform).includes(t) ? t : "profile";
}
