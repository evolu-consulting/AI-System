// HUB-FR-23 · H2a-R11, R14 · luật thuần của agent `dify-*` (plan H2a §5.4): workflow theo `runtime_options.workflow_key`,
// task → input (`difyAgentInput`), kết quả Dify → kết cục bước (bảng lỗi plan-errors §2). Không I/O.
import { AGENT_TEXT_MAX, type HubJobErrorCode, type JobFailReason } from "@ai/contracts/hub";
import type { CatalogWorkflow, WorkflowInputValue } from "../commands/catalog.types";
import type { DifyRunOutcome } from "./dify.client";
import { difyAgentInput } from "./dify.rules";

/** Loại app Dify hợp lệ cho từng runtime (R14, khớp luật seed). */
const APP_TYPES: Readonly<Record<string, readonly string[]>> = {
  "dify-workflow": ["workflow"],
  "dify-agent": ["chat", "agent"],
};

export type DifyAgentTarget =
  | { ok: true; workflow: CatalogWorkflow; inputName: string }
  | {
      ok: false;
      failure: "no_workflow_key" | "workflow_unavailable" | "app_mismatch" | "no_input";
    };

/**
 * Workflow của agent `dify-*` từ catalog hiện hành: key ở `runtime_options.workflow_key`; thiếu / tắt / sai loại app /
 * không map được task → lỗi (người gọi trả `NOT_CONFIGURED`, không gọi Dify).
 */
export function difyAgentTarget(
  agent: { runtime: string; runtimeOptions: Record<string, unknown> },
  workflows: Iterable<CatalogWorkflow>,
): DifyAgentTarget {
  const key = agent.runtimeOptions.workflow_key;
  if (typeof key !== "string" || key === "") return { ok: false, failure: "no_workflow_key" };
  let workflow: CatalogWorkflow | undefined;
  for (const w of workflows) if (w.key === key) workflow = w;
  if (!workflow?.enabled) return { ok: false, failure: "workflow_unavailable" };
  if (!(APP_TYPES[agent.runtime] ?? []).includes(workflow.appType))
    return { ok: false, failure: "app_mismatch" };
  const inputName = difyAgentInput(workflow.inputSchema);
  if (!inputName) return { ok: false, failure: "no_input" };
  return { ok: true, workflow, inputName };
}

/** Task → `inputs[inputName]`; app chat/agent gửi task làm `query` (Dify bắt buộc), app workflow không có `query`. */
export function difyAgentRequestParts(
  workflow: Pick<CatalogWorkflow, "appType">,
  inputName: string,
  task: string,
): { inputs: Record<string, WorkflowInputValue>; query: string | null } {
  return { inputs: { [inputName]: task }, query: workflow.appType === "workflow" ? null : task };
}

/** `done.text` ≤ `AGENT_TEXT_MAX` (đơn vị UTF-16 như zod), cắt theo code point. */
export function agentText(text: string, max = AGENT_TEXT_MAX): string {
  if (text.length <= max) return text;
  let out = "";
  for (const cp of text) {
    if (out.length + cp.length > max) break;
    out += cp;
  }
  return out;
}

export type DifyAgentEnd =
  | { kind: "done"; text: string }
  | {
      kind: "failed";
      code: HubJobErrorCode;
      reason: JobFailReason | null;
      status: "failed" | "timed_out";
      /** Thân lỗi upstream đã che (chỉ cho `run_steps.detail`). */
      upstream: string | null;
    }
  | { kind: "cancelled" };

/** Kết quả client → kết cục bước. `aborted` do hết `agents.timeout_s` → `TIMEOUT`; do huỷ run → `cancelled`. */
export function difyAgentEnd(out: DifyRunOutcome, timedOut: boolean): DifyAgentEnd {
  if (out.kind === "finished") return { kind: "done", text: agentText(out.text) };
  if (out.kind === "failed")
    return {
      kind: "failed",
      code: out.code,
      reason: out.reason,
      status: "failed",
      upstream: out.detail,
    };
  if (timedOut)
    return {
      kind: "failed",
      code: "TIMEOUT",
      reason: "timeout",
      status: "timed_out",
      upstream: null,
    };
  return { kind: "cancelled" };
}
