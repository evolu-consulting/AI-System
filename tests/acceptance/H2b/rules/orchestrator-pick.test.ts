// HUB-FR-62 · HUB-BR-08 · HUB-BR-03 · H2b-R14, R15 · pickOrchestrator, orchestratorProblem không đổi (test-plan H2b §4
// R22–R24, cases §1.5; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import {
  orchestratorProblem,
  pickOrchestrator,
} from "../../../../apps/hub-api/src/modules/config/config.rules";
import { A, ACME, AGENTS, agentCfg, BETA, orchCfg, snapshot } from "./_access";

const DEFAULT = orchCfg(A.orch);
const ACME_CFG = orchCfg(A.orchAcme, { maxSteps: 3, historyN: 4, onNoMatch: "ask" });
const GHOST = "a2b00000-0000-4000-8000-000000000999";
const withAcme = (cfg = ACME_CFG, agents = AGENTS) =>
  snapshot({ agents, orchestratorTenants: new Map([[ACME, cfg]]) });
const withAgent = (id: string, o: { enabled?: boolean; runtime?: string }) =>
  AGENTS.map((a) => (a.id === id ? agentCfg(a.id, a.key, o) : a));

describe("HUB-FR-62 · chọn Orchestrator theo tenant [R22–R24]", () => {
  it("HUB-FR-62 · R22 · bản tenant hợp lệ → bản đó; tenant khác → mặc định [H2b-R14]", () => {
    expect(pickOrchestrator(withAcme(), ACME)).toEqual({
      config: ACME_CFG,
      tenantId: ACME,
      invalid: false,
    });
    expect(pickOrchestrator(withAcme(), BETA)).toEqual({
      config: DEFAULT,
      tenantId: null,
      invalid: false,
    });
  });

  it("HUB-FR-62 · R23 · bản tenant trỏ agent tắt / không có → mặc định + invalid; mặc định thiếu → null [H2b-R14]", () => {
    const broken = { config: DEFAULT, tenantId: null, invalid: true };
    const off = withAgent(A.orchAcme, { enabled: false });
    expect(pickOrchestrator(withAcme(ACME_CFG, off), ACME)).toEqual(broken);
    expect(pickOrchestrator(withAcme(orchCfg(GHOST)), ACME)).toEqual(broken);
    expect(pickOrchestrator(snapshot({ orchestrator: null }), BETA)).toEqual({
      config: orchCfg(A.orchBeta),
      tenantId: BETA,
      invalid: false,
    });
    const acmeOnly = snapshot({
      orchestrator: null,
      orchestratorTenants: withAcme().orchestratorTenants,
    });
    expect(pickOrchestrator(acmeOnly, BETA)).toBeNull();
    const none = snapshot({ orchestrator: null, orchestratorTenants: new Map() });
    expect(pickOrchestrator(none, ACME)).toBeNull();
  });

  it("HUB-BR-08 · R24 · orchestratorProblem chỉ xét bản mặc định (như H1) [H2b-R15]", () => {
    expect(
      orchestratorProblem(withAcme(ACME_CFG, withAgent(A.orchAcme, { enabled: false }))),
    ).toBeNull();
    expect(orchestratorProblem(withAcme(orchCfg(GHOST)))).toBeNull();
    expect(orchestratorProblem(withAcme(ACME_CFG, withAgent(A.orch, { enabled: false })))).toBe(
      "disabled",
    );
    expect(orchestratorProblem(withAcme(ACME_CFG, withAgent(A.orch, { runtime: "llm" })))).toBe(
      "not_agentic_cli",
    );
    expect(orchestratorProblem(snapshot({ orchestrator: null }))).toBe("missing_settings");
  });
});
