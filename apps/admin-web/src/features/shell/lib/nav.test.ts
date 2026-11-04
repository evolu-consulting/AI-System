import { describe, expect, test } from "bun:test";
import { crumbsFor, isAllowedForRole, isFrozenPath, navGroups } from "./nav";

const ids = (role: Parameters<typeof navGroups>[0]) =>
  navGroups(role).flatMap((g) => g.items.map((i) => i.id));

describe("ADM-FR-60 · menu theo role", () => {
  test("ADM-FR-76 · platform_admin thấy 3 nhóm Nền tảng · Công ty · Hệ thống đúng thứ tự Q9", () => {
    expect(ids("platform_admin")).toEqual([
      "overview",
      "apps",
      "features",
      "commands",
      "agents",
      "workflows",
      "secrets",
      "system",
      "usage",
      "audit",
      "feedback",
      "transfer",
    ]);
    expect(navGroups("platform_admin").map((g) => g.labelKey)).toEqual([
      null,
      "nav.group.platform",
      "nav.group.automation",
      "nav.group.companies",
      "nav.group.system",
    ]);
    expect(navGroups("platform_admin").find((g) => g.kind === "companies")?.labelKey).toBe(
      "nav.group.companies",
    );
  });

  test("ADM-FR-76 · Người dùng/Nhóm/Đối tác/Phân quyền không còn trên sidebar (nằm trong workspace công ty)", () => {
    for (const role of ["platform_admin", "tenant_admin"] as const) {
      const all = ids(role);
      for (const gone of ["users", "groups", "partners", "access", "tenants"]) {
        expect(all).not.toContain(gone);
      }
    }
  });

  test("ADM-FR-77 · tenant_admin không có nhóm Nền tảng, chỉ nhóm Công ty (của mình) và Hệ thống", () => {
    expect(ids("tenant_admin")).toEqual(["overview", "usage", "audit", "feedback"]);
    expect(navGroups("tenant_admin").map((g) => g.labelKey)).toEqual([
      null,
      "nav.group.companies",
      "nav.group.system",
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

describe("P-a · mục Quy trình theo cờ engine", () => {
  test("mặc định ẩn ở cả hai role", () => {
    expect(ids("platform_admin")).not.toContain("processes");
    expect(ids("tenant_admin")).not.toContain("processes");
    expect(ids("platform_admin")).not.toContain("sources");
    expect(ids("tenant_admin")).not.toContain("sources");
  });
  test("engine on: Quy trình + Nguồn có ở Nền tảng (platform_admin, trước Agents) và nhóm Chức năng (tenant_admin)", () => {
    const groupOf = { platform_admin: "nav.group.automation", tenant_admin: "nav.group.features" };
    for (const role of ["platform_admin", "tenant_admin"] as const) {
      const g = navGroups(role, { processes: true }).find((x) => x.labelKey === groupOf[role]);
      expect(g?.items.map((i) => i.id)).toContain("processes");
      expect(g?.items.map((i) => i.id)).toContain("sources");
    }
    // adm-menu-automation: Workflow Dify + Quy trình cùng nhóm "Tự động hoá"
    const auto = navGroups("platform_admin", { processes: true }).find(
      (x) => x.labelKey === "nav.group.automation",
    );
    expect(auto?.items.map((i) => i.id).slice(0, 2)).toEqual(["workflows", "processes"]);
  });
  test("member không có mục nào dù cờ on; crumbs /processes*", () => {
    expect(navGroups("member", { processes: true })).toEqual([]);
    expect(crumbsFor("/processes")).toEqual([{ labelKey: "nav.processes" }]);
    expect(crumbsFor("/sources")).toEqual([{ labelKey: "nav.sources" }]);
    expect(crumbsFor("/processes/new")).toEqual([
      { labelKey: "nav.processes", to: "/processes" },
      { labelKey: "nav.processesNew" },
    ]);
  });
});

describe("dlc-step-library · mục Bước DLC", () => {
  test("chỉ platform_admin, nhóm Tự động hoá sau Quy trình + Nguồn, cùng cờ engine; crumb /dlc-steps", () => {
    const auto = (role: "platform_admin" | "tenant_admin", processes: boolean) =>
      navGroups(role, { processes })
        .flatMap((g) => g.items)
        .map((i) => i.id);
    expect(auto("platform_admin", false)).not.toContain("dlcSteps");
    expect(auto("tenant_admin", true)).not.toContain("dlcSteps");
    const g = navGroups("platform_admin", { processes: true }).find(
      (x) => x.labelKey === "nav.group.automation",
    );
    expect(g?.items.map((i) => i.id)).toEqual(["workflows", "processes", "sources", "dlcSteps"]);
    expect(crumbsFor("/dlc-steps")).toEqual([{ labelKey: "nav.dlcSteps" }]);
  });
});

describe("dify-workflows · Workflows không bị cờ đóng băng", () => {
  test("frozen=false: platform_admin vẫn có Workflows và Commands; /workflows không bị gate", () => {
    const items = navGroups("platform_admin", { frozen: false }).flatMap((g) => g.items);
    expect(items.some((i) => i.id === "workflows")).toBe(true);
    expect(items.some((i) => i.id === "commands")).toBe(true);
    expect(isFrozenPath("/workflows")).toBe(false);
    expect(isFrozenPath("/workflows/abc")).toBe(false);
    expect(isFrozenPath("/commands")).toBe(false);
    expect(isFrozenPath("/transfer")).toBe(true);
  });
});

describe("CR-103 fnr-unfreeze · Quy trình theo Hub, không theo cờ build", () => {
  test("frozen=false + engine on: có Quy trình, không có Nguồn; /processes* không bị gate, /sources vẫn gate", () => {
    for (const role of ["platform_admin", "tenant_admin"] as const) {
      const ids = navGroups(role, { frozen: false, processes: true })
        .flatMap((g) => g.items)
        .map((i) => i.id);
      expect(ids).toContain("processes");
      expect(ids).not.toContain("sources");
    }
    expect(isFrozenPath("/processes")).toBe(false);
    expect(isFrozenPath("/processes/showcase")).toBe(false);
    expect(isFrozenPath("/sources")).toBe(true);
  });
  test("engine off ⇒ không có Quy trình (dù cờ build on/off); member không có mục nào", () => {
    for (const frozen of [true, false]) {
      const ids = navGroups("tenant_admin", { frozen, processes: false }).flatMap((g) => g.items);
      expect(ids.some((i) => i.id === "processes")).toBe(false);
    }
    expect(navGroups("member", { frozen: false, processes: true })).toEqual([]);
  });
});
