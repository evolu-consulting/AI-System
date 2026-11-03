// CR-112 · ADM-FR-81 · tab workspace công ty theo vai: platform_admin đủ tab; tenant_admin chỉ Thông tin (xem) / Agent / Users.
export type TenantTab =
  | "info"
  | "features"
  | "agents"
  | "workflow-tools"
  | "packs"
  | "quota"
  | "users";

const ALL: readonly TenantTab[] = [
  "info",
  "features",
  "agents",
  "workflow-tools",
  "packs",
  "quota",
  "users",
];
const TENANT_ADMIN: readonly TenantTab[] = ["info", "agents", "users"];

export const TAB_LABEL = {
  info: "tenants.tab.info",
  features: "tenants.tab.features",
  agents: "tenants.tab.agents",
  "workflow-tools": "tenants.tab.workflowTools",
  packs: "tenants.tab.packs",
  quota: "tenants.tab.quota",
  users: "tenants.tab.users",
} as const satisfies Record<TenantTab, string>;

export const visibleTabs = (isPlatform: boolean): readonly TenantTab[] =>
  isPlatform ? ALL : TENANT_ADMIN;

/** Tab trên URL không thuộc vai ⇒ về "info" (không render nội dung tab chỉ-platform). */
export function activeTab(tab: TenantTab | undefined, isPlatform: boolean): TenantTab {
  return tab && visibleTabs(isPlatform).includes(tab) ? tab : "info";
}
