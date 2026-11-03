import { describe, expect, it } from "bun:test";
import { validateWorkspaceSearch } from "./workspace-search";

describe("validateWorkspaceSearch", () => {
  it("?tab=packs cũ chuyển sang tab Ứng dụng & Gói", () => {
    expect(validateWorkspaceSearch({ tab: "packs" }).tab).toBe("features");
  });
  it("tab lạ bị bỏ", () => {
    expect(validateWorkspaceSearch({ tab: "nope" }).tab).toBeUndefined();
  });
});
