// CR-112 · ADM-FR-81 · tab workspace theo vai.
import { describe, expect, it } from "bun:test";
import { activeTab, visibleTabs } from "./workspace-tabs";

describe("ADM-FR-81 · workspace-tabs", () => {
  it("tenant_admin chỉ info/agents/users, tab chỉ-platform trên URL ⇒ info", () => {
    expect(visibleTabs(false)).toEqual(["info", "agents", "users"]);
    expect(activeTab("quota", false)).toBe("info");
    expect(activeTab("users", false)).toBe("users");
    expect(activeTab(undefined, false)).toBe("info");
    // CR-112 S4 · ADM-FR-78: tab Gói gộp vào Ứng dụng & Gói — URL cũ ?tab=packs mở tab gộp, tab không còn trong danh sách.
    expect(activeTab("packs", true)).toBe("features");
    expect(visibleTabs(true)).not.toContain("packs");
    expect(activeTab("packs", false)).toBe("info");
  });
});
