// CR-112 · CR-121 · ADM-FR-76/81 · tab workspace theo vai.
import { describe, expect, it } from "bun:test";
import { activeTab, TENANT_TABS, visibleTabs } from "./workspace-tabs";

describe("ADM-FR-81 · workspace-tabs", () => {
  it("tenant_admin thấy profile/features/processes/users/info/groups/partners/access/agents/quota, tab chỉ-platform trên URL ⇒ profile", () => {
    expect(visibleTabs(false)).toEqual([
      "profile",
      "features",
      "processes",
      "users",
      "info",
      "groups",
      "partners",
      "access",
      "agents",
      "quota",
    ]);
    // c16: tab `workflow-tools` đã gỡ (bật/tắt Dify theo công ty nằm ở Công cụ AI) — key lạ ⇒ Hồ sơ.
    expect(activeTab("workflow-tools" as never, false)).toBe("profile");
    expect(TENANT_TABS).not.toContain("workflow-tools" as never);
    expect(activeTab("processes", false)).toBe("processes"); // c11: tenant_admin cũng có tab Quy trình
    expect(activeTab("quota", false)).toBe("quota");
    expect(activeTab("users", false)).toBe("users");
    expect(activeTab("access", false)).toBe("access");
    expect(activeTab(undefined, false)).toBe("profile");
    // CR-112 S4 · ADM-FR-78: tab Gói gộp vào Ứng dụng — URL cũ ?tab=packs mở tab gộp, tab không còn trong danh sách.
    expect(activeTab("packs", true)).toBe("features");
    expect(visibleTabs(true)).not.toContain("packs");
    expect(activeTab("packs", false)).toBe("features"); // tenant_admin cũng thấy tab gộp (chỉ xem)
  });

  it("CR-121 · platform_admin: Hồ sơ · Ứng dụng · Quy trình (c11) · Thành viên · Cài đặt đứng đầu, không còn tab Tổng quan", () => {
    expect(visibleTabs(true)).toEqual([...TENANT_TABS]);
    expect(TENANT_TABS.slice(0, 5)).toEqual(["profile", "features", "processes", "users", "info"]);
    expect(TENANT_TABS).not.toContain("overview" as never);
    // URL cũ ?tab=overview (không còn là tab hợp lệ) ⇒ về Hồ sơ.
    expect(activeTab("overview" as never, true)).toBe("profile");
  });
});
