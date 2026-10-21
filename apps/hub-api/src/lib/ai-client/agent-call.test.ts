// price-scout · cổng gọi agent Hub: model/lệnh hệ thống lấy từ agent (Studio), usage mang agent/app/trigger/subject; agent tắt /
// runtime dify / chưa seed ⇒ UNAVAILABLE (không gọi model).
import { describe, expect, it } from "bun:test";
import { type AgentSpec, createAgentCaller } from "./agent-call";
import { createAiClient, type ModelRequest, type UsageRecord } from "./ai-client";

const AGENT: AgentSpec = {
  id: "00000000-0000-4000-8000-0000000000aa",
  enabled: true,
  runtime: "agentic-cli",
  systemPrompt: "SYS",
  model: null,
};

function setup(spec: AgentSpec | null) {
  const calls: ModelRequest[] = [];
  const rows: UsageRecord[] = [];
  const ai = createAiClient({
    provider: {
      key: "fake",
      async complete(r) {
        calls.push(r);
        return {
          ok: true,
          text: "{}",
          model: r.model,
          usage: { inputTokens: 3, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    },
    usage: { record: async (r) => void rows.push(r), tokensSince: async () => 0 },
    caps: { dailyTokens: async () => null },
  });
  return { calls, rows, caller: createAgentCaller(ai, async () => spec) };
}
const req = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  userId: null,
  agentKey: "price-scout",
  feature: "contracts.price_scout",
  app: "contracts",
  trigger: "schedule" as const,
  subjectId: "00000000-0000-4000-8000-0000000000bb",
  prompt: "{}",
  webSearch: true,
  signal: new AbortController().signal,
};

describe("agent-call", () => {
  it("dùng lệnh hệ thống + model của agent (vắng ⇒ sonnet); usage có agent/app/trigger/subject", async () => {
    const s = setup(AGENT);
    expect((await s.caller.call(req)).ok).toBe(true);
    expect(s.calls[0]).toMatchObject({ system: "SYS", model: "sonnet", webSearch: true });
    expect(s.rows[0]).toMatchObject({
      feature: "contracts.price_scout",
      agentId: AGENT.id,
      app: "contracts",
      trigger: "schedule",
      subjectId: req.subjectId,
    });
  });
  it("agent tắt / dify / chưa có ⇒ UNAVAILABLE, không gọi model", async () => {
    for (const spec of [{ ...AGENT, enabled: false }, { ...AGENT, runtime: "dify-agent" }, null]) {
      const s = setup(spec);
      expect(await s.caller.call(req)).toEqual({ ok: false, code: "UNAVAILABLE" });
      expect(s.calls).toHaveLength(0);
      expect(await s.caller.ready("price-scout")).toBe(false);
    }
  });
});
