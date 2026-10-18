// HUB-FR-143 · HUB-BR-41 · PD-R03/R04/R08 · D-PD01 · K2 · plan §4.2/§4.3 · adapter: nối `handleJobFailure` (agent) và
// `handleTeamJobFailure` (nhóm, T7b) vào tx quy trình của stage-driver (code cũ đang trong tx, run ĐÃ khoá) — repo dựng
// bằng `bindTx` với `tenantId` của hàng run đã khoá. Stage Áp không áp (PD-R09).
import type { Tx } from "@ai/db";
import {
  handleJobFailure,
  handleTeamJobFailure,
  type TeamRef,
} from "../../application/runs/handle-job-failure.usecase";
import { bindTx } from "../hub-uow";
import type { JobFail } from "./job-result";
import { failTeamRunTx } from "./team-run.repo";

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
  /** T7b · stage nhóm lỗi: team_run + chỉ số thành viên lỗi; vắng ⇒ không phải lỗi thành viên. */
  team?: TeamRef | null;
};
export type GateOut = "retry" | "retry_exhausted" | null;

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
export async function agentFailureGate(tx: Tx, p: FailureGateIn, now: Date): Promise<GateOut> {
  if (p.executor === "team") return teamFailureGate(tx, p, now);
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

/** T7b · thành viên lỗi: có job thô ⇒ use case nhóm (thử lại / markFailed); không job (chưa cấu hình…) ⇒ markFailed. */
async function teamFailureGate(tx: Tx, p: FailureGateIn, now: Date): Promise<GateOut> {
  if (p.result.kind !== "failed" || !p.team) return null;
  const { repos } = bindTx(tx, p.tenantId);
  if (!p.job) {
    await repos.team.markFailed(p.team.teamRunId);
    return null;
  }
  const f = { runId: p.runId, stageRunId: p.stageRunId, ...p.job };
  const dec = await handleTeamJobFailure(repos, f, p.team, now);
  if (dec.kind === "retry") return "retry";
  return dec.reason === "retry_exhausted" ? "retry_exhausted" : null;
}

/** T7b · tx quy trình bỏ (run đã kết thúc / đua): team_run của stage nhóm lỗi vẫn đóng `failed` như trước. */
export async function releaseTeamRun(
  tx: Tx,
  p: { result: ResultKind; team?: TeamRef | null },
): Promise<null> {
  if (p.result.kind === "failed" && p.team) await failTeamRunTx(tx, p.team.teamRunId);
  return null;
}
