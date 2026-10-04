// HUB-FR-77 · HUB-BR-03 · HUB-BR-06 · unit cho accessInput/canDelegate (R7 khoá ở tests/acceptance/H1/rules).
import { describe, expect, it } from "bun:test";
import {
  type AccessSnapshot,
  accessInput,
  canDelegate,
  H1_RUNTIME,
  visibleAgents,
} from "./agent-access.rules";

const CLI = H1_RUNTIME;
const T = "t1";
const U = "u1";
const G = "g1";
const snap: AccessSnapshot = {
  agents: [
    { id: "o", key: "orchestrator", enabled: true, description: "điều phối", runtime: CLI },
    { id: "b", key: "beta", enabled: true, description: "Agent B", runtime: CLI },
    { id: "a", key: "alpha", enabled: true, runtime: CLI },
    { id: "l", key: "llm-only", enabled: true, runtime: "llm" },
    { id: "d", key: "dify-tom", enabled: true, runtime: "dify-workflow" },
  ],
  entitlements: ["o", "a", "b", "l", "d"].map((agentId) => ({
    agentId,
    tenantId: T,
    revokedAt: null,
  })),
  grants: [
    { agentId: "o", tenantId: T, subject: U },
    { agentId: "a", tenantId: T, subject: G },
    { agentId: "b", tenantId: T, subject: U },
    { agentId: "l", tenantId: T, subject: U },
    { agentId: "d", tenantId: T, subject: U },
  ],
  orchestrator: { agentId: "o" },
};
const who = { tenantId: T, userId: U, groupIds: new Set([G]) };

describe("agent-access [HUB-FR-77 · HUB-BR-03 · HUB-BR-06]", () => {
  it("HUB-FR-77 · từ ảnh: key + mô tả, sắp key, loại Orchestrator", () => {
    expect(visibleAgents(accessInput(snap, who))).toEqual([
      { id: "a", key: "alpha", description: "" },
      { id: "b", key: "beta", description: "Agent B" },
      { id: "d", key: "dify-tom", description: "" },
    ]);
  });

  it("HUB-BR-03 · canDelegate theo key: được phép → agent, ngoài danh sách/Orchestrator → null", () => {
    const i = accessInput(snap, who);
    expect(canDelegate(i, "beta")?.id).toBe("b");
    expect(canDelegate(i, "orchestrator")).toBeNull();
    expect(canDelegate(i, "khong-co")).toBeNull();
    expect(canDelegate(accessInput(snap, { ...who, groupIds: new Set() }), "alpha")).toBeNull();
  });

  it("HUB-FR-77 · chỉ runtime chạy được (agentic-cli, dify-*): runtime khác không thấy, không delegate được", () => {
    const i = accessInput(snap, who);
    expect(visibleAgents(i).map((a) => a.key)).not.toContain("llm-only");
    expect(canDelegate(i, "llm-only")).toBeNull();
    expect(canDelegate(i, "dify-tom")?.id).toBe("d");
  });

  it("HUB-BR-06 · ảnh không có Orchestrator → không loại agent nào theo id", () => {
    const i = accessInput({ ...snap, orchestrator: null }, who);
    expect(visibleAgents(i).map((a) => a.key)).toEqual([
      "alpha",
      "beta",
      "dify-tom",
      "orchestrator",
    ]);
  });
});
