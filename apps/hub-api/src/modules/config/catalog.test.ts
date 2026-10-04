// HUB-FR-10, HUB-FR-76 · H2a P5, P14, R23 · unit `buildCatalog` + `usableCatalogCommands` (hàng thô giả, không DB).
import { describe, expect, test } from "bun:test";
import { buildCatalog, type CatalogRows, usableCatalogCommands } from "./catalog.rules";
import type { TenantState, UserState } from "./config.rules";

const id = (n: number) => `b1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = id(1);
const U = id(2);
const G = id(3);
const BETA = id(4);
const F = { core: id(10), tr: id(11), labs: id(12) };
const W = { ok: id(20), bad: id(21), off: id(22) };
const C = { dich: id(30), hoi: id(31), so: id(32), hong: id(33), tat: id(34) };

const wf = (wid: string, o: Partial<CatalogRows["workflows"][number]> = {}) => ({
  id: wid,
  key: `w-${wid.slice(-2)}`,
  name: "W",
  description: "Mô tả workflow đủ hai mươi ký tự.",
  appType: "workflow",
  baseUrl: "http://dify.test/v1",
  secretId: id(99),
  inputSchema: [{ name: "q", type: "text", required: true, description: "Câu hỏi" }],
  outputField: null,
  enabled: true,
  ...o,
});
const cmd = (cid: string, name: string, o: Partial<CatalogRows["commands"][number]> = {}) => ({
  id: cid,
  name,
  aliases: [],
  description: { vi: `Lệnh ${name}`, en: null },
  workflowId: W.ok,
  args: [{ name: "q", description: { vi: "Hỏi", en: "Ask" }, default: null, fallback: null }],
  inputMap: { q: { source: "arg", value: "q" } },
  output: { field: "text", render: "markdown" },
  mode: "sync",
  timeoutS: 30,
  enabled: true,
  ...o,
});
const rows = (o: Partial<CatalogRows> = {}): CatalogRows => ({
  adminVersion: 7,
  workflows: [wf(W.ok), wf(W.bad, { appType: "nope" }), wf(W.off, { enabled: false })],
  sideEffectColumn: null,
  flags: [{ workflowId: W.ok, sideEffect: true }],
  commands: [
    cmd(C.so, "so"),
    cmd(C.dich, "dich", { aliases: ["translate"] }),
    cmd(C.hoi, "hoi"),
    cmd(C.hong, "hong", { workflowId: W.bad }),
    cmd(C.tat, "tat", { workflowId: W.off }),
  ],
  names: [
    { name: "dich", commandId: C.dich },
    { name: "translate", commandId: C.dich },
    { name: "hoi", commandId: C.hoi },
    { name: "hong", commandId: C.hong },
  ],
  features: [
    { id: F.core, key: "core", status: "on" },
    { id: F.labs, key: "labs", status: "beta" },
    { id: F.tr, key: "translate", status: "on" },
  ],
  featureCommands: [
    { featureId: F.tr, commandId: C.dich },
    { featureId: F.core, commandId: C.hoi },
    { featureId: F.tr, commandId: C.so },
    { featureId: F.labs, commandId: C.so },
    { featureId: F.tr, commandId: C.tat },
  ],
  entitlements: [
    { featureId: F.tr, tenantId: T },
    { featureId: F.labs, tenantId: T },
  ],
  grants: [
    { tenantId: T, featureId: F.tr, groupId: G, userId: null },
    { tenantId: T, featureId: F.labs, groupId: null, userId: U },
  ],
  groups: [
    { id: G, tenantId: T, key: "staff" },
    { id: BETA, tenantId: T, key: "beta-testers" },
  ],
  tenants: [{ id: T, key: "acme" }],
  ...o,
});
const tenant: TenantState = { id: T, active: true, maxConcurrentSub: null };
const user = (groups: string[], o: Partial<UserState> = {}): UserState => ({
  id: U,
  tenantId: T,
  active: true,
  lockedByTenant: false,
  locale: "vi",
  groupIds: new Set(groups),
  ...o,
});
const usable = (r: CatalogRows, t: TenantState | undefined, u: UserState) =>
  usableCatalogCommands(buildCatalog(r).catalog, t, u).map((x) => [x.command.name, x.featureId]);

describe("buildCatalog", () => {
  test("HUB-FR-10 · hàng hỏng bị bỏ (workflow sai app_type kéo theo command của nó); names chỉ trỏ command còn", () => {
    const { catalog, dropped } = buildCatalog(rows());
    expect(dropped).toEqual([
      { table: "workflows", id: W.bad },
      { table: "commands", id: C.hong },
    ]);
    expect(catalog.commands.map((c) => c.name)).toEqual(["dich", "hoi", "so", "tat"]);
    expect(catalog.names.get("translate")).toBe(C.dich);
    expect(catalog.names.has("hong")).toBe(false);
    expect(catalog.commandById.get(C.dich)?.description).toEqual({ vi: "Lệnh dich" });
    expect(catalog.commandById.get(C.dich)?.args[0]).toEqual({
      name: "q",
      description: { vi: "Hỏi", en: "Ask" },
      default: null,
      fallback: null,
      rest: false,
    });
    expect(catalog.adminVersion).toBe(7);
    expect(catalog.tenantKeys.get(T)).toBe("acme");
  });

  test("H2a-R23 · không cột → workflow_flags; có cột → cột thắng hoàn toàn", () => {
    const flags = buildCatalog(rows()).catalog;
    expect(flags.sideEffectSource).toBe("flags");
    expect(flags.workflows.get(W.ok)?.sideEffect).toBe(true);
    expect(flags.workflows.get(W.off)?.sideEffect).toBe(false);
    const col = buildCatalog(rows({ sideEffectColumn: [{ id: W.off, sideEffect: true }] })).catalog;
    expect(col.sideEffectSource).toBe("column");
    expect(col.workflows.get(W.ok)?.sideEffect).toBe(false);
    expect(col.workflows.get(W.off)?.sideEffect).toBe(true);
  });
});

describe("usableCatalogCommands", () => {
  test("HUB-FR-76 · HUB-BR-19 · grant group + core; workflow tắt ẩn; beta cần thành viên", () => {
    expect(usable(rows(), tenant, user([G]))).toEqual([
      ["dich", F.tr],
      ["hoi", F.core],
      ["so", F.tr],
    ]);
    expect(usable(rows(), tenant, user([G, BETA]))).toEqual([
      ["dich", F.tr],
      ["hoi", F.core],
      ["so", F.labs],
    ]);
    expect(usable(rows(), tenant, user([]))).toEqual([["hoi", F.core]]);
  });

  test("HUB-FR-76 · entitlement thu hồi (không trong hàng) / tenant khoá / tenant thiếu / user khoá → ẩn", () => {
    expect(usable(rows({ entitlements: [] }), tenant, user([G]))).toEqual([["hoi", F.core]]);
    expect(usable(rows(), { ...tenant, active: false }, user([G]))).toEqual([]);
    expect(usable(rows(), undefined, user([G]))).toEqual([]);
    expect(usable(rows(), tenant, user([G], { lockedByTenant: true }))).toEqual([]);
  });
});
