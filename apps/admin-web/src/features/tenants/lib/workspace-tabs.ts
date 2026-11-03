// CR-112 · ADM-FR-76/77 · tab workspace công ty theo vai. Thứ tự (Q9/Q10): Thông tin · Ứng dụng & Gói (key `features`, S4 đã gộp Feature + Gói) ·
// Người dùng · Nhóm · Đối tác · Phân quyền · Agents · Công cụ quy trình · Quota. Tổng quan (COULD) chưa làm.
// platform_admin đủ tab; tenant_admin: Thông tin (chỉ xem), Ứng dụng & Gói (chỉ xem), nhóm quyền người dùng, Agents (Quota rút gọn: việc còn lại).
// "packs" chỉ còn là key URL cũ (activeTab chuyển sang `features`), không nằm trong danh sách tab.
export type TenantTab =
  | "info"
  | "features"
  | "packs"
  | "users"
  | "groups"
  | "partners"
  | "access"
  | "agents"
  | "workflow-tools"
  | "quota";

export const TENANT_TABS: readonly TenantTab[] = [
  "info",
  "features",
  "users",
  "groups",
  "partners",
  "access",
  "agents",
  "workflow-tools",
  "quota",
];
const TENANT_ADMIN: readonly TenantTab[] = [
  "info",
  "features",
  "users",
  "groups",
  "partners",
  "access",
  "agents",
];

export const TAB_LABEL = {
  info: "tenants.tab.info",
  features: "tenants.tab.features",
  packs: "tenants.tab.packs",
  users: "tenants.tab.users",
  groups: "tenants.tab.groups",
  partners: "tenants.tab.partners",
  access: "tenants.tab.access",
  agents: "tenants.tab.agents",
  "workflow-tools": "tenants.tab.workflowTools",
  quota: "tenants.tab.quota",
} as const satisfies Record<TenantTab, string>;

export const visibleTabs = (isPlatform: boolean): readonly TenantTab[] =>
  isPlatform ? TENANT_TABS : TENANT_ADMIN;

/** Tab trên URL không thuộc vai ⇒ về "info" (không render nội dung tab chỉ-platform). */
export function activeTab(tab: TenantTab | undefined, isPlatform: boolean): TenantTab {
  const t = tab === "packs" ? "features" : tab; // CR-112 S4: tab Gói đã gộp vào "Ứng dụng & Gói" (URL cũ vẫn mở được)
  return t && visibleTabs(isPlatform).includes(t) ? t : "info";
}
