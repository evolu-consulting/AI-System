// HUB-FR-23 · H2a-R11, R14 · unit luật agent `dify-*` (plan H2a §5.4): chọn workflow, task → input, kết cục bước.
import { describe, expect, it } from "bun:test";
import type { WorkflowInput } from "@ai/contracts";
import type { CatalogWorkflow } from "../commands/catalog.types";
import type { DifyRunOutcome } from "./dify.client";
import {
  agentText,
  difyAgentEnd,
  difyAgentRequestParts,
  difyAgentTarget,
} from "./dify-agent.rules";

const inp = (name: string, type: WorkflowInput["type"], required: boolean): WorkflowInput =>
  ({
    name,
    type,
    required,
    description: name,
    ...(type === "select" ? { options: ["a"] } : {}),
  }) as WorkflowInput;
const wf = (key: string, o: Partial<CatalogWorkflow> = {}): CatalogWorkflow => ({
  id: `id-${key}`,
  key,
  name: key,
  description: null,
  appType: "workflow",
  baseUrl: "http://mk/v1",
  secretId: "s",
  inputSchema: [inp("source_text", "text", true)],
  outputField: null,
  enabled: true,
  sideEffect: false,
  ...o,
});
const catalog = [
  wf("tom"),
  wf("tat", { enabled: false }),
  wf("tro-ly", { appType: "agent", inputSchema: [inp("query", "text", true)] }),
  wf("hai", { inputSchema: [inp("a", "text", true), inp("b", "select", true)] }),
];
const agent = (runtime: string, key?: string) => ({
  runtime,
  runtimeOptions: key === undefined ? {} : { workflow_key: key },
});
const meta = {
  taskId: "task-1",
  conversationId: null,
  usage: { input_tokens: 1, output_tokens: 0, cost_usd: 0 },
  ms: 5,
};

describe("difyAgentTarget [HUB-FR-23 · H2a-R14]", () => {
  it("HUB-FR-23 · workflow bật đúng loại app → input của task; agent chat/agent → `query`", () => {
    const t = difyAgentTarget(agent("dify-workflow", "tom"), catalog);
    expect(t.ok && t.workflow.key === "tom" && t.inputName).toBe("source_text");
    const a = difyAgentTarget(agent("dify-agent", "tro-ly"), catalog);
    expect(a.ok && a.inputName).toBe("query");
  });

  it("HUB-FR-23 · thiếu key / không có / tắt / sai loại app / không map được → lỗi (NOT_CONFIGURED ở người gọi)", () => {
    const fail = (rt: string, key?: string) => {
      const t = difyAgentTarget(agent(rt, key), catalog);
      return t.ok ? null : t.failure;
    };
    expect(fail("dify-workflow")).toBe("no_workflow_key");
    expect(fail("dify-workflow", "khong-co")).toBe("workflow_unavailable");
    expect(fail("dify-workflow", "tat")).toBe("workflow_unavailable");
    expect(fail("dify-agent", "tom")).toBe("app_mismatch");
    expect(fail("dify-workflow", "tro-ly")).toBe("app_mismatch");
    expect(fail("dify-workflow", "hai")).toBe("no_input");
  });
});

describe("difyAgentRequestParts / agentText [HUB-FR-23 · H2a-R14]", () => {
  it("HUB-FR-23 · workflow: chỉ inputs; chat/agent: inputs + query = task", () => {
    expect(difyAgentRequestParts({ appType: "workflow" }, "source_text", "x")).toEqual({
      inputs: { source_text: "x" },
      query: null,
    });
    expect(difyAgentRequestParts({ appType: "chat" }, "query", "hỏi")).toEqual({
      inputs: { query: "hỏi" },
      query: "hỏi",
    });
  });

  it("HUB-FR-23 · cắt ≤ max theo code point, không để nửa cặp surrogate", () => {
    expect(agentText("abc", 5)).toBe("abc");
    expect(agentText("ab😀c", 3)).toBe("ab");
    expect(agentText("ab😀c", 4)).toBe("ab😀");
  });
});

describe("difyAgentEnd [HUB-FR-23 · H2a-R11, R10]", () => {
  it("HUB-FR-23 · finished → done; failed giữ mã/lý do/thân đã che; aborted → TIMEOUT hoặc cancelled", () => {
    const fin: DifyRunOutcome = { kind: "finished", text: "ok", ...meta };
    expect(difyAgentEnd(fin, false)).toEqual({ kind: "done", text: "ok" });
    const f: DifyRunOutcome = {
      kind: "failed",
      code: "NOT_CONFIGURED",
      reason: "upstream",
      detail: "***",
      httpStatus: 401,
      ...meta,
    };
    expect(difyAgentEnd(f, false)).toEqual({
      kind: "failed",
      code: "NOT_CONFIGURED",
      reason: "upstream",
      status: "failed",
      upstream: "***",
    });
    const ab: DifyRunOutcome = { kind: "aborted", ...meta };
    expect(difyAgentEnd(ab, true)).toMatchObject({ code: "TIMEOUT", status: "timed_out" });
    expect(difyAgentEnd(ab, false)).toEqual({ kind: "cancelled" });
  });
});
