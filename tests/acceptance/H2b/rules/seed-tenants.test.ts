// HUB-FR-62 · HUB-BR-08 · H2b-R13 · planOrchestratorTenants (test-plan H2b §4 R31–R35, cases §1.8; chữ ký
// plan-rules; plan §5.3).
import { describe, expect, it } from "bun:test";
import { planOrchestratorTenants } from "../../../../apps/hub-api/src/modules/seed/seed.rules";
import {
  type SeedAgent,
  SeedAgentSchema,
  SeedOrchestratorSchema,
  type SeedOrchestratorTenant,
} from "../../../../apps/hub-api/src/modules/seed/seed.schema";
import { ACME, BETA } from "./_access";

const seedAgent = (key: string, o: Record<string, unknown> = {}): SeedAgent =>
  SeedAgentSchema.parse({
    key,
    name: { vi: key, en: key },
    description: `Agent ${key} dùng cho kiểm thử seed.`,
    runtime: "agentic-cli",
    profile: "fake-1",
    ...o,
  });

const AGENTS: SeedAgent[] = [
  seedAgent("orchestrator"),
  seedAgent("orch-acme"),
  seedAgent("orch-off", { enabled: false }),
  seedAgent("orch-dify", { runtime: "dify-agent" }),
];
const DEFAULTS = SeedOrchestratorSchema.parse({
  agent: "orchestrator",
  max_steps: 5,
  token_budget: 150_000,
  history_n: 7,
  on_no_match: "ask",
});
const TENANTS: ReadonlyMap<string, string> = new Map([
  ["acme", ACME],
  ["beta", BETA],
]);

const plan = (entries: SeedOrchestratorTenant[], agents: readonly SeedAgent[] = AGENTS) =>
  planOrchestratorTenants({ entries, defaults: DEFAULTS, agents, tenants: TENANTS });

function errorOf(entries: SeedOrchestratorTenant[], agents?: readonly SeedAgent[]) {
  const r = plan(entries, agents);
  if (!("error" in r)) throw new Error(`mong lỗi, nhận ${JSON.stringify(r)}`);
  return r.error;
}

describe("HUB-FR-62 · seed orchestrator_tenants [R31–R35]", () => {
  it("HUB-FR-62 · R31 · upsert: trường thiếu lấy từ bản mặc định cùng yaml [H2b-R13]", () => {
    expect(plan([{ tenant_key: "acme", agent: "orch-acme", max_steps: 3 }])).toEqual({
      upserts: [
        {
          tenantId: ACME,
          agent: "orch-acme",
          maxSteps: 3,
          tokenBudget: 150_000,
          historyN: 7,
          onNoMatch: "ask",
        },
      ],
      removes: [],
      unknownTenants: [],
    });
  });

  it("HUB-FR-62 · R32 · remove → removes; tenant không có → unknownTenants, không upsert [H2b-R13]", () => {
    expect(plan([{ tenant_key: "beta", remove: true }])).toEqual({
      upserts: [],
      removes: [BETA],
      unknownTenants: [],
    });
    expect(plan([{ tenant_key: "ghost", agent: "orch-acme" }])).toEqual({
      upserts: [],
      removes: [],
      unknownTenants: ["ghost"],
    });
  });

  it("HUB-BR-08 · R33 · trùng tenant_key (kể cả upsert + remove) thắng agent lạ [H2b-R13]", () => {
    const e = errorOf([
      { tenant_key: "acme", agent: "nope" },
      { tenant_key: "acme", remove: true },
    ]);
    expect(e.path).toContain("orchestrator_tenants");
    expect(e.path).toMatch(/\d/);
    expect(e.value).toBe("acme");
  });

  it("HUB-BR-08 · R33 · agent lạ / tắt / runtime ≠ agentic-cli → lỗi có path + chỉ số [H2b-R13]", () => {
    const unknown = errorOf([
      { tenant_key: "beta", agent: "orch-acme" },
      { tenant_key: "acme", agent: "nope" },
    ]);
    expect(unknown.path).toContain("orchestrator_tenants");
    expect(unknown.path).toContain("1");
    expect(unknown.value).toBe("nope");
    for (const agent of ["orch-off", "orch-dify"]) {
      const e = errorOf([{ tenant_key: "acme", agent }]);
      expect(e.path).toContain("orchestrator_tenants");
      expect(e.path).toContain("0");
    }
  });

  it("HUB-BR-08 · R33 · agent vừa tắt vừa sai runtime → lỗi `tắt` (thứ tự kiểm) [H2b-R13]", () => {
    const off = [...AGENTS, seedAgent("orch-x", { enabled: false })];
    const offDify = [...AGENTS, seedAgent("orch-x", { enabled: false, runtime: "dify-agent" })];
    const entry: SeedOrchestratorTenant[] = [{ tenant_key: "acme", agent: "orch-x" }];
    expect(errorOf(entry, offDify)).toEqual(errorOf(entry, off));
  });

  it("HUB-FR-62 · R34 · entries rỗng → kế hoạch rỗng [H2b-R13]", () => {
    expect(plan([])).toEqual({ upserts: [], removes: [], unknownTenants: [] });
  });

  it("HUB-BR-08 · R35 · tenant lạ + agent lạ cùng mục → lỗi (không chỉ cảnh báo) [H2b-R13]", () => {
    const e = errorOf([{ tenant_key: "ghost", agent: "nope" }]);
    expect(e.value).toBe("nope");
  });
});
