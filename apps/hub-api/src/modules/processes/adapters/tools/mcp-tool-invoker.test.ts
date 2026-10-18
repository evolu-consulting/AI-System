// HUB-FR-146 · D2-02/D2-17 · S1/S3: `mcpToolInvoker` gọi `WorkflowInvoker` bằng người bắt đầu, agent null, hạn của stage;
// đích từ hàng DB (`endpoint`); không invoker / app_type lạ ⇒ NOT_CONFIGURED, 0 lời gọi.
import { describe, expect, it } from "bun:test";
import type { ConfigCache } from "../../../config/config.service";
import type { WorkflowInvoker } from "../../../mcp/adapters/workflow-invoker";
import { toolError, toolText } from "../../../mcp/mcp.rules";
import { mcpToolInvoker, toCallResult } from "./mcp-tool-invoker";

const config = {} as ConfigCache;
const endpoint = {
  key: "xuat-hoa-don",
  name: "Xuất HĐ",
  appType: "workflow",
  baseUrl: "http://dify/v1",
  outputField: "result",
};
const call = {
  tenantId: "t1",
  userId: "u1",
  hubRunId: "r1",
  workflowId: "w1",
  endpoint,
  args: { tong_tien: 1 },
  timeoutS: 45,
};

describe("mcpToolInvoker", () => {
  it("HUB-FR-146 · S1 · ctx người bắt đầu, agentId null, timeoutS stage; trace gate_review", async () => {
    const seen: unknown[] = [];
    const invoker: WorkflowInvoker = {
      run: async (c, a, t) => {
        seen.push({ ctx: c.ctx, wf: c.wf.baseUrl, a, t });
        return toolText("{}");
      },
    };
    const r = await mcpToolInvoker({ invoker, config }).call(call);
    expect(r).toEqual({ kind: "ok", text: "{}" });
    expect(seen).toEqual([
      {
        ctx: { tenantId: "t1", userId: "u1", runId: "r1", agentId: null, timeoutS: 45 },
        wf: "http://dify/v1",
        a: { inputs: { tong_tien: 1 }, query: null, files: [] },
        t: { confirmation: "gate_review" },
      },
    ]);
  });
  it("HUB-FR-146 · không invoker / app_type lạ ⇒ NOT_CONFIGURED, sent=false, 0 lời gọi", async () => {
    let n = 0;
    const invoker: WorkflowInvoker = {
      run: async () => {
        n++;
        return toolText("x");
      },
    };
    const bad = { ...call, endpoint: { ...endpoint, appType: "zzz" } };
    const want = { kind: "failed" as const, code: "NOT_CONFIGURED", httpStatus: null, sent: false };
    expect(await mcpToolInvoker({ config }).call(call)).toEqual(want);
    expect(await mcpToolInvoker({ invoker, config }).call(bad)).toEqual(want);
    expect(n).toBe(0);
  });
  it("HUB-FR-146 · toCallResult: TIMEOUT/UPSTREAM_ERROR theo câu lỗi; NOT_CONFIGURED ⇒ sent=false", () => {
    expect(toCallResult(toolError("TIMEOUT"))).toMatchObject({ code: "TIMEOUT", sent: true });
    expect(toCallResult(toolError("NOT_CONFIGURED"))).toMatchObject({ sent: false });
  });
});
