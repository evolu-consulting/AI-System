import { describe, expect, test } from "bun:test";
import { crumbsFor, isAllowedForRole, navGroups } from "./nav";

const ids = (role: Parameters<typeof navGroups>[0]) =>
  navGroups(role).flatMap((g) => g.items.map((i) => i.id));

describe("ADM-FR-60 · menu theo role", () => {
  test("platform_admin thấy Tenants, Users và 4 mục M2 theo nhóm", () => {
    expect(ids("platform_admin")).toEqual([
      "overview",
      "agents",
      "features",
      "commands",
      "workflows",
      "tenants",
      "users",
      "groups",
      "access",
      "secrets",
      "usage",
      "audit",
      "transfer",
    ]);
    expect(navGroups("platform_admin").map((g) => g.labelKey)).toEqual([
      null,
      "nav.group.features",
      "nav.group.access",
      "nav.group.security",
      "nav.group.system",
    ]);
  });

  test("tenant_admin không thấy Tenants và các mục M2", () => {
    expect(ids("tenant_admin")).toEqual([
      "overview",
      "agents",
      "users",
      "groups",
      "access",
      "usage",
      "audit",
    ]);
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

  test("CR-054 · breadcrumb Agents", () => {
    expect(crumbsFor("/agents")).toEqual([{ labelKey: "nav.agents" }]);
  });

  test("breadcrumb M4", () => {
    expect(crumbsFor("/usage")).toEqual([{ labelKey: "nav.usage" }]);
    expect(crumbsFor("/transfer")).toEqual([{ labelKey: "nav.transfer" }]);
    expect(crumbsFor("/audit")).toEqual([{ labelKey: "nav.audit" }]);
    expect(crumbsFor("/audit/abc")).toEqual([{ labelKey: "nav.audit", to: "/audit" }]);
    expect(crumbsFor("/account/2fa")).toEqual([{ labelKey: "account.twofa" }]);
  });

  test("breadcrumb M3", () => {
    expect(crumbsFor("/access")).toEqual([{ labelKey: "nav.access" }]);
    expect(crumbsFor("/groups")).toEqual([{ labelKey: "nav.groups" }]);
    expect(crumbsFor("/groups/new")).toEqual([
      { labelKey: "nav.groups", to: "/groups" },
      { labelKey: "groups.editor.titleNew" },
    ]);
    expect(crumbsFor("/groups/abc")).toEqual([{ labelKey: "nav.groups", to: "/groups" }]);
  });

  test("breadcrumb M2", () => {
    expect(crumbsFor("/secrets")).toEqual([{ labelKey: "nav.secrets" }]);
    expect(crumbsFor("/workflows")).toEqual([{ labelKey: "nav.workflows" }]);
    expect(crumbsFor("/workflows/")).toEqual([{ labelKey: "nav.workflows" }]);
    expect(crumbsFor("/commands/new")).toEqual([
      { labelKey: "nav.commands", to: "/commands" },
      { labelKey: "commands.editor.titleNew" },
    ]);
    expect(crumbsFor("/features/abc")).toEqual([{ labelKey: "nav.features", to: "/features" }]);
  });
});
