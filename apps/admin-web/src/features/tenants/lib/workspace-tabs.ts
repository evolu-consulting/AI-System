// CR-121 c14 (R2, Q6) · trang công ty có ĐÚNG 5 tab cho CẢ platform_admin VÀ tenant_admin (artboard Tpl-Settings):
// Hồ sơ `profile` · Ứng dụng `apps` · Quy trình `processes` · Thành viên `members` · Cài đặt `settings`. Quyền ghi theo vai như trước.
// Nhóm · Đối tác · Phân quyền · Agents là MỤC CON của Thành viên (`?tab=members&view=groups|partners|access|agents`), Quota là phần của Cài đặt (`at=quota`).
// URL cũ (`tab=info|features|packs|users|groups|partners|access|agents|quota`) vẫn mở được: `legacyTab` đổi sang tab mới + mục con.
export type TenantTab = "profile" | "apps" | "processes" | "members" | "settings";

/** Mục con của tab Thành viên (mặc định `users`). */
export type MemberView = "users" | "groups" | "partners" | "access" | "agents";
export const MEMBER_VIEWS: readonly MemberView[] = [
  "users",
  "groups",
  "partners",
  "access",
  "agents",
];

export const TENANT_TABS: readonly TenantTab[] = [
  "profile",
  "apps",
  "processes",
  "members",
  "settings",
];

export const TAB_LABEL = {
  profile: "tenants.tab.profile",
  apps: "tenants.tab.apps",
  processes: "tenants.tab.processes",
  members: "tenants.tab.members",
  settings: "tenants.tab.settings",
} as const satisfies Record<TenantTab, string>;

/** Cả hai vai thấy đủ 5 tab (Q6); tham số giữ để chỗ gọi cũ không đổi. */
export const visibleTabs = (_isPlatform: boolean): readonly TenantTab[] => TENANT_TABS;

export type LegacyTabTarget = { tab: TenantTab; view?: MemberView; at?: "quota" };

/** Khóa `?tab=` cũ ⇒ tab mới (+ mục con / vị trí). `info` (Cài đặt cũ) ⇒ `settings`; khóa lạ ⇒ undefined. */
export function legacyTab(old: unknown): LegacyTabTarget | undefined {
  switch (old) {
    case "profile":
    case "apps":
    case "processes":
    case "members":
    case "settings":
      return { tab: old };
    case "info":
      return { tab: "settings" };
    case "features":
    case "packs":
      return { tab: "apps" };
    case "users":
      return { tab: "members", view: "users" };
    case "groups":
    case "partners":
    case "access":
    case "agents":
      return { tab: "members", view: old };
    case "quota":
      return { tab: "settings", at: "quota" };
    default:
      return undefined;
  }
}

/** Tab trên URL không hợp lệ (vd `overview`) ⇒ "profile". */
export function activeTab(tab: TenantTab | undefined, _isPlatform: boolean): TenantTab {
  return tab && TENANT_TABS.includes(tab) ? tab : "profile";
}
