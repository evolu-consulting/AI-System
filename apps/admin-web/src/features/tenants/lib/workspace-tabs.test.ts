// CR-121 c14 · ADM-FR-76/81 · trang công ty có đúng 5 tab cho cả hai vai; khóa cũ chuyển sang tab mới + mục con.
import { describe, expect, it } from "bun:test";
import { activeTab, legacyTab, TAB_LABEL, TENANT_TABS, visibleTabs } from "./workspace-tabs";

describe("CR-121 c14 · workspace-tabs", () => {
  it("platform_admin VÀ tenant_admin thấy đúng 5 tab theo thứ tự Hồ sơ · Ứng dụng · Quy trình · Thành viên · Cài đặt", () => {
    const want = ["profile", "apps", "processes", "members", "settings"];
    expect([...TENANT_TABS]).toEqual(want);
    expect([...visibleTabs(true)]).toEqual(want);
    expect([...visibleTabs(false)]).toEqual(want);
    expect(Object.keys(TAB_LABEL)).toEqual(want);
  });

  it("tab mặc định = Hồ sơ; khóa lạ/cũ chưa đổi (overview, workflow-tools) ⇒ Hồ sơ; tab hợp lệ giữ nguyên", () => {
    expect(activeTab(undefined, false)).toBe("profile");
    expect(activeTab("overview" as never, true)).toBe("profile");
    expect(activeTab("workflow-tools" as never, false)).toBe("profile");
    expect(activeTab("members", false)).toBe("members");
    expect(activeTab("processes", false)).toBe("processes");
  });

  it("khóa cũ ⇒ tab mới + mục con: info ⇒ settings, features/packs ⇒ apps, users/groups/partners/access/agents ⇒ members, quota ⇒ settings#quota", () => {
    expect(legacyTab("info")).toEqual({ tab: "settings" });
    expect(legacyTab("features")).toEqual({ tab: "apps" });
    expect(legacyTab("packs")).toEqual({ tab: "apps" });
    expect(legacyTab("users")).toEqual({ tab: "members", view: "users" });
    for (const v of ["groups", "partners", "access", "agents"] as const)
      expect(legacyTab(v)).toEqual({ tab: "members", view: v });
    expect(legacyTab("quota")).toEqual({ tab: "settings", at: "quota" });
    expect(legacyTab("workflow-tools")).toBeUndefined();
    expect(legacyTab(undefined)).toBeUndefined();
  });
});
