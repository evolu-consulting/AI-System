// CR-139d · nút «Chỉnh sơ đồ»: chỉ quản trị mới thấy; đích là tab Cơ cấu của công ty mình.
import { describe, expect, test } from "bun:test";
import { canEditOrg, orgEditorPath } from "./org-editor-link";

describe("lối vào Chỉnh sơ đồ", () => {
  test("chỉ platform_admin / tenant_admin", () => {
    expect(canEditOrg("tenant_admin")).toBe(true);
    expect(canEditOrg("platform_admin")).toBe(true);
    expect(canEditOrg("member")).toBe(false);
    expect(canEditOrg(undefined)).toBe(false);
  });
  test("đích = tab Thành viên › Cơ cấu của công ty", () => {
    expect(orgEditorPath("t-1")).toBe("/tenants/t-1?tab=members&view=org");
  });
});
