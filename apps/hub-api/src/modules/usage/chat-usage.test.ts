// M2-chat · usage chat theo tenant: một hàm ghi, sink thay được (M3 trỏ bảng), bỏ job stage, không bao giờ ném.
import { afterEach, describe, expect, it } from "bun:test";
import { type ChatUsageRow, noteChatUsage, setChatUsageSink } from "./chat-usage";

const task = (stageRunId: string | null = null) => ({
  run: { id: "r1", tenantId: "t1", userId: "u1" },
  agent: { id: "a1", key: "mgmt-assistant", runtime: "dify-agent" },
  stageRunId,
});
afterEach(() => setChatUsageSink(null));

describe("M2-chat · usage chat", () => {
  it("ghi một hàng theo tenant qua sink; bỏ job stage; bỏ khi không có usage", () => {
    const rows: ChatUsageRow[] = [];
    setChatUsageSink((r) => void rows.push(r));
    noteChatUsage(task(), { input_tokens: 10, output_tokens: 4 }, true);
    noteChatUsage(task("stage-1"), { input_tokens: 1, output_tokens: 1 }, true);
    noteChatUsage(task(), undefined, false);
    expect(rows).toEqual([
      {
        tenantId: "t1",
        userId: "u1",
        runId: "r1",
        agentId: "a1",
        agentKey: "mgmt-assistant",
        runtime: "dify-agent",
        inputTokens: 10,
        outputTokens: 4,
        costUsd: null,
        ok: true,
      },
    ]);
  });

  it("sink ném / reject ⇒ không ném ra ngoài", async () => {
    setChatUsageSink(() => {
      throw new Error("db down");
    });
    expect(() => noteChatUsage(task(), { input_tokens: 1, output_tokens: 1 }, true)).not.toThrow();
    setChatUsageSink(async () => Promise.reject(new Error("x")));
    expect(() => noteChatUsage(task(), { input_tokens: 1, output_tokens: 1 }, true)).not.toThrow();
  });
});
