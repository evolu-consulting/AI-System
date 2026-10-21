// dify-workflows · unit `difyRunMeta`: kết cục client Dify → dòng lịch sử chạy (status, lỗi, id Dify).
import { describe, expect, it } from "bun:test";
import type { DifyRunOutcome } from "./dify.client";
import { difyRunMeta } from "./dify.usage";

const base = {
  taskId: "t1",
  conversationId: "c1",
  workflowRunId: "w1",
  usage: { input_tokens: 1, output_tokens: 2, cost_usd: 0 },
  ms: 5,
};

describe("dify-workflows · difyRunMeta", () => {
  it("finished → ok, không lỗi, giữ id Dify; vắng workflowRunId (fake cũ) → null", () => {
    expect(difyRunMeta({ kind: "finished", text: "x", ...base }, "wf", "command")).toEqual({
      workflowId: "wf",
      trigger: "command",
      status: "ok",
      error: null,
      difyWorkflowRunId: "w1",
      difyConversationId: "c1",
      difyTaskId: "t1",
    });
    const { workflowRunId: _w, ...old } = base;
    expect(
      difyRunMeta({ kind: "finished", text: "x", ...old }, "wf", "agent").difyWorkflowRunId,
    ).toBeNull();
  });

  it("aborted → aborted; failed → failed với thân lỗi (đã che) kèm HTTP, hoặc HTTP, hoặc code: reason", () => {
    expect(difyRunMeta({ kind: "aborted", ...base }, "wf", "agent").status).toBe("aborted");
    const f = (detail: string | null, httpStatus: number | null): DifyRunOutcome => ({
      kind: "failed",
      code: "UPSTREAM_ERROR",
      reason: "upstream",
      detail,
      httpStatus,
      ...base,
    });
    expect(difyRunMeta(f("boom", 500), "wf", "agent").error).toBe("HTTP 500 boom");
    expect(difyRunMeta(f(null, 404), "wf", "agent").error).toBe("HTTP 404");
    expect(difyRunMeta(f(null, null), "wf", "agent")).toMatchObject({
      status: "failed",
      error: "UPSTREAM_ERROR: upstream",
    });
    expect(difyRunMeta(f("only detail", null), "wf", "agent").error).toBe("only detail");
  });
});
