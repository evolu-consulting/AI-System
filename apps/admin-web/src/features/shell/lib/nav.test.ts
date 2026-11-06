import { describe, expect, test } from "bun:test";
import { crumbsFor, isAllowedForRole, isFrozenPath, navItems } from "./nav";

const ids = (role: Parameters<typeof navItems>[0], processes = false) =>
  navItems(role, { processes }).map((i) => i.id);

describe("CR-121 R1 · sidebar 6 mục phẳng", () => {
  test("platform_admin: đúng 6 mục theo thứ tự artboard Main, không nhóm", () => {
    expect(ids("platform_admin", true)).toEqual([
      "overview",
      "companies",
      "apps",
      "processes",
      "aiTools",
      "system",
    ]);
    expect(navItems("platform_admin", { processes: true }).map((i) => i.labelKey)).toEqual([
      "nav.overview",
      "nav.companies",
      "nav.apps",
      "nav.processes",
      "nav.aiTools",
      "nav.system",
    ]);
    expect(navItems("platform_admin", { processes: true }).map((i) => i.to)).toEqual([
      "/",
      "/tenants",
      "/apps",
      "/processes",
      "/ai-tools",
      "/system",
    ]);
  });

  test("engine quy trình tắt ⇒ ẩn Quy trình, còn 5 mục", () => {
    expect(ids("platform_admin")).toEqual(["overview", "companies", "apps", "aiTools", "system"]);
  });

  test("không còn Features / Commands / Agents / Workflow Dify / Secrets / Nhật ký… trên sidebar", () => {
    for (const role of ["platform_admin", "tenant_admin"] as const) {
      const all = ids(role, true);
      for (const gone of [
        "features",
        "commands",
        "agents",
        "workflows",
        "secrets",
        "audit",
        "usage",
      ]) {
        expect(all as string[]).not.toContain(gone);
      }
    }
  });

  test("tenant_admin: Tổng quan · Công ty (+ Quy trình khi engine bật) · Hệ thống", () => {
    expect(ids("tenant_admin")).toEqual(["overview", "companies", "system"]);
    expect(ids("tenant_admin", true)).toEqual(["overview", "companies", "processes", "system"]);
  });

  test("member không có mục nào", () => {
    expect(ids("member", true)).toEqual([]);
    expect(ids(undefined)).toEqual([]);
  });
});

describe("ADM-FR-60 · quyền đường dẫn & breadcrumb", () => {
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
    expect(crumbsFor("/system-health")).toEqual([
      { labelKey: "nav.system", to: "/system" },
      { labelKey: "system.title" },
    ]);
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

describe("dify-workflows · Workflows không bị cờ đóng băng", () => {
  test("/workflows, /commands, /processes không bị gate; /transfer, /sources vẫn gate", () => {
    expect(isFrozenPath("/workflows")).toBe(false);
    expect(isFrozenPath("/workflows/abc")).toBe(false);
    expect(isFrozenPath("/commands")).toBe(false);
    expect(isFrozenPath("/processes/showcase")).toBe(false);
    expect(isFrozenPath("/transfer")).toBe(true);
    expect(isFrozenPath("/sources")).toBe(true);
  });
  test("breadcrumb /processes*, /sources, /dlc-steps", () => {
    expect(crumbsFor("/processes")).toEqual([{ labelKey: "nav.processes" }]);
    expect(crumbsFor("/sources")).toEqual([{ labelKey: "nav.sources" }]);
    expect(crumbsFor("/dlc-steps")).toEqual([{ labelKey: "nav.dlcSteps" }]);
    expect(crumbsFor("/processes/new")).toEqual([
      { labelKey: "nav.processes", to: "/processes" },
      { labelKey: "nav.processesNew" },
    ]);
  });
});
