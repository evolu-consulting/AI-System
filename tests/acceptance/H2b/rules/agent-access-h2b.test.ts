// HUB-FR-77 · HUB-FR-92 · HUB-BR-03 · H2b-R09, R11, R15 · visibleAgents + excludeIds/onlyKeys, canDelegate,
// orchestratorIds, accessInput (test-plan H2b §4 R15–R19, cases §1.3; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import {
  accessInput,
  canDelegate,
  orchestratorIds,
  type VisibleAgentsInput,
  visibleAgents,
} from "../../../../apps/hub-api/src/modules/agents/agent-access.rules";
import {
  A,
  ACME,
  AGENTS,
  BETA,
  ENTITLEMENTS,
  G1,
  GRANTS,
  LAN,
  LAN_WHO,
  orchCfg,
  snapshot,
} from "./_access";

const input = (over: Partial<VisibleAgentsInput> = {}): VisibleAgentsInput => ({
  agents: AGENTS,
  entitlements: ENTITLEMENTS,
  grants: GRANTS,
  tenantId: ACME,
  userId: LAN,
  groupIds: new Set([G1]),
  orchestratorId: A.orch,
  ...over,
});
const keys = (over: Partial<VisibleAgentsInput> = {}): string[] =>
  visibleAgents(input(over)).map((a) => a.key);

/** AU của `lan` theo luật H1 (chưa loại Orchestrator tenant; `llmbot` còn vì input trực tiếp không lọc runtime). */
const H1_LAN = ["assistant", "helper", "llmbot", "orch-acme", "orch-beta", "writer"];

describe("HUB-FR-77 · AU H2b: loại Orchestrator mọi phạm vi, thu hẹp theo tag [R15–R19]", () => {
  it("HUB-BR-03 · R15 · excludeIds loại agent (kể cả Orchestrator tenant có grant) [H2b-R15]", () => {
    expect(keys({ excludeIds: new Set([A.writer]) })).toEqual(H1_LAN.filter((k) => k !== "writer"));
    expect(keys({ excludeIds: new Set([A.orchAcme, A.orchBeta]) })).toEqual([
      "assistant",
      "helper",
      "llmbot",
      "writer",
    ]);
  });

  it("HUB-FR-92 · R16 · onlyKeys thu hẹp (sắp như H1), không mở rộng ngoài AU [H2b-R09]", () => {
    expect(keys({ onlyKeys: new Set(["helper", "assistant"]) })).toEqual(["assistant", "helper"]);
    expect(keys({ onlyKeys: new Set(["assistant", "hoadon"]) })).toEqual(["assistant"]);
  });

  it("HUB-FR-77 · R17 · canDelegate theo cùng tập thu hẹp: writer null, assistant được [H2b-R09]", () => {
    const i = input({ onlyKeys: new Set(["assistant"]) });
    expect(canDelegate(i, "writer")).toBeNull();
    expect(canDelegate(i, "assistant")?.id).toBe(A.assistant);
  });

  it("HUB-BR-03 · R18 · orchestratorIds = mặc định ∪ mọi bản tenant [H2b-R15]", () => {
    const tenants = new Map([
      [ACME, { agentId: A.orchAcme }],
      [BETA, { agentId: A.orchBeta }],
    ]);
    expect(
      orchestratorIds({ orchestrator: { agentId: A.orch }, orchestratorTenants: tenants }),
    ).toEqual(new Set([A.orch, A.orchAcme, A.orchBeta]));
    expect(orchestratorIds({ orchestrator: { agentId: A.orch } })).toEqual(new Set([A.orch]));
    expect(orchestratorIds({ orchestrator: null })).toEqual(new Set());
  });

  it("HUB-FR-77 · R19 · hồi quy: input H1 (không excludeIds/onlyKeys) → kết quả như H1 [H2b-R15]", () => {
    expect(keys()).toEqual(H1_LAN);
    expect(canDelegate(input(), "writer")?.id).toBe(A.writer);
    expect(canDelegate(input(), "orchestrator")).toBeNull();
  });

  it("HUB-FR-77 · R19 · accessInput điền excludeIds = orchestratorIds(s), truyền opts.onlyKeys [H2b-R15]", () => {
    const s = snapshot({ orchestratorTenants: new Map([[ACME, orchCfg(A.orchAcme)]]) });
    const i = accessInput(s, LAN_WHO);
    expect(i.excludeIds).toEqual(new Set([A.orch, A.orchAcme]));
    expect(visibleAgents(i).map((a) => a.key)).toEqual([
      "assistant",
      "helper",
      "orch-beta",
      "writer",
    ]);
    const only = new Set(["writer"]);
    expect(accessInput(s, LAN_WHO, { onlyKeys: only }).onlyKeys).toEqual(only);
  });
});
