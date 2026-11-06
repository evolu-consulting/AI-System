import { describe, expect, it } from "bun:test";
import { legacyTabRedirect, validateWorkspaceSearch } from "./workspace-search";

describe("validateWorkspaceSearch", () => {
  it("?tab=packs cũ chuyển sang tab Ứng dụng & Gói", () => {
    expect(validateWorkspaceSearch({ tab: "packs" }).tab).toBe("features");
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
    expect(legacyTabRedirect(validateWorkspaceSearch({ tab: "users" }))).toBeNull();
    expect(legacyTabRedirect(validateWorkspaceSearch({}))).toBeNull();
  });
});
