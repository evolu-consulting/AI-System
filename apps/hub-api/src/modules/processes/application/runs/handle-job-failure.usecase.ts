// HUB-FR-143 · HUB-BR-41 · PD-R01…R06 · AC-H39 · AC-H40 · D-PD01 · plan §4.2/§4.4 · use case lớp 2: job stage lỗi (hoặc
// `interrupted`) ⇒ thử lại (ghi stage `waiting_timer` + hẹn `retry`) hay trả lý do cho luồng `needs_decision` cũ. Chạy
// TRONG tx của người gọi, run ĐÃ khoá (thứ tự khoá run → stage → timer, plan §6). Chỉ biết port, không `Tx`.
import { classifyJobError, legacyFailReason } from "../../domain/runs/job-error.rules";
import { decideRetry, type RetryDecision } from "../../domain/runs/retry.rules";
import { timerKey } from "../../domain/timers/timer-key.rules";
import type { TxRepos } from "../ports";

/** Lỗi job của một stage: `interrupted` (vòng quét D11 / `aborted` không do huỷ run) ⇒ tạm, không qua phân loại. */
export type JobFailure = {
  runId: string;
  stageRunId: string;
  code: string | null;
  reason: string | null;
  interrupted: boolean;
};

export type FailureRepos = Pick<TxRepos, "retry" | "sideEffect" | "timers">;
export type TeamFailureRepos = FailureRepos & Pick<TxRepos, "team">;
/** T7b · team_run của stage nhóm + chỉ số thành viên lỗi trong danh sách đang chạy (lead lỗi ⇒ `-1`). */
export type TeamRef = { teamRunId: string; cursor: number };

/** Mã ghi vào `last_error_code` khi không có mã job (ngắt giữa chừng). */
const INTERRUPTED_CODE = "INTERRUPTED";

/**
 * `retry` ⇒ đã ghi stage `waiting_timer` + hẹn `retry` (run giữ trạng thái — stage chờ tính như `queued`, Q7);
 * `decide` ⇒ người gọi chuyển `needs_decision{reason}` theo luồng cũ (lý do cũ A3 hoặc `retry_exhausted`).
 */
export async function handleJobFailure(
  r: FailureRepos,
  f: JobFailure,
  now: Date,
): Promise<RetryDecision> {
  const legacy = legacyFailReason({ code: f.code, interrupted: f.interrupted });
  const state = await r.retry.loadRetryState(f.stageRunId);
  if (!state) return { kind: "decide", reason: legacy };
  const cls = f.interrupted ? "transient" : classifyJobError(f.code, f.reason);
  // K6 · chỉ dò side_effect khi lỗi tạm (lỗi nghiệp vụ đã quyết ngay, không tốn câu SQL).
  const sideEffectSent = cls === "transient" && (await r.sideEffect.sent(f.stageRunId));
  const dec = decideRetry({ cls, state, sideEffectSent, legacy, now });
  if (dec.kind === "decide") return dec;
  await r.retry.markWaiting(f.stageRunId, {
    retryCount: dec.retryCount,
    attempt: state.attempt,
    round: state.round,
    lastErrorCode: f.code ?? INTERRUPTED_CODE,
    now,
  });
  const n = (await r.timers.countByStageKind(f.stageRunId, "retry")) + 1;
  await r.timers.insert({
    runId: f.runId,
    stageRunId: f.stageRunId,
    kind: "retry",
    dueAt: dec.dueAt,
    key: timerKey({
      kind: "retry",
      stageRunId: f.stageRunId,
      round: state.round,
      attempt: state.attempt,
      n,
    }),
    timezone: null,
  });
  return dec;
}

/**
 * T7b · PD-R08 · Q1 · thành viên nhóm lỗi: CÙNG `decideRetry` + bộ đếm `stage_runs.retry_count` + khoá idempotency theo
 * `stage_run_id`. `retry` ⇒ thêm `team.pauseForRetry` (team_run giữ `running`, dừng đồng hồ bằng `now` của Clock);
 * `decide` ⇒ `team.markFailed` — cả hai trong tx người gọi, SAU khi đã ghi stage/hẹn (thứ tự khoá run → stage → timer → team).
 */
export async function handleTeamJobFailure(
  r: TeamFailureRepos,
  f: JobFailure,
  team: TeamRef,
  now: Date,
): Promise<RetryDecision> {
  const dec = await handleJobFailure(r, f, now);
  if (dec.kind === "retry") await r.team.pauseForRetry(team.teamRunId, team.cursor, now);
  else await r.team.markFailed(team.teamRunId);
  return dec;
}
