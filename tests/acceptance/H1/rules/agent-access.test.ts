// HUB-FR-77 · HUB-BR-03 · AC-H09 · H1-R06 · visibleAgents (test-plan H1 §4 R7, chữ ký plan §6.4).
import { describe, expect, it } from "bun:test";
import {
  type AgentRow,
  type EntitlementRow,
  type GrantRow,
  type VisibleAgentsInput,
  visibleAgents,
} from "../../../../apps/hub-api/src/modules/agents/agent-access.rules";

const ACME = "a0000000-0000-4000-8000-000000000001";
const BETA = "b0000000-0000-4000-8000-000000000001";
const LAN = "a0000000-0000-4000-8000-0000000000a1";
const HOA = "a0000000-0000-4000-8000-0000000000a2";
const G1 = "a0000000-0000-4000-8000-0000000000c1"; // lan thuộc
const G2 = "a0000000-0000-4000-8000-0000000000c2"; // lan không thuộc

const id = (n: number): string => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = {
  orch: id(1),
  assistant: id(2),
  coder: id(3),
  analyst: id(4),
  off: id(5),
  revoked: id(6),
  betaOnly: id(7),
  hoadon: id(8),
  hoaOnly: id(9),
  groupTwo: id(10),
};

// Thứ tự mảng cố ý không theo key để kiểm sắp xếp.
const agents: AgentRow[] = [
  { id: A.coder, key: "coder", enabled: true },
  { id: A.orch, key: "orchestrator", enabled: true },
  { id: A.off, key: "disabled-agent", enabled: false },
  { id: A.assistant, key: "assistant", enabled: true },
  { id: A.revoked, key: "revoked-agent", enabled: true },
  { id: A.betaOnly, key: "beta-agent", enabled: true },
  { id: A.hoadon, key: "hoadon", enabled: true },
  { id: A.hoaOnly, key: "hoa-only", enabled: true },
  { id: A.groupTwo, key: "group-two", enabled: true },
  { id: A.analyst, key: "analyst", enabled: true },
];

const ent = (agentId: string, tenantId = ACME, revokedAt: Date | null = null): EntitlementRow => ({
  agentId,
  tenantId,
  revokedAt,
});
const entitlements: EntitlementRow[] = [
  ent(A.orch),
  ent(A.assistant),
  ent(A.coder),
  ent(A.analyst),
  ent(A.off),
  ent(A.revoked, ACME, new Date("2026-10-01T00:00:00Z")),
  ent(A.betaOnly, BETA),
  ent(A.hoadon),
  ent(A.hoaOnly),
  ent(A.groupTwo),
];

const grant = (agentId: string, subject: string, tenantId = ACME): GrantRow => ({
  agentId,
  tenantId,
  subject,
});
const grants: GrantRow[] = [
  grant(A.orch, LAN),
  grant(A.assistant, LAN),
  grant(A.coder, G1),
  grant(A.analyst, LAN),
  grant(A.analyst, G1),
  grant(A.off, LAN),
  grant(A.revoked, LAN),
  grant(A.betaOnly, LAN, BETA),
  grant(A.hoaOnly, HOA),
  grant(A.groupTwo, G2),
];

const input = (over: Partial<VisibleAgentsInput> = {}): VisibleAgentsInput => ({
  agents,
  entitlements,
  grants,
  tenantId: ACME,
  userId: LAN,
  groupIds: new Set([G1]),
  orchestratorId: A.orch,
  ...over,
});
const ids = (over: Partial<VisibleAgentsInput> = {}): string[] =>
  visibleAgents(input(over)).map((a) => a.id);

describe("R7 · visibleAgents [HUB-FR-77 · HUB-BR-03]", () => {
  it("R7 · bật ∧ entitlement ∧ grant (user hoặc group), sắp theo key [HUB-FR-77 · AC-H09]", () => {
    // analyst < assistant < coder
    expect(ids()).toEqual([A.analyst, A.assistant, A.coder]);
  });

  it("R7 · grant cả user và group → chỉ 1 mục [HUB-FR-77]", () => {
    expect(ids().filter((x) => x === A.analyst)).toHaveLength(1);
  });

  it("R7 · loại agent tắt [HUB-FR-77]", () => {
    expect(ids()).not.toContain(A.off);
  });

  it("R7 · loại entitlement đã thu hồi hoặc của tenant khác [HUB-BR-03]", () => {
    const got = ids();
    expect(got).not.toContain(A.revoked);
    expect(got).not.toContain(A.betaOnly);
  });

  it("R7 · loại agent chưa grant (`hoadon`), grant user khác, group không thuộc [HUB-BR-03]", () => {
    const got = ids();
    expect(got).not.toContain(A.hoadon);
    expect(got).not.toContain(A.hoaOnly);
    expect(got).not.toContain(A.groupTwo);
  });

  it("R7 · loại Orchestrator dù có grant [HUB-FR-77 · H1-R06]", () => {
    expect(ids()).not.toContain(A.orch);
  });

  it("R7 · user hoa (không group) chỉ thấy agent grant cho mình [HUB-BR-03]", () => {
    expect(ids({ userId: HOA, groupIds: new Set() })).toEqual([A.hoaOnly]);
  });

  it("R7 · group G2 được thêm → thấy group-two [HUB-BR-03]", () => {
    expect(ids({ groupIds: new Set([G1, G2]) })).toEqual([
      A.analyst,
      A.assistant,
      A.coder,
      A.groupTwo,
    ]);
  });
});
