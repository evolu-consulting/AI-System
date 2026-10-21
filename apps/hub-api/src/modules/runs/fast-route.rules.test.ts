// HUB-FR-77 · HUB-BR-03 · chat-fast · luật định tuyến nhanh (không LLM): AU đúng 1 agent ⇒ direct; mọi trường hợp khác ⇒ Orchestrator.
import { describe, expect, test } from "bun:test";
import type { AgentConfig, ConfigSnapshot, TenantAgentDefaults } from "../config/config.rules";
import { fastRoute } from "./fast-route.rules";
import { untaggedRoute } from "./run-plan";

const T = "t-1";
const OTHER_T = "t-2";
const U = "u-1";
const G = "g-1";
const who = { tenantId: T, userId: U, groupIds: new Set([G]) };

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

const ORCH = {
  agentId: "orch",
  maxSteps: 5,
  tokenBudget: 1e5,
  historyN: 10,
  onNoMatch: "answer" as const,
  version: 1,
};

function snap(o: {
  agents?: AgentConfig[];
  ent?: [string, string][];
  grants?: [string, string, string][];
  defaults?: TenantAgentDefaults;
}): ConfigSnapshot {
  return {
    version: 1,
    providers: [],
    profiles: [],
    agents: [agent("orch"), ...(o.agents ?? [])],
    orchestrator: ORCH,
    entitlements: (o.ent ?? []).map(([agentId, tenantId]) => ({
      agentId,
      tenantId,
      revokedAt: null,
    })),
    grants: (o.grants ?? []).map(([agentId, tenantId, subject]) => ({
      agentId,
      tenantId,
      subject,
    })),
    agentWorkflows: new Map(),
    orchestratorTenants: new Map(),
    ...(o.defaults ? { tenantDefaults: new Map([[T, o.defaults]]) } : {}),
  };
}

const one = snap({ agents: [agent("a")], ent: [["a", T]], grants: [["a", T, U]] });
const LEGACY = { kind: "legacy" } as const;

describe("chat-fast · fastRoute", () => {
  test("AU = {a} (grant user) ⇒ direct a", () => {
    expect(fastRoute(one, who, LEGACY)).toMatchObject({
      kind: "direct",
      rule: "single_agent",
      agent: { id: "a" },
    });
  });

  test("grant qua group / cả tenant cũng tính như canDelegate", () => {
    for (const subject of [G, T]) {
      const s = snap({ agents: [agent("a")], ent: [["a", T]], grants: [["a", T, subject]] });
      expect(fastRoute(s, who, LEGACY)?.agent.id).toBe("a");
    }
  });

  test("không quyền ⇒ null: thiếu grant, thiếu entitlement, entitlement tenant khác, grant tenant khác, agent tắt, runtime không chạy được", () => {
    const cases = [
      snap({ agents: [agent("a")], ent: [["a", T]] }),
      snap({ agents: [agent("a")], grants: [["a", T, U]] }),
      snap({ agents: [agent("a")], ent: [["a", OTHER_T]], grants: [["a", T, U]] }),
      snap({ agents: [agent("a")], ent: [["a", T]], grants: [["a", OTHER_T, U]] }),
      snap({ agents: [agent("a", { enabled: false })], ent: [["a", T]], grants: [["a", T, U]] }),
      snap({ agents: [agent("a", { runtime: "llm" })], ent: [["a", T]], grants: [["a", T, U]] }),
    ];
    for (const s of cases) expect(fastRoute(s, who, LEGACY)).toBeNull();
  });

  test("AU ≥ 2 ⇒ null (cần Orchestrator chọn)", () => {
    const s = snap({
      agents: [agent("a"), agent("b")],
      ent: [
        ["a", T],
        ["b", T],
      ],
      grants: [
        ["a", T, U],
        ["b", T, U],
      ],
    });
    expect(fastRoute(s, who, LEGACY)).toBeNull();
  });

  test("Orchestrator không bao giờ là đích (kể cả có grant)", () => {
    const s = snap({ ent: [["orch", T]], grants: [["orch", T, U]] });
    expect(fastRoute(s, who, LEGACY)).toBeNull();
  });

  test("route: orchestrator answer/fallback ⇒ áp; ask ⇒ không; direct/forbidden/vắng ⇒ không", () => {
    const fb = { kind: "fallback", agent: { id: "a", key: "a", description: "" } } as const;
    expect(
      fastRoute(one, who, { kind: "orchestrator", noMatch: { kind: "answer" } }),
    ).not.toBeNull();
    expect(fastRoute(one, who, { kind: "orchestrator", noMatch: fb })).not.toBeNull();
    expect(fastRoute(one, who, { kind: "orchestrator", noMatch: { kind: "ask" } })).toBeNull();
    expect(fastRoute(one, who, { kind: "direct", agent: agent("a") })).toBeNull();
    expect(fastRoute(one, who, { kind: "forbidden" })).toBeNull();
    expect(fastRoute(one, who, undefined)).toBeNull();
  });
});

describe("chat-fast · untaggedRoute", () => {
  test("không phải tin không tag ⇒ không route, không fast", () => {
    expect(untaggedRoute(false, one, who, true)).toEqual({ fast: null });
  });
  test("cờ tắt ⇒ route như CR-054, fast null", () => {
    expect(untaggedRoute(true, one, who, false)).toEqual({ route: LEGACY, fast: null });
  });
  test("cờ bật + AU 1 ⇒ fast", () => {
    expect(untaggedRoute(true, one, who, true).fast?.agent.id).toBe("a");
  });
  test("CR-054 forbidden giữ nguyên (không bị fast che)", () => {
    const s = snap({
      agents: [agent("a"), agent("b")],
      ent: [["a", T]],
      grants: [["a", T, U]],
      defaults: { defaultAgentId: "b", fallbackAgentId: null, onNoMatch: "answer" },
    });
    expect(untaggedRoute(true, s, who, true)).toEqual({ route: { kind: "forbidden" }, fast: null });
  });
});
