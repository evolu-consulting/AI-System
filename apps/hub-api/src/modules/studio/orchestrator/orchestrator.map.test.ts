// HUB-FR-62 · HUB-FR-69 · H4a-R07, R08, R09 · map Orchestrator + luật runtime (P9 một nguồn với `config.rules.ts`).
import { describe, expect, it } from "bun:test";
import { OrchestratorSchema } from "@ai/contracts/studio";
import {
  orchChangedFields,
  orchEntityName,
  orchSnapshot,
  toOrchestrator,
} from "./orchestrator.map";
import type { OrchDbRow } from "./orchestrator.repo";
import { isOrchestratorRuntime } from "./orchestrator-settings.rules";

const row = (o: Partial<OrchDbRow> = {}): OrchDbRow => ({
  id: 1,
  tenantId: null,
  tenantKey: null,
  tenantName: null,
  agentId: "11111111-1111-4111-8111-111111111111",
  agentKey: "orchestrator",
  agentName: { vi: "Điều phối", en: "Orchestrator" },
  agentRuntime: "agentic-cli",
  agentEnabled: true,
  maxSteps: 5,
  tokenBudget: 200_000,
  historyN: 10,
  onNoMatch: "answer",
  version: 1,
  updatedBy: null,
  updatedAt: "2026-10-06T00:00:00.000Z",
  ...o,
});

describe("orchestrator.map [HUB-FR-62]", () => {
  it("mặc định: tenant null, name vi, warnings agentic_cli_slow, khớp OrchestratorSchema", () => {
    const o = toOrchestrator(row());
    expect(OrchestratorSchema.parse(o)).toEqual(o);
    expect(o.tenant).toBeNull();
    expect(o.agent.name).toBe("Điều phối");
    expect(o.warnings).toEqual(["agentic_cli_slow"]);
    expect(orchEntityName(o)).toBe("orchestrator:default");
    expect("warnings" in orchSnapshot(o)).toBe(false);
  });

  it("tenant: entity_name orchestrator:<key>; changed fields so agent theo id", () => {
    const tid = "22222222-2222-4222-8222-222222222222";
    const a = toOrchestrator(row({ id: 7, tenantId: tid, tenantKey: "acme", tenantName: "Acme" }));
    expect(a.tenant).toEqual({ id: tid, key: "acme", name: "Acme" });
    expect(orchEntityName(a)).toBe("orchestrator:acme");
    const b = toOrchestrator(row({ id: 7, tenantId: tid, tenantKey: "acme", maxSteps: 4 }));
    expect(orchChangedFields(a, b)).toEqual(["max_steps"]);
    expect(orchChangedFields(null, b)).toHaveLength(5);
  });

  it("isOrchestratorRuntime: chỉ agentic-cli (QB1)", () => {
    expect(isOrchestratorRuntime("agentic-cli")).toBe(true);
    expect(isOrchestratorRuntime("llm")).toBe(false);
  });
});
