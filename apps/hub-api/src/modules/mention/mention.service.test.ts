// HUB-FR-91 · H2b-R02–R05, R09 · prepareMention: thứ tự lỗi (empty_tag → tag sai đầu tiên → nội dung rỗng), kế hoạch run.
import { describe, expect, test } from "bun:test";
import type { AgentConfig, ConfigSnapshot } from "../config/config.rules";
import { type MentionRouted, prepareMention } from "./mention.service";
import { parseMention } from "./mention-parse.rules";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
const agent = (n: number, key: string, o: Partial<AgentConfig> = {}): AgentConfig => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
  key,
  name: { vi: `Tên ${key}`, en: `Name ${key}` },
  description: `Agent ${key} dùng cho kiểm thử.`,
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: U,
  systemPrompt: "",
  runtimeOptions: {},
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
  ...o,
});
const AGENTS = [
  agent(1, "orchestrator"),
  agent(2, "assistant"),
  agent(3, "helper"),
  agent(4, "llmbot", { runtime: "llm" }),
];
const snapshot: ConfigSnapshot = {
  version: 1,
  providers: [],
  profiles: [],
  agents: AGENTS,
  orchestrator: {
    agentId: AGENTS[0]?.id ?? "",
    maxSteps: 5,
    tokenBudget: 1000,
    historyN: 10,
    onNoMatch: "answer",
    version: 1,
  },
  entitlements: AGENTS.map((a) => ({ agentId: a.id, tenantId: T, revokedAt: null })),
  grants: AGENTS.map((a) => ({ agentId: a.id, tenantId: T, subject: U })),
  agentWorkflows: new Map(),
  orchestratorTenants: new Map(),
};
const who = { tenantId: T, userId: U, groupIds: new Set<string>() };
const prep = (s: string, locale: "vi" | "en" = "vi") =>
  prepareMention({ routed: parseMention(s) as MentionRouted, snapshot, who, locale });
const errOf = (s: string) => {
  try {
    prep(s);
  } catch (e) {
    const x = e as { code: string; status: number; details: unknown };
    return { code: x.code, status: x.status, details: x.details };
  }
  return null;
};

describe("prepareMention [H2b-R02–R05]", () => {
  test("HUB-FR-91 · `@` trơn → 404 suggestions []; tag sai (cả Orchestrator, runtime llm) → 404 gợi ý trong AU", () => {
    expect(errOf("@ x")).toEqual({
      code: "AGENT_NOT_FOUND",
      status: 404,
      details: { suggestions: [] },
    });
    expect(errOf("@asistant x")?.details).toEqual({ suggestions: ["assistant"] });
    expect(errOf("@orchestrator x")?.details).toEqual({ suggestions: [] });
    expect(errOf("@llmbot x")?.code).toBe("AGENT_NOT_FOUND");
    expect(errOf("@assistant @helpr x")?.details).toEqual({ suggestions: ["helper"] });
  });

  test("HUB-FR-91 · tag kiểm trước nội dung: `@nope` → 404; `@assistant` → 422 missing content", () => {
    expect(errOf("@nope")?.code).toBe("AGENT_NOT_FOUND");
    expect(errOf("@Assistant  ")).toEqual({
      code: "CMD_MISSING_ARG",
      status: 422,
      details: { missing: ["content"], invalid: [] },
    });
  });

  test("HUB-FR-91 · 1 tag → direct (responder theo locale); ≥ 2 tag → orchestrated onlyKeys [H2b-R06, R09, R10]", () => {
    const d = prep("@ASSISTANT /dich x", "en");
    expect(
      d.kind === "direct" && { key: d.agent.key, responder: d.responder, content: d.content },
    ).toEqual({
      key: "assistant",
      responder: { key: "assistant", name: "Name assistant" },
      content: "/dich x",
    });
    const o = prep("@helper @assistant làm cùng");
    expect(o.kind === "orchestrated" && { only: [...o.onlyKeys], content: o.content }).toEqual({
      only: ["helper", "assistant"],
      content: "làm cùng",
    });
  });
});
