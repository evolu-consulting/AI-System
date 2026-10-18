// HUB-FR-146 · AC-H44 · D2-02/D2-17 · plan-d2 §3–§4, §10 S1/S2/S3: `ToolInvoker` của stage `tool` trên `WorkflowInvoker`
// (cùng pipeline `/mcp`: key → bước `tool` → Dify gom → usage). Danh tính = người bắt đầu (S1); đích = hàng `admin.workflows`
// đọc trong CÙNG câu kiểm công tắc (`loadCall`, S2/S3 — `base_url` của catalog Admin, không cache); hạn =
// `min(stage.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)`. Không qua cổng `side_effect` của agent (trace `confirmation:"gate_review"`,
// D2-03). Không log tham số/kết quả.
import type { CatalogWorkflow } from "../../../commands/catalog.types";
import type { ConfigCache } from "../../../config/config.service";
import type {
  InvokeCaller,
  InvokeFailure,
  WorkflowInvoker,
} from "../../../mcp/adapters/workflow-invoker";
import { TOOL_ERROR_TEXT, type ToolErrorCode, type ToolResult } from "../../../mcp/mcp.rules";
import type { ToolCallResult, ToolEndpoint, ToolInvoker } from "../../application/tools/tool.ports";

const CODE_BY_TEXT = new Map(
  (Object.entries(TOOL_ERROR_TEXT) as [ToolErrorCode, string][]).map(([c, t]) => [t, c]),
);
const APP_TYPES: ReadonlySet<string> = new Set(["workflow", "chat", "agent"]);
const NOT_CONFIGURED: ToolCallResult = {
  kind: "failed",
  code: "NOT_CONFIGURED",
  httpStatus: null,
  sent: false,
  reason: null,
};

/**
 * T18-2 · lỗi gọi ⇒ chi tiết từ `onFail` của invoker (`httpStatus`/`sent`/`reason`, Q-D2-2); vắng (lỗi không qua pipeline)
 * ⇒ mã theo câu `toolError` (lạ ⇒ UPSTREAM_ERROR), coi như ĐÃ gửi trừ `NOT_CONFIGURED` (an toàn: side_effect không gọi lại).
 */
export function toCallResult(r: ToolResult, f: InvokeFailure | null = null): ToolCallResult {
  const text = r.content.map((c) => c.text).join("");
  if (!r.isError) return { kind: "ok", text };
  if (f) return { kind: "failed", ...f };
  const code = CODE_BY_TEXT.get(text) ?? "UPSTREAM_ERROR";
  return { kind: "failed", code, httpStatus: null, sent: code !== "NOT_CONFIGURED", reason: null };
}

/** Đích từ hàng DB (đã kiểm `enabled` + công tắc cùng câu); `app_type` lạ ⇒ null. */
function workflowOfEndpoint(id: string, e: ToolEndpoint): CatalogWorkflow | null {
  if (!APP_TYPES.has(e.appType)) return null;
  return {
    id,
    key: e.key,
    name: e.name,
    description: null,
    appType: e.appType as CatalogWorkflow["appType"],
    baseUrl: e.baseUrl,
    secretId: null,
    inputSchema: [],
    outputField: e.outputField,
    enabled: true,
    sideEffect: false,
  };
}

/** `invoker` vắng (Hub không có cache cấu hình) ⇒ mọi lời gọi `NOT_CONFIGURED` (fail-closed, 0 lời gọi Dify). */
export function mcpToolInvoker(d: { invoker?: WorkflowInvoker; config: ConfigCache }): ToolInvoker {
  return {
    async call(c) {
      if (!d.invoker) return NOT_CONFIGURED;
      const wf = c.endpoint
        ? workflowOfEndpoint(c.workflowId, c.endpoint)
        : ((await d.config.catalog()).workflows.get(c.workflowId) ?? null);
      if (!wf) return NOT_CONFIGURED;
      const ctx: InvokeCaller = {
        tenantId: c.tenantId,
        userId: c.userId,
        runId: c.hubRunId,
        agentId: null,
        timeoutS: c.timeoutS,
        // hub run riêng của stage tool: chỉ driver này ghi `run_steps` ⇒ không cần khoá advisory (T18-perf).
        ownRun: true,
      };
      const args = { inputs: c.args, query: null, files: [] };
      const trace = { confirmation: "gate_review" as const };
      let fail: InvokeFailure | null = null;
      const res = await d.invoker.run({ ctx, wf, signal: c.signal }, args, trace, (f) => {
        fail = f;
      });
      return toCallResult(res, fail);
    },
  };
}
