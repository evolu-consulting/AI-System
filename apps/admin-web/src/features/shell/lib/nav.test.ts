import { describe, expect, test } from "bun:test";
import { crumbsFor, isAllowedForRole, navGroups } from "./nav";

const ids = (role: Parameters<typeof navGroups>[0]) =>
  navGroups(role).flatMap((g) => g.items.map((i) => i.id));

describe("ADM-FR-60 · menu theo role", () => {
  test("platform_admin thấy Tenants và Users", () => {
    expect(ids("platform_admin")).toEqual(["overview", "tenants", "users"]);
  });

  test("tenant_admin không thấy Tenants", () => {
    expect(ids("tenant_admin")).toEqual(["overview", "users"]);
  });

  test("member không có mục nào", () => {
    expect(ids("member")).toEqual([]);
    expect(ids(undefined)).toEqual([]);
  });

  test("member chỉ vào /member và /account/password", () => {
    expect(isAllowedForRole("member", "/member")).toBe(true);
    expect(isAllowedForRole("member", "/account/password")).toBe(true);
    expect(isAllowedForRole("member", "/users")).toBe(false);
    expect(isAllowedForRole("tenant_admin", "/users")).toBe(true);
  });

  test("breadcrumb", () => {
    expect(crumbsFor("/")).toEqual([{ labelKey: "nav.overview" }]);
    expect(crumbsFor("/tenants/new")).toHaveLength(2);
    expect(crumbsFor("/unknown")).toEqual([]);
  });
});
