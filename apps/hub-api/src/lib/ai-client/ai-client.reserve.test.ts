// M3c · review B #13/#14 (unit, store giả): AI client giữ chỗ token TRƯỚC khi gọi — `maxTokens` gửi model = phần được cấp; hết
// chỗ ⇒ CAP_EXCEEDED, model không được gọi; giữ chỗ lỗi ⇒ UNAVAILABLE (đóng an toàn); mọi lời gọi tới model (kể cả ném lỗi) ⇒
// ghi MỘT dòng usage rồi trả chỗ giữ; provider Anthropic lỗi giữa stream ⇒ usage một phần.
import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  createAiClient,
  estimateInputTokens,
  type ModelProvider,
  type ModelRequest,
  type TokenHoldRequest,
  type UsageRecord,
} from "./ai-client";
import { failed } from "./anthropic.provider";

const req = {
  tenantId: "t",
  userId: "u",
  feature: "contracts.extract",
  model: "claude-opus-5-5",
  system: "ss",
  prompt: "pppp",
  maxTokens: 8_000,
  signal: new AbortController().signal,
};
const usage = { inputTokens: 3, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 };

function harness(o: { grant: number | null | "throw"; provider?: ModelProvider["complete"] }) {
  const seen = {
    holds: [] as TokenHoldRequest[],
    released: [] as string[],
    records: [] as UsageRecord[],
    sent: [] as ModelRequest[],
  };
  const ai = createAiClient({
    provider: {
      key: "fake",
      complete:
        o.provider ??
        (async (r) => {
          seen.sent.push(r);
          return { ok: true, text: "x", model: r.model, usage };
        }),
    },
    usage: {
      record: async (r) => void seen.records.push(r),
      tokensSince: async () => {
        throw new Error("không được dùng khi có reserve");
      },
      reserve: async (h) => {
        seen.holds.push(h);
        if (o.grant === "throw") throw new Error("db");
        return o.grant === null ? null : { holdId: "h1", maxOutput: o.grant };
      },
      // TD #241 · trả chỗ kèm tenant (hàm DB kiểm id + tenant)
      release: async (id, tenantId) => void seen.released.push(id, tenantId),
    },
    caps: { dailyTokens: async () => 10_000 },
    now: () => new Date("2026-10-20T15:30:00Z"),
  });
  return { ai, seen };
}

describe("M3c · AI client giữ chỗ token [review B #13]", () => {
  test("được cấp 2 500 ⇒ model nhận maxTokens 2 500; ghi usage rồi trả chỗ giữ", async () => {
    const h = harness({ grant: 2_500 });
    expect((await h.ai.complete(req)).ok).toBe(true);
    expect(h.seen.holds[0]).toMatchObject({
      cap: 10_000,
      inputTokens: estimateInputTokens(req),
      maxOutput: 8_000,
      minOutput: 1_024,
    });
    expect(h.seen.holds[0]?.since.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(h.seen.sent[0]?.maxTokens).toBe(2_500);
    expect(h.seen.records).toHaveLength(1);
    expect(h.seen.released).toEqual(["h1", req.tenantId]);
  });
  test("hết chỗ ⇒ CAP_EXCEEDED, không gọi model, không ghi; giữ chỗ lỗi ⇒ UNAVAILABLE", async () => {
    const h = harness({ grant: null });
    expect(await h.ai.complete(req)).toEqual({ ok: false, code: "CAP_EXCEEDED" });
    expect({ sent: h.seen.sent.length, rec: h.seen.records.length }).toEqual({ sent: 0, rec: 0 });
    const b = harness({ grant: "throw" });
    expect(await b.ai.complete(req)).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(b.seen.sent).toHaveLength(0);
  });
});

describe("M3c · usage khi model lỗi [review B #14]", () => {
  test("provider ném lỗi ⇒ FAILED, vẫn ghi MỘT dòng (usage 0) và trả chỗ giữ", async () => {
    const h = harness({
      grant: 1_500,
      provider: async () => {
        throw new Error("boom");
      },
    });
    expect(await h.ai.complete(req)).toEqual({ ok: false, code: "FAILED" });
    expect(h.seen.records).toHaveLength(1);
    expect(h.seen.records[0]?.usage.outputTokens).toBe(0);
    expect(h.seen.released).toEqual(["h1", req.tenantId]);
  });
  test("Anthropic lỗi giữa stream ⇒ usage một phần từ message đang dở; lỗi xác thực ⇒ UNAVAILABLE", () => {
    const partial = {
      model: "claude-opus-5-5",
      usage: { input_tokens: 700, output_tokens: 50, cache_read_input_tokens: 10 },
    };
    expect(failed(new Error("socket hang up"), partial)).toEqual({
      ok: false,
      code: "FAILED",
      model: "claude-opus-5-5",
      usage: { inputTokens: 700, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 0 },
    });
    expect(failed(new Error("x"), undefined)).toEqual({ ok: false, code: "FAILED" });
    const auth = new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers());
    expect(failed(auth, undefined)).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
