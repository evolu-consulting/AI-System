// ai-sub · định tuyến nhà cung cấp theo tính năng (unit, runner CLI GIẢ): `AI_PROVIDER` + ghi đè `AI_PROVIDER_<FEATURE>`, mặc định
// gói ngoài test và `off` trong test, CLI không tìm thấy ⇒ không sẵn sàng; AI client ghi `billing` theo nhà cung cấp (gói ⇒ chi phí
// 0, vẫn qua trần) và chọn nhà cung cấp theo `feature` của lời gọi.
import { describe, expect, test } from "bun:test";
import { createAiClient, type ModelProvider, type UsageRecord } from "./ai-client";
import { envProviderRouter, featureEnvKey, featureMode } from "./ai-client.env";
import type { CliRun } from "./claude-cli.provider";

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
const req = (feature: string) => ({
  tenantId: "t",
  userId: "u",
  feature,
  model: "claude-opus-5-5",
  system: "s",
  prompt: "p",
  signal: new AbortController().signal,
});
const fake = (key: string, billing?: "api" | "subscription"): ModelProvider & { calls: number } => {
  const p = {
    key,
    calls: 0,
    ...(billing ? { billing } : {}),
    complete: async () => {
      p.calls += 1;
      return { ok: true as const, text: "x", model: "claude-opus-5-5", usage };
    },
  };
  return p;
};

describe("featureMode", () => {
  test("ghi đè tính năng > AI_PROVIDER > mặc định (gói; off khi test)", () => {
    expect(featureEnvKey("contracts.extract")).toBe("AI_PROVIDER_CONTRACTS_EXTRACT");
    expect(featureEnvKey("knowledge.graph")).toBe("AI_PROVIDER_KNOWLEDGE_GRAPH");
    expect(featureMode("contracts.extract", {})).toBe("subscription");
    expect(featureMode("contracts.extract", { APP_ENV: "production" })).toBe("subscription");
    expect(featureMode("contracts.extract", { NODE_ENV: "test" })).toBe("off");
    expect(featureMode("contracts.extract", { APP_ENV: "test", AI_SUB_CLI_PATH: "/c" })).toBe(
      "subscription",
    );
    expect(featureMode("contracts.extract", { AI_PROVIDER: "API" })).toBe("api");
    expect(featureMode("contracts.extract", { AI_PROVIDER: "lạ", APP_ENV: "test" })).toBe("off");
    expect(
      featureMode("knowledge.rerank", {
        AI_PROVIDER: "subscription",
        AI_PROVIDER_KNOWLEDGE_RERANK: "api",
      }),
    ).toBe("api");
    expect(
      featureMode("knowledge.graph", { AI_PROVIDER: "api", AI_PROVIDER_KNOWLEDGE_GRAPH: "off" }),
    ).toBe("off");
  });
});

describe("envProviderRouter", () => {
  const run: CliRun = async () => ({ exitCode: 0, stdout: "{}", stderr: "" });
  test("gói dùng chung MỘT provider (một hàng đợi); api có khoá ⇒ anthropic; off ⇒ null", () => {
    const r = envProviderRouter(
      {
        AI_PROVIDER: "subscription",
        AI_PROVIDER_KNOWLEDGE_GRAPH: "api",
        AI_PROVIDER_KNOWLEDGE_RERANK: "off",
        ANTHROPIC_API_KEY: "test-key-not-real",
      },
      { run, which: (c) => `/usr/local/bin/${c}` },
    );
    const sub = r.pick("contracts.extract");
    expect(sub?.billing).toBe("subscription");
    expect(r.pick("assistant.other")).toBe(sub as ModelProvider);
    expect(r.pick("knowledge.graph")?.key).toBe("anthropic");
    expect(r.pick("knowledge.graph")?.billing ?? "api").toBe("api");
    expect(r.pick("knowledge.rerank")).toBeNull();
    expect(r.anyReady).toBe(true);
  });

  test("CLI không có trên PATH và không khoá API ⇒ không tính năng nào sẵn sàng", () => {
    const r = envProviderRouter({ AI_PROVIDER: "subscription" }, { run, which: () => null });
    expect(r.pick("contracts.extract")).toBeNull();
    expect(r.anyReady).toBe(false);
    const api = envProviderRouter({ AI_PROVIDER: "api" }, { run, which: () => "/c" });
    expect(api.anyReady).toBe(false);
  });
});

describe("AI client · billing + chọn theo tính năng", () => {
  test("gói ⇒ dòng usage billing subscription, chi phí 0; API ⇒ billing api, chi phí theo bảng giá", async () => {
    const records: UsageRecord[] = [];
    const sub = fake("claude-sub", "subscription");
    const api = fake("anthropic");
    const ai = createAiClient({
      provider: (f) => (f === "contracts.extract" ? sub : f === "knowledge.rerank" ? api : null),
      anyReady: true,
      usage: { record: async (r) => void records.push(r), tokensSince: async () => 0 },
      caps: { dailyTokens: async () => 1000 },
    });
    expect(ai.ready).toBe(true);
    expect((await ai.complete(req("contracts.extract"))).ok).toBe(true);
    expect((await ai.complete(req("knowledge.rerank"))).ok).toBe(true);
    expect(await ai.complete(req("knowledge.graph"))).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect([sub.calls, api.calls]).toEqual([1, 1]);
    expect(records.map((r) => [r.feature, r.providerKey, r.billing, r.costUsd])).toEqual([
      ["contracts.extract", "claude-sub", "subscription", 0],
      ["knowledge.rerank", "anthropic", "api", 0.00014],
    ]);
  });

  test("gói vẫn qua trần: đã dùng ≥ trần ⇒ CAP_EXCEEDED, không gọi", async () => {
    const sub = fake("claude-sub", "subscription");
    const ai = createAiClient({
      provider: () => sub,
      anyReady: true,
      usage: { record: async () => undefined, tokensSince: async () => 1000 },
      caps: { dailyTokens: async () => 1000 },
    });
    expect(await ai.complete(req("contracts.extract"))).toEqual({
      ok: false,
      code: "CAP_EXCEEDED",
    });
    expect(sub.calls).toBe(0);
  });

  test("bộ chọn không tính năng nào sẵn sàng ⇒ ready false", () => {
    const ai = createAiClient({
      provider: () => null,
      anyReady: false,
      usage: { record: async () => undefined, tokensSince: async () => 0 },
      caps: { dailyTokens: async () => null },
    });
    expect(ai.ready).toBe(false);
  });
});
