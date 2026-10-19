// HUB-FR-146 · AC-H44 · AC-H47 · PD2-R03/R05/R09 · D2-13/D2-15/D2-29/D2-30 · plan-d2 §4, §10 S12 · tx2 của `runToolStage`:
// phân loại kết quả tool (`settleOf`) và ghi vào stage đã khoá (`settle`): audit `tool_call` → khoá run → khoá stage →
// `settleOk` / `decide` / `handleToolFailure`. Tách khỏi `run-tool-stage.usecase.ts` để giữ trần 120 dòng (PD-A03).
import {
  filterToolFields,
  TOOL_RESULT_MAX_BYTES,
  toolOutputMd,
  utf8Bytes,
} from "../../domain/tools/tool-output.rules";
import type { ToolFailure } from "../../domain/tools/tool-run.rules";
import type { Logger, MonotonicClock, TxRepos } from "../ports";
import { handleToolFailure } from "./handle-tool-failure.usecase";
import type {
  ToolCallAudit,
  ToolCallLoad,
  ToolCallResult,
  ToolDecisionReason,
  ToolInvoker,
} from "./tool.ports";
export type ToolLink = { runId: string; stageRunId: string; hubRunId: string; tenantId: string };
export type RunToolDeps = {
  uow: { system<T>(tenantId: string, fn: (r: TxRepos) => Promise<T>): Promise<T> };
  invoker: ToolInvoker;
  /** m-2 · `monotonicMs` do adapter cấp (đo `ms` của audit `tool_call`). */
  clock: MonotonicClock;
  /** Vắng (cổng giả) ⇒ không log; quyết định m-3 vẫn chạy. */
  log?: Logger;
};
/** m-2 · mốc đo thời lượng qua cổng `Clock` (không Web API ở lớp 2). */
const mark = (c: MonotonicClock): number => (c.monotonicMs ? c.monotonicMs() : c.now().getTime());
export type Settle =
  | { kind: "ok"; md: string; fields: Record<string, string | number> }
  | { kind: "decide"; reason: ToolDecisionReason }
  | { kind: "fail"; failure: ToolFailure };
/** `skip` = không còn việc (stage đã đổi / đua); `retry` = đã hẹn thử lại. Người gọi đóng `hub.runs`. */
export type ToolStageOutcome =
  | { kind: "skip" }
  | { kind: "retry" }
  | Exclude<Settle, { kind: "fail" }>;
/** Ngữ cảnh tx2 khi đã gọi tool: audit + dữ liệu cho quyết định thử lại. */
export type Called = { audit: Omit<ToolCallAudit, "runId" | "stageRunId">; load: ToolCallLoad };

/** S12 · byte trước `JSON.parse`; D2-05 · không JSON / sai khai báo ⇒ `template_invalid` (không tự làm lại). */
export function settleOf(
  l: Pick<ToolCallLoad, "stageName" | "outputFields">,
  res: ToolCallResult,
): Settle {
  if (res.kind === "failed") {
    const { kind: _k, ...failure } = res;
    return { kind: "fail", failure };
  }
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

/** Lý do quyết của nhánh thử lại: chỉ `tool_failed` / `retry_exhausted` (D2-13). */
const toolReason = (reason: string): ToolDecisionReason =>
  reason === "retry_exhausted" ? "retry_exhausted" : "tool_failed";

type ApplyIn = { link: ToolLink; s: Settle; c: Called | null; now: Date; log: Logger | undefined };

/**
 * m-3 · máy trạng thái từ chối output (`settleOk` false — stage đã khoá `running` của hub run này nhưng run/stage lệch) ⇒
 * log + `tool_failed` (như mạng an toàn `failStuckRun` của stage agent: không để stage kẹt `running` gắn hub run đã đóng).
 */
async function settleOkOrFail(r: TxRepos, x: ApplyIn, s: Extract<Settle, { kind: "ok" }>) {
  const at = { runId: x.link.runId, stageRunId: x.link.stageRunId };
  const ok = { ...at, hubRunId: x.link.hubRunId, md: s.md, fields: s.fields };
  // `=== false`: cổng cũ trả `void` = đã ghi.
  if ((await r.tools.settleOk(ok, x.now)) !== false) return s;
  x.log?.warn("process-tool-output-rejected", { ...at, hub_run_id: x.link.hubRunId });
  await r.tools.decide({ ...at, reason: "tool_failed" }, x.now);
  return { kind: "decide", reason: "tool_failed" } as const;
}

/** Ghi kết quả vào stage đã khoá (tx2). */
async function apply(r: TxRepos, x: ApplyIn): Promise<ToolStageOutcome> {
  const { link, s, c, now } = x;
  const at = { runId: link.runId, stageRunId: link.stageRunId };
  if (s.kind === "ok") return settleOkOrFail(r, x, s);
  if (s.kind === "decide" || !c) {
    const reason = s.kind === "decide" ? s.reason : "tool_failed";
    await r.tools.decide({ ...at, reason }, now);
    return { kind: "decide", reason };
  }
  const f = { ...at, failure: s.failure, sideEffect: c.load.sideEffect, state: c.load.state };
  const dec = await handleToolFailure(r, f, now);
  if (dec.kind === "retry") {
    await r.tools.retried?.(link.runId);
    return { kind: "retry" };
  }
  const reason = toolReason(dec.reason);
  await r.tools.decide({ ...at, reason }, now);
  return { kind: "decide", reason };
}

/** tx2: audit (lời gọi đã xảy ra, kể cả khi đua) → khoá run → khoá stage (còn `running` của hub run này) → ghi. */
export async function settle(
  d: RunToolDeps,
  link: ToolLink,
  s: Settle,
  c: Called | null,
): Promise<ToolStageOutcome> {
  const now = d.clock.now();
  return d.uow.system(link.tenantId, async (r) => {
    if (c) await r.tools.audit({ runId: link.runId, stageRunId: link.stageRunId, ...c.audit });
    if (!(await r.runs.lock(link.runId))) return { kind: "skip" } as const;
    if (!(await r.tools.lockRunning(link.stageRunId, link.hubRunId)))
      return { kind: "skip" } as const;
    return apply(r, { link, s, c, now, log: d.log });
  });
}
