// M3-decouple · AI client chung (unit): trần trước khi gọi, ghi usage cả khi model lỗi/từ chối, lỗi ghi usage không làm hỏng lời
// gọi, bảng giá, mốc ngày UTC, trần từ env.
import { describe, expect, test } from "bun:test";
import { createAiClient, type ModelReply, type UsageRecord, utcDayStart } from "./ai-client";
import { envDailyTokens } from "./ai-client.env";
import { costUsd } from "./pricing";

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
const req = {
  tenantId: "t",
  userId: "u",
  feature: "contracts.extract",
  model: "claude-opus-5-5",
  system: "s",
  prompt: "p",
  signal: new AbortController().signal,
};
function client(
  reply: ModelReply,
  o: { cap?: number | null; used?: number; recordFails?: boolean } = {},
) {
  const records: UsageRecord[] = [];
  let since: Date | null = null;
  const ai = createAiClient({
    provider: { key: "fake", complete: async () => reply },
    usage: {
      record: async (r) => {
        if (o.recordFails) throw new Error("db");
        records.push(r);
      },
      tokensSince: async (_t, s) => {
        since = s;
        return o.used ?? 0;
      },
    },
    caps: { dailyTokens: async () => (o.cap === undefined ? 100 : o.cap) },
    now: () => new Date("2026-10-20T15:30:00Z"),
  });
  return { ai, records, since: () => since };
}

describe("AI client chung", () => {
  test("ok ⇒ trả văn bản + ghi một dòng usage (feature, model, chi phí); mốc trần = 00:00 UTC", async () => {
    const c = client({ ok: true, text: "x", model: "claude-opus-5-5", usage });
    expect(await c.ai.complete(req)).toEqual({
      ok: true,
      text: "x",
      model: "claude-opus-5-5",
      usage,
    });
    expect(c.records).toHaveLength(1);
    expect(c.records[0]).toMatchObject({
      tenantId: "t",
      feature: "contracts.extract",
      costUsd: 0.00014,
      outcome: "ok", // usage-analytics
    });
    expect(c.since()?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });
  test("đã dùng ≥ trần ⇒ CAP_EXCEEDED (không ghi); trần null ⇒ không giới hạn", async () => {
    const c = client({ ok: true, text: "x", model: "m", usage }, { used: 100 });
    expect(await c.ai.complete(req)).toEqual({ ok: false, code: "CAP_EXCEEDED" });
    expect(c.records).toHaveLength(0);
    const free = client({ ok: true, text: "x", model: "m", usage }, { cap: null, used: 1e12 });
    expect((await free.ai.complete(req)).ok).toBe(true);
  });
  test("model từ chối vẫn ghi usage (token đã tốn) và trả REFUSED; lỗi ghi usage không làm hỏng lời gọi", async () => {
    const c = client({ ok: false, code: "REFUSED", model: "claude-opus-5-5", usage });
    expect(await c.ai.complete(req)).toEqual({ ok: false, code: "REFUSED" });
    expect(c.records).toHaveLength(1);
    expect(c.records[0]?.outcome).toBe("error");
    const f = client({ ok: true, text: "x", model: "m", usage }, { recordFails: true });
    expect((await f.ai.complete(req)).ok).toBe(true);
  });
  test("bảng giá: model lạ ⇒ null; utcDayStart; trần env (0 ⇒ không trần, sai ⇒ mặc định)", () => {
    expect(costUsd("model-la", usage)).toBeNull();
    expect(costUsd("claude-haiku-5-5", { ...usage, inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      0.1,
    );
    expect(utcDayStart(new Date("2026-10-20T23:59:59Z")).toISOString()).toBe(
      "2026-10-20T00:00:00.000Z",
    );
    expect(envDailyTokens({ AI_TENANT_DAILY_TOKENS: "0" })).toBeNull();
    expect(envDailyTokens({ AI_TENANT_DAILY_TOKENS: "abc" })).toBe(5_000_000);
    expect(envDailyTokens({ AI_TENANT_DAILY_TOKENS: "42" })).toBe(42);
  });
});
