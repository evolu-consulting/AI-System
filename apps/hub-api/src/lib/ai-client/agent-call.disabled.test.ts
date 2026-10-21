// agents-background · agent nền bị tắt cho công ty (`entitled: false`) ⇒ DISABLED (không phải UNAVAILABLE), 0 lời gọi model;
// `enabledFor` phản ánh đúng; vắng `entitled` ⇒ bật.
import { describe, expect, it } from "bun:test";
import { type AgentSpec, createAgentCaller } from "./agent-call";
import { createAiClient, type ModelRequest } from "./ai-client";

const SPEC: AgentSpec = {
  id: "00000000-0000-4000-8000-0000000000aa",
  enabled: true,
  runtime: "agentic-cli",
  systemPrompt: "SYS",
  model: null,
};
const req = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  userId: null,
  agentKey: "price-scout",
  feature: "contracts.price_scout",
  app: "contracts",
  trigger: "manual" as const,
  prompt: "{}",
  signal: new AbortController().signal,
};

function setup(spec: AgentSpec) {
  const calls: ModelRequest[] = [];
  const ai = createAiClient({
    provider: {
      key: "fake",
      async complete(r) {
        calls.push(r);
        const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
        return { ok: true, text: "{}", model: r.model, usage };
      },
    },
    usage: { record: async () => {}, tokensSince: async () => 0 },
    caps: { dailyTokens: async () => null },
  });
  return { calls, caller: createAgentCaller(ai, async () => spec) };
}

describe("agent-call · tắt theo công ty", () => {
  it("entitled=false ⇒ DISABLED, 0 lời gọi model, enabledFor=false", async () => {
    const s = setup({ ...SPEC, entitled: false });
    expect(await s.caller.call(req)).toEqual({ ok: false, code: "DISABLED" });
    expect(s.calls).toHaveLength(0);
    expect(await s.caller.enabledFor("price-scout", req.tenantId)).toBe(false);
  });
  it("entitled vắng/true ⇒ chạy bình thường, enabledFor=true", async () => {
    for (const spec of [SPEC, { ...SPEC, entitled: true }]) {
      const s = setup(spec);
      expect((await s.caller.call(req)).ok).toBe(true);
      expect(await s.caller.enabledFor("price-scout", req.tenantId)).toBe(true);
    }
  });
});
