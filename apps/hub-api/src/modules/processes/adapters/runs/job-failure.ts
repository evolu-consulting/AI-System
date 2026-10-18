// HUB-FR-143 · HUB-BR-41 · PD-R03/R04 · D-PD01 · K2 · plan §4.2 · adapter: nối `handleJobFailure` vào tx quy trình của
// stage-driver (code cũ đang trong tx, run ĐÃ khoá) — repo dựng bằng `bindTx` với `tenantId` của hàng run đã khoá.
// Chỉ stage `agent` (đơn) ở T7a; stage nhóm thử lại ở T7b, stage Áp không áp (PD-R09).
import type { Tx } from "@ai/db";
import { handleJobFailure } from "../../application/runs/handle-job-failure.usecase";
import { bindTx } from "../hub-uow";
import type { JobFail } from "./job-result";

/** Kết quả job stage tối thiểu cần để biết có phải lỗi job không. */
type ResultKind = { kind: string; reason?: string };

export type FailureGateIn = {
  tenantId: string;
  runId: string;
  stageRunId: string;
  hubRunId: string;
  executor: string;
  result: ResultKind;
  job?: JobFail | null;
};

/** Job lỗi (`failed`) hoặc bị ngắt (`limit{interrupted}` từ `aborted`) của stage agent có thông tin job thô. */
function eligible(p: FailureGateIn): p is FailureGateIn & { job: JobFail } {
  if (!p.job || p.executor !== "agent") return false;
  return (
    p.result.kind === "failed" || (p.result.kind === "limit" && p.result.reason === "interrupted")
  );
}

/**
 * `null` ⇒ không áp / lý do cũ (luồng `eventFor` cũ cho ra đúng lý do A3); `"retry"` ⇒ đã ghi stage `waiting_timer` +
 * hẹn `retry` (người gọi bỏ `transition`, không `kick`); `"retry_exhausted"` ⇒ người gọi chuyển `needs_decision` lý do này.
 */
export async function agentFailureGate(
  tx: Tx,
  p: FailureGateIn,
  now: Date,
): Promise<"retry" | "retry_exhausted" | null> {
  if (!eligible(p)) return null;
  // D4 · `aborted` (kể cả huỷ hub run) mà run quy trình chưa bị huỷ ⇒ lỗi tạm; run huỷ/kết thúc đã bị `lockAndLoad` loại.
  const { repos } = bindTx(tx, p.tenantId);
  const dec = await handleJobFailure(
    repos,
    { runId: p.runId, stageRunId: p.stageRunId, ...p.job },
    now,
  );
  if (dec.kind === "retry") return "retry";
  return dec.reason === "retry_exhausted" ? "retry_exhausted" : null;
}
