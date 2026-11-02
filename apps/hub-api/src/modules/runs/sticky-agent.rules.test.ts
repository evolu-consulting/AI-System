// dlc-sticky · tin không tag sau run `direct` của X ⇒ tiếp tục với X nếu X còn trong AU; Orchestrator/không quyền ⇒ route mặc định.
import { describe, expect, test } from "bun:test";
import type { AgentConfig, ConfigSnapshot } from "../config/config.rules";
import { stickyRoute, untaggedRoute } from "./run-plan";

const T = "t-1";
const U = "u-1";
const who = { tenantId: T, userId: U, groupIds: new Set<string>() };

const agent = (id: string, over: Partial<AgentConfig> = {}): AgentConfig => ({
  id,
  key: id,
  name: { vi: id, en: id },
  description: "",
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: "p",
  systemPrompt: "",
  runtimeOptions: {},
  timeoutS: 60,
  tokenBudget: null,
  enabled: true,
  version: 1,
  ...over,
});

function snap(agents: AgentConfig[], granted: string[]): ConfigSnapshot {
  return {
    version: 1,
    providers: [],
    profiles: [],
    agents: [agent("orch"), ...agents],
    orchestrator: {
      agentId: "orch",
      maxSteps: 5,
      tokenBudget: 1e5,
      historyN: 10,
      onNoMatch: "answer",
      version: 1,
    },
    entitlements: ["orch", ...granted].map((agentId) => ({
      agentId,
      tenantId: T,
      revokedAt: null,
    })),
    grants: ["orch", ...granted].map((agentId) => ({ agentId, tenantId: T, subject: U })),
    agentWorkflows: new Map(),
    orchestratorTenants: new Map(),
  };
}

const two = snap([agent("dlc"), agent("b")], ["dlc", "b"]);

describe("dlc-sticky · stickyRoute", () => {
  test("run trước là direct X, X trong AU ⇒ direct X", () => {
    expect(stickyRoute(two, who, "dlc")).toMatchObject({ kind: "direct", agent: { id: "dlc" } });
  });
  test("không có run direct trước ⇒ null", () => {
    expect(stickyRoute(two, who, null)).toBeNull();
  });
  test("Orchestrator, agent tắt, mất grant, người ngoài ⇒ null", () => {
    expect(stickyRoute(two, who, "orch")).toBeNull();
    expect(stickyRoute(snap([agent("dlc", { enabled: false })], ["dlc"]), who, "dlc")).toBeNull();
    expect(stickyRoute(snap([agent("dlc")], []), who, "dlc")).toBeNull();
    expect(stickyRoute(two, { ...who, external: true }, "dlc")).toBeNull();
  });
});

describe("dlc-sticky · untaggedRoute", () => {
  test("sticky thắng route mặc định và fast", () => {
    expect(untaggedRoute(true, two, who, true, "dlc")).toMatchObject({
      route: { kind: "direct", agent: { id: "dlc" } },
      fast: null,
    });
  });
  test("tin có tag ⇒ không áp sticky", () => {
    expect(untaggedRoute(false, two, who, true, "dlc")).toEqual({ fast: null });
  });
  test("sticky không hợp lệ ⇒ như cũ (legacy)", () => {
    expect(untaggedRoute(true, two, who, false, "orch")).toEqual({
      route: { kind: "legacy" },
      fast: null,
    });
  });
});
