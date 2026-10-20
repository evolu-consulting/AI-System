// ai-sub · N4 eval: chấm qua `ModelProvider` (gói Claude mặc định) — provider GIẢ, không AI thật; đầu ra hỏng không ném (F-20).
import { describe, expect, test } from "bun:test";
import type { ModelProvider } from "../../apps/hub-api/src/lib/ai-client/ai-client";
import { modelJudge, parseVerdict } from "./judge";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const q = { id: "q1", kind: "fact", q: "Giá?", answer: "10", gold: [], facts: [] } as never;

describe("N4 judge qua ModelProvider", () => {
  test("parseVerdict: JSON hợp lệ / hỏng / ngoài thang", () => {
    expect(parseVerdict('ok {"score":2,"note":"đủ"}')).toEqual({ score: 2, note: "đủ" });
    expect(parseVerdict("{score: 2")).toEqual({ score: 0, note: "" });
    expect(parseVerdict("{not json}")).toEqual({ score: 0, note: "judge output not JSON" });
    expect(parseVerdict('{"score":7}')).toEqual({ score: 0, note: "" });
  });

  test("gói ⇒ by claude-subscription; trả lời rồi chấm (2 lượt)", async () => {
    const prompts: string[] = [];
    const p: ModelProvider = {
      key: "claude-sub",
      billing: "subscription",
      complete: async (r) => {
        prompts.push(r.prompt);
        const text = prompts.length === 1 ? "10" : '{"score":1,"note":"thiếu"}';
        return { ok: true, text, model: r.model, usage };
      },
    };
    const v = await modelJudge(p, "m")(q, [{ doc: "d", ord: 0, text: "giá 10" }]);
    expect(v).toEqual({ score: 1, note: "thiếu", by: "claude-subscription", answer: "10" });
    expect(prompts).toHaveLength(2);
  });

  test("model lỗi ⇒ ném (run.ts dừng, không ghi điểm giả)", async () => {
    const p: ModelProvider = {
      key: "k",
      complete: async () => ({ ok: false, code: "UNAVAILABLE" }),
    };
    await expect(modelJudge(p, "m")(q, [])).rejects.toThrow(/UNAVAILABLE/);
  });
});
