// CR-114 hub-fast-sdk · đo đường SDK trực tiếp với server Anthropic GIẢ (HTTP + SSE thật, SDK thật): E12 (bắt đầu `runJob`) →
// delta SSE đầu tiên qua `DeltaSink`; tỉ lệ trúng cache trên hội thoại 3 lượt. Bước `run_steps` giả (đo phần SDK, không DB).
// Đường job (spawn CLI ~1–7 s, warm pool ~−1 s) không đo được ở đây (cần Runtime thật) — số baseline lấy từ đo prod CR-114.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { HistoryItem } from "@ai/contracts/hub";
import { anthropicTurnStreamer } from "../../../lib/ai-client/anthropic.provider";
import { logger } from "../../../lib/logger";
import { DeltaSink } from "../../stream/delta-sink";
import { type AgentTask, runJob } from "../job/job-agent-runner";
import { DirectSdkRunner, type DirectSteps } from "./direct-sdk-runner";
import { type FakeAnthropic, startFakeAnthropic } from "./fake-anthropic";

const SYSTEM = `Bạn là trợ lý hợp đồng. ${"Quy tắc trả lời ngắn gọn, đúng nguồn. ".repeat(60)}`;
let fake: FakeAnthropic;
beforeAll(() => {
  fake = startFakeAnthropic({ reply: "Xin chào, đây là câu trả lời ngắn từ SDK.", chunk: 6 });
});
afterAll(() => fake.stop());

const steps: DirectSteps = {
  open: async () => 1,
  close: async () => ({ startedAt: new Date(), finishedAt: new Date() }),
};

function task(history: HistoryItem[], prompt: string, sink: DeltaSink): AgentTask {
  return {
    run: {
      id: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      locale: "vi",
    },
    snapshot: { agents: [], workflows: [] },
    agent: {
      id: crypto.randomUUID(),
      key: "assistant",
      runtime: "agentic-cli",
      runtimeOptions: { direct_sdk: true },
      systemPrompt: SYSTEM,
      timeoutS: 60,
      name: { vi: "Trợ lý", en: "Assistant" },
    },
    role: "agent",
    prompt,
    history,
    stream: sink,
  } as unknown as AgentTask;
}

describe("CR-114 · direct-sdk perf", () => {
  it("direct-sdk perf: E12→first delta and 3-turn cache hit ratio", async () => {
    const usage: { read: number; write: number; input: number }[] = [];
    const stream = anthropicTurnStreamer({ apiKey: "test-key", baseURL: fake.url });
    const runner = new DirectSdkRunner({
      steps,
      log: logger,
      stream: async (r) => {
        const reply = await stream(r);
        const u = reply.usage;
        if (u)
          usage.push({ read: u.cacheReadTokens, write: u.cacheWriteTokens, input: u.inputTokens });
        return reply;
      },
    });
    const firsts: number[] = [];
    const history: HistoryItem[] = [];
    for (const q of ["Hợp đồng A hết hạn khi nào?", "Còn hợp đồng B?", "Tóm tắt cả hai."]) {
      let first = -1;
      const t0 = performance.now();
      const sink = new DeltaSink(["done"], async () => {
        if (first < 0) first = performance.now() - t0;
      });
      const o = await runJob(runner, task(history, q, sink), new AbortController().signal, logger);
      expect(o.kind).toBe("result");
      expect(sink.text).toBe("Xin chào, đây là câu trả lời ngắn từ SDK.");
      firsts.push(first);
      history.push({ role: "user", content: q }, { role: "assistant", content: sink.text });
    }
    const sum = (k: "read" | "write" | "input") => usage.reduce((a, u) => a + u[k], 0);
    const ratio = sum("read") / (sum("read") + sum("write") + sum("input"));
    const t23 = usage.slice(1).reduce((a, u) => a + u.read, 0);
    const t23all = usage.slice(1).reduce((a, u) => a + u.read + u.write + u.input, 0);
    console.log(
      `direct-sdk E12→first-delta ms: ${firsts.map((x) => x.toFixed(1)).join(", ")} · ` +
        `cache read/write/input per turn: ${JSON.stringify(usage)} · hit ratio 3 turns=${ratio.toFixed(3)} turns2-3=${(t23 / t23all).toFixed(3)}`,
    );
    expect(fake.calls).toBe(3);
    expect(usage[0]?.read).toBe(0);
    expect(usage[1]?.read).toBeGreaterThan(0);
    expect(usage[2]?.read).toBeGreaterThan(usage[1]?.read ?? 0);
    expect(t23 / t23all).toBeGreaterThan(0.8);
    // Ngưỡng: đường SDK tới delta đầu < 250 ms với server cục bộ (đường job: spawn CLI ≥ 1 s).
    expect(Math.max(...firsts)).toBeLessThan(250);
  });
});
