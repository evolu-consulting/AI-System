// HUB-FR-146 · AC-H44 · AC-H47 · PD2-R03/R05/R09 · D2-13/D2-15/D2-17/D2-29/D2-30 · plan-d2 §3–§4, §10 S2/S4/S9/S10/S12:
// chạy một stage `tool` — tx1 đọc (MỘT câu: quyền + công tắc ngay trước gọi, tenant của run) → luật (`buildToolArgs`) → gọi
// tool NGOÀI tx → tx2 audit `tool_call` (mỗi lần đã gọi, không giá trị) → khoá run → khoá stage → `settleOk` / `decide` /
// `handleToolFailure` (thử lại hay quyết; `side_effect` đã gửi ⇒ không gọi lại). Kết quả > 64 KB (byte) ⇒ `tool_failed`
// trước `JSON.parse`; parse/kiểu sai ⇒ `template_invalid`. Phần tx2 ở `tool-stage-settle.ts` (PD-A03: ≤ 120 dòng).

import { buildToolArgs } from "../../domain/tools/tool-run.rules";
import type { MonotonicClock } from "../ports";
import type { ToolCallLoad, ToolDecisionReason } from "./tool.ports";
import {
  type RunToolDeps,
  settle,
  settleOf,
  type ToolLink,
  type ToolStageOutcome,
} from "./tool-stage-settle";

export type { RunToolDeps, ToolLink, ToolStageOutcome } from "./tool-stage-settle";
export { settleOf };

/** m-2 · mốc đo thời lượng qua cổng `Clock` (không Web API ở lớp 2). */
const mark = (c: MonotonicClock): number => (c.monotonicMs ? c.monotonicMs() : c.now().getTime());
/**
 * S2/S10 · thứ tự: người bắt đầu dùng được → quyền chạy → công tắc + workflow bật → cấu hình workflow đổi SAU khi lưu def:
 * M1/S4 `side_effect` mà stage không `real_action` (fail-closed: vắng `realAction` ⇒ chặn); m1 `input_schema` hỏng.
 */
function preCallReason(l: ToolCallLoad): ToolDecisionReason | null {
  if (!l.usable) return "user_inactive";
  if (!l.canRun) return "permission_lost";
  if (!l.switchOn || !l.wfEnabled) return "tool_failed";
  if (l.sideEffect && l.realAction !== true) return "tool_failed";
  if (l.inputSchemaOk === false) return "tool_failed";
  return null;
}

export async function runToolStage(d: RunToolDeps, link: ToolLink): Promise<ToolStageOutcome> {
  const l = await d.uow.system(link.tenantId, (r) =>
    r.tools.loadCall(link.runId, link.stageRunId, link.hubRunId),
  );
  if (!l) return { kind: "skip" };
  const pre = preCallReason(l);
  if (pre) return settle(d, link, { kind: "decide", reason: pre }, null);
  const built = buildToolArgs(l.args, l.inputs, l.fields, l.inputTypes);
  if (!built.ok) return settle(d, link, { kind: "decide", reason: "tool_failed" }, null);
  const t0 = mark(d.clock);
  const res = await d.invoker.call({
    tenantId: link.tenantId,
    userId: l.startedBy,
    hubRunId: link.hubRunId,
    workflowId: l.workflowId,
    ...(l.endpoint ? { endpoint: l.endpoint } : {}),
    ...(l.packTool ? { packTool: l.toolKey } : {}),
    args: built.values,
    timeoutS: l.timeoutS,
  });
  const audit = {
    toolKey: l.toolKey,
    startedBy: l.startedBy,
    status: res.kind === "ok" ? ("ok" as const) : ("failed" as const),
    code: res.kind === "ok" ? null : res.code,
    ms: Math.round(mark(d.clock) - t0),
  };
  return settle(d, link, settleOf(l, res), { audit, load: l });
}
