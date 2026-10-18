// HUB-FR-146 · AC-H44 · AC-H47 · PD2-R03 · D2-15/D2-17/D2-29/D2-30 · plan-d2 §3–§4, §10 S2/S9/S10/S12: chạy một stage `tool`
// — tx1 đọc (MỘT câu: quyền + công tắc ngay trước gọi, tenant của run) → luật (`buildToolArgs`) → gọi tool NGOÀI tx →
// tx2 khoá run → khoá stage → `settleOk` / `decide`. Kết quả > 64 KB (byte) ⇒ `tool_failed` trước `JSON.parse`; parse/kiểu
// sai ⇒ `template_invalid`. T18-2 thay nhánh lỗi gọi bằng `handleToolFailure` (thử lại) + audit.

import {
  filterToolFields,
  TOOL_RESULT_MAX_BYTES,
  toolOutputMd,
  utf8Bytes,
} from "../../domain/tools/tool-output.rules";
import { buildToolArgs } from "../../domain/tools/tool-run.rules";
import type { Clock, TxRepos } from "../ports";
import type { ToolCallLoad, ToolCallResult, ToolDecisionReason, ToolInvoker } from "./tool.ports";

export type ToolLink = { runId: string; stageRunId: string; hubRunId: string; tenantId: string };
export type RunToolDeps = {
  uow: { system<T>(tenantId: string, fn: (r: TxRepos) => Promise<T>): Promise<T> };
  invoker: ToolInvoker;
  clock: Clock;
};
type Settle =
  | { kind: "ok"; md: string; fields: Record<string, string | number> }
  | { kind: "decide"; reason: ToolDecisionReason };
/** `skip` = không còn việc (stage đã đổi / đua); người gọi đóng `hub.runs`. */
export type ToolStageOutcome = { kind: "skip" } | Settle;

/** S2/S10 · thứ tự: người bắt đầu dùng được → quyền chạy → công tắc + workflow bật. */
function preCallReason(l: ToolCallLoad): ToolDecisionReason | null {
  if (!l.usable) return "user_inactive";
  if (!l.canRun) return "permission_lost";
  if (!l.switchOn || !l.wfEnabled) return "tool_failed";
  return null;
}

/** S12 · byte trước `JSON.parse`; D2-05 · không JSON / sai khai báo ⇒ `template_invalid` (không tự làm lại). */
export function settleOf(
  l: Pick<ToolCallLoad, "stageName" | "outputFields">,
  res: ToolCallResult,
): Settle {
  if (res.kind === "failed") return { kind: "decide", reason: "tool_failed" };
  if (utf8Bytes(res.text) > TOOL_RESULT_MAX_BYTES) return { kind: "decide", reason: "tool_failed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return { kind: "decide", reason: "template_invalid" };
  }
  const f = filterToolFields(parsed, l.outputFields);
  if (!f.ok) return { kind: "decide", reason: "template_invalid" };
  return { kind: "ok", md: toolOutputMd(l.stageName, f.fields), fields: f.fields };
}

/** tx2: khoá run → khoá stage (còn `running` của hub run này) → ghi. Đua ⇒ `skip`. */
async function settle(d: RunToolDeps, link: ToolLink, s: Settle): Promise<ToolStageOutcome> {
  const now = d.clock.now();
  return d.uow.system(link.tenantId, async (r) => {
    if (!(await r.runs.lock(link.runId))) return { kind: "skip" } as const;
    if (!(await r.tools.lockRunning(link.stageRunId, link.hubRunId)))
      return { kind: "skip" } as const;
    const at = { runId: link.runId, stageRunId: link.stageRunId };
    if (s.kind === "ok")
      await r.tools.settleOk({ ...at, hubRunId: link.hubRunId, md: s.md, fields: s.fields }, now);
    else await r.tools.decide({ ...at, reason: s.reason }, now);
    return s;
  });
}

export async function runToolStage(d: RunToolDeps, link: ToolLink): Promise<ToolStageOutcome> {
  const l = await d.uow.system(link.tenantId, (r) =>
    r.tools.loadCall(link.runId, link.stageRunId, link.hubRunId),
  );
  if (!l) return { kind: "skip" };
  const pre = preCallReason(l);
  if (pre) return settle(d, link, { kind: "decide", reason: pre });
  const built = buildToolArgs(l.args, l.inputs, l.fields, l.inputTypes);
  if (!built.ok) return settle(d, link, { kind: "decide", reason: "tool_failed" });
  const res = await d.invoker.call({
    tenantId: link.tenantId,
    userId: l.startedBy,
    hubRunId: link.hubRunId,
    workflowId: l.workflowId,
    ...(l.endpoint ? { endpoint: l.endpoint } : {}),
    args: built.values,
    timeoutS: l.timeoutS,
  });
  return settle(d, link, settleOf(l, res));
}
