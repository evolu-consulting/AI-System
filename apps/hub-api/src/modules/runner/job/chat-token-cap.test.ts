// TD #252 · lượt chat bị chặn khi tenant vượt trần token/ngày: giữ chỗ TRƯỚC khi dựng/đẩy job, trả chỗ khi xong.
import { describe, expect, it } from "bun:test";
import type { Db } from "../../../lib/db";
import { logger } from "../../../lib/logger";
import { type ChatGateTask, chatTokenGate } from "../../usage/chat-token-gate";
import type { RunStreamReader } from "../run-stream-reader";
import { type AgentTask, JobAgentRunner } from "./job-agent-runner";

const T = "00000000-0000-4000-8000-0000000000aa";
const touched: string[] = [];
/** DB/Redis giả: mọi truy cập ghi lại (cửa trần phải chặn TRƯỚC khi chạm DB/enqueue). */
const trap = (name: string) =>
  new Proxy(
    {},
    {
      get: () => {
        touched.push(name);
        return () => Promise.reject(new Error(`${name} used`));
      },
    },
  );

const gateTask: ChatGateTask = {
  run: { tenantId: T },
  agent: { timeoutS: 600 },
  prompt: "câu hỏi",
  history: [{ content: "trước" }],
};

function fakeUsage(grant: boolean) {
  const calls = { reserve: [] as unknown[], release: [] as string[] };
  return {
    calls,
    usage: {
      tokensSince: async () => 0,
      reserve: async (r: unknown) => {
        calls.reserve.push(r);
        return grant ? { holdId: "h1", maxOutput: 1000 } : null;
      },
      release: async (id: string, tenantId: string) => void calls.release.push(id, tenantId),
    },
  };
}

describe("TD #252 · chatTokenGate", () => {
  it("trần null ⇒ không giữ chỗ, không chặn", async () => {
    const f = fakeUsage(true);
    const g = chatTokenGate({ usage: f.usage, cap: () => null });
    expect(await g.reserve(gateTask)).toEqual({ holdId: null, tenantId: T });
    expect(f.calls.reserve).toHaveLength(0);
  });

  it("giữ chỗ theo tenant + trần + mốc 00:00 UTC; hết trần ⇒ null; trả chỗ theo id", async () => {
    const f = fakeUsage(true);
    const now = () => new Date("2026-10-20T15:30:00Z");
    const g = chatTokenGate({ usage: f.usage, cap: () => 5000, now });
    const hold = await g.reserve(gateTask);
    expect(hold).toEqual({ holdId: "h1", tenantId: T });
    expect(f.calls.reserve[0]).toMatchObject({
      tenantId: T,
      cap: 5000,
      since: new Date("2026-10-20T00:00:00Z"),
      minOutput: 1024,
    });
    await g.release(hold as { holdId: string; tenantId: string });
    expect(f.calls.release).toEqual(["h1", T]);
    const over = fakeUsage(false);
    expect(
      await chatTokenGate({ usage: over.usage, cap: () => 5000, now }).reserve(gateTask),
    ).toBeNull();
  });

  it("store không có reserve ⇒ kiểm-rồi-chạy theo tokensSince", async () => {
    const used = (n: number) => ({ tokensSince: async () => n });
    const mk = (n: number) => chatTokenGate({ usage: used(n), cap: () => 100 });
    expect(await mk(100).reserve(gateTask)).toBeNull();
    expect(await mk(99).reserve(gateTask)).toEqual({ holdId: null, tenantId: T });
  });
});

function runner(gate: ReturnType<typeof chatTokenGate>) {
  return new JobAgentRunner({
    db: trap("db") as unknown as Db,
    owner: "o",
    reader: trap("reader") as unknown as RunStreamReader,
    maxWaitS: 1,
    log: logger,
    tokenGate: gate,
  });
}
const agentTask = {
  run: { id: "r1", tenantId: T, userId: "u", conversationId: "c", flowId: "f", locale: "vi" },
  agent: { id: "a", key: "k", timeoutS: 600, runtime: "agentic-cli", runtimeOptions: {} },
  role: "agent",
  prompt: "hi",
  history: [],
} as unknown as AgentTask;

describe("TD #252 · JobAgentRunner chặn khi tenant vượt trần", () => {
  it("vượt trần ⇒ job.failed ALL_PROVIDERS_EXHAUSTED/quota, không chạm DB/Redis (không INSERT job), không trả chỗ", async () => {
    touched.length = 0;
    const f = fakeUsage(false);
    const evs = [];
    for await (const e of runner(chatTokenGate({ usage: f.usage, cap: () => 10 })).run(
      agentTask,
      new AbortController().signal,
    ))
      evs.push(e);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: "job.failed",
      code: "ALL_PROVIDERS_EXHAUSTED",
      reason: "quota",
    });
    expect(touched).toEqual([]);
    expect(f.calls.release).toEqual([]);
  });

  it("còn trần nhưng bước sau lỗi ⇒ chỗ giữ vẫn được trả (finally)", async () => {
    touched.length = 0;
    const f = fakeUsage(true);
    const it = runner(chatTokenGate({ usage: f.usage, cap: () => 10 })).run(
      agentTask,
      new AbortController().signal,
    );
    await expect(it.next()).rejects.toThrow();
    expect(f.calls.reserve).toHaveLength(1);
    expect(f.calls.release).toEqual(["h1", T]);
  });

  it("job stage quy trình (stageRunId) không qua cửa chat", async () => {
    touched.length = 0;
    const f = fakeUsage(false);
    const it = runner(chatTokenGate({ usage: f.usage, cap: () => 10 })).run(
      { ...agentTask, stageRunId: "s1" },
      new AbortController().signal,
    );
    await expect(it.next()).rejects.toThrow(); // đi tiếp tới DB giả, không bị cửa chặn
    expect(f.calls.reserve).toHaveLength(0);
  });
});
