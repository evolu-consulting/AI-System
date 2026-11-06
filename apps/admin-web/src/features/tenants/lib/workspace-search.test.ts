import { describe, expect, it } from "bun:test";
import { legacyTabRedirect, validateWorkspaceSearch } from "./workspace-search";

describe("validateWorkspaceSearch", () => {
  it("?tab=packs / features cũ chuyển sang tab Ứng dụng", () => {
    expect(validateWorkspaceSearch({ tab: "packs" }).tab).toBe("apps");
    expect(validateWorkspaceSearch({ tab: "features" }).tab).toBe("apps");
  });
  it("CR-121 c14 · tab cũ ⇒ tab mới + mục con: info ⇒ settings; groups|partners|access|agents|users ⇒ members + view; quota ⇒ settings + at", () => {
    expect(validateWorkspaceSearch({ tab: "info" })).toMatchObject({ tab: "settings" });
    for (const v of ["users", "groups", "partners", "access", "agents"])
      expect(validateWorkspaceSearch({ tab: v })).toMatchObject({ tab: "members", view: v });
    expect(validateWorkspaceSearch({ tab: "quota" })).toMatchObject({
      tab: "settings",
      at: "quota",
    });
  });
  it("Phân quyền cũ ?tab=access&view=check ⇒ members/access, mode=check, dạng mới view=access&mode=matrix giữ nguyên", () => {
    expect(validateWorkspaceSearch({ tab: "access", view: "check" })).toMatchObject({
      tab: "members",
      view: "access",
      mode: "check",
    });
    expect(
      validateWorkspaceSearch({ tab: "members", view: "access", mode: "matrix" }),
    ).toMatchObject({
      tab: "members",
      view: "access",
      mode: "matrix",
    });
  });
  it("tab lạ bị bỏ", () => {
    expect(validateWorkspaceSearch({ tab: "nope" }).tab).toBeUndefined();
  });
});

describe("CR-121 c16 · ?tab=workflow-tools cũ", () => {
  it("chuyển tới /ai-tools kèm thông báo; tab khác không chuyển", () => {
    const s = validateWorkspaceSearch({ tab: "workflow-tools" });
    expect(s.tab).toBeUndefined();
    expect(legacyTabRedirect(s)).toEqual({ to: "/ai-tools", notice: "company-tools" });
    // tenant_admin không có quyền Công cụ AI ⇒ về tab Quy trình
    expect(legacyTabRedirect(s, "tenant_admin")).toEqual({ to: "processes" });
    expect(legacyTabRedirect(s, "platform_admin")).toEqual({
      to: "/ai-tools",
      notice: "company-tools",
    });
    expect(legacyTabRedirect(validateWorkspaceSearch({ tab: "members" }))).toBeNull();
    expect(legacyTabRedirect(validateWorkspaceSearch({}))).toBeNull();
  });
});
