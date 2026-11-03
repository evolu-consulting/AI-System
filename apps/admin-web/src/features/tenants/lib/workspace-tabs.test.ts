// CR-112 · ADM-FR-76/81 · tab workspace theo vai.
import { describe, expect, it } from "bun:test";
import { activeTab, TENANT_TABS, visibleTabs } from "./workspace-tabs";

describe("ADM-FR-81 · workspace-tabs", () => {
  it("tenant_admin chỉ thấy info/features/users/groups/partners/access/agents, tab chỉ-platform trên URL ⇒ info", () => {
    expect(visibleTabs(false)).toEqual([
      "info",
      "features",
      "users",
      "groups",
      "partners",
      "access",
      "agents",
    ]);
    expect(activeTab("quota", false)).toBe("info");
    expect(activeTab("users", false)).toBe("users");
    expect(activeTab("access", false)).toBe("access");
    expect(activeTab(undefined, false)).toBe("info");
    // CR-112 S4 · ADM-FR-78: tab Gói gộp vào Ứng dụng & Gói — URL cũ ?tab=packs mở tab gộp, tab không còn trong danh sách.
    expect(activeTab("packs", true)).toBe("features");
    expect(visibleTabs(true)).not.toContain("packs");
    expect(activeTab("packs", false)).toBe("features"); // tenant_admin cũng thấy tab gộp (chỉ xem)
  });

  it("platform_admin đủ tab theo thứ tự spec: Thông tin, Ứng dụng & Gói, Người dùng…, Agents, Công cụ quy trình, Quota", () => {
    expect(visibleTabs(true)).toEqual([...TENANT_TABS]);
    expect(TENANT_TABS[0]).toBe("info");
    expect(TENANT_TABS[1]).toBe("features");
    expect(TENANT_TABS.slice(2)).toEqual([
      "users",
      "groups",
      "partners",
      "access",
      "agents",
      "workflow-tools",
      "quota",
    ]);
  });
});
