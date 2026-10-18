// HUB-FR-114 · N4 · D7 · PB-R17 · T7s · adapter: xử lý job thành viên nhóm lỗi — mã job ⇒ lý do thành viên, lý do dừng
// stage nhóm (`stopFail`), cộng bộ đếm sau mỗi lần gọi (`bump`). Tách khỏi `team-exec`/`team-member`; không log nội dung.
import type { AgentResult } from "@ai/contracts/hub";
import type { JobOutcome } from "../../../runner/job/job-agent-runner";
import { addCall } from "../../runs/team-counters";
import type { TeamDeps } from "../../runs/team-load";
import type { StageResult } from "../../runs/team-runner";
import type { JobFail } from "./job-result";

/** Lý do thành viên lỗi (PB-R17); `not_configured` tách khỏi `agent_failed` (TM-08, gỡ mâu thuẫn readiness #1). */
export type MemberFailReason = "agent_failed" | "job_timeout" | "not_configured";

/** Kết quả chuẩn hoá một lần gọi thành viên. */
export type MemberOutcome =
  | { kind: "output"; text: string }
  | { kind: "need_input"; question: string; choices: string[] }
  | { kind: "failed"; reason: MemberFailReason };

/** `job` · T7b · lỗi job thô (PD-R01) cho thử lại; null ⇒ không có job (chưa cấu hình) hoặc không lỗi. */
export type MemberResult = {
  outcome: MemberOutcome;
  usage: number;
  jobId: string | null;
  job: JobFail | null;
};

/** Kết quả stage nhóm trả cho `stage-driver`. */
export type TeamOut = {
  result: StageResult;
  usage: number;
  jobId: string | null;
  /** T7b · chỉ khi `failed` do thành viên: lỗi job thô + team_run/chỉ số thành viên lỗi (lead ⇒ `-1`). */
  job?: JobFail | null;
  team?: { teamRunId: string; cursor: number } | null;
};

/** Phần của ngữ cảnh stage nhóm mà `stopFail`/`bump` cần (cấu trúc con của `Ctx` ở `team-exec`). */
export type TeamTally = {
  d: TeamDeps;
  teamRunId: string;
  usage: number;
  lastJobId: string | null;
  /** T7b · số lượt gọi kế tiếp KHÔNG đếm `calls` (gọi lại sau hẹn thử lại: 1, parallel: cả lượt). */
  noCount: number;
};

/** Mã job lỗi → reason thành viên (PB-R17): TIMEOUT⇒job_timeout, NOT_CONFIGURED⇒not_configured, còn lại⇒agent_failed. */
export function reasonOfCode(code: string): MemberFailReason {
  if (code === "TIMEOUT") return "job_timeout";
  if (code === "NOT_CONFIGURED") return "not_configured";
  return "agent_failed";
}

export function outcomeOf(o: JobOutcome): MemberOutcome {
  if (o.kind === "aborted") return { kind: "failed", reason: "agent_failed" };
  if (o.kind === "failed") return { kind: "failed", reason: reasonOfCode(o.code) };
  const r = o.output.kind === "agent_result" ? (o.output.result as AgentResult) : null;
  if (!r) return { kind: "failed", reason: "agent_failed" };
  if (r.status === "need_input")
    return { kind: "need_input", question: r.question, choices: r.choices ?? [] };
  return { kind: "output", text: r.text };
}

/**
 * T7b · đếm `n` lượt gọi SẮP chạy vào `calls` của team_run (một câu, trước khi gọi ⇒ lượt lỗi được đếm đúng một lần);
 * lượt gọi lại sau hẹn thử lại (`noCount`) không đếm (PD-R08).
 */
export async function countCalls(st: TeamTally, n: number): Promise<void> {
  const free = Math.min(st.noCount, n);
  st.noCount -= free;
  if (n > free) await addCall(st.d, st.teamRunId, n - free);
}

/** Cộng token/job của lần gọi vào tổng stage. */
export function bump(st: TeamTally, res: MemberResult): void {
  st.usage += res.usage;
  if (res.jobId) st.lastJobId = res.jobId;
}

/**
 * T7b · PD-R08 · KHÔNG đóng team_run ở đây: trả `failed` kèm `job` + `team{teamRunId, cursor}` để tx quy trình quyết
 * (thử lại ⇒ `pauseForRetry`, quyết ⇒ `markFailed` — cùng tx). `cursor` = chỉ số thành viên lỗi; lead lỗi ⇒ `-1`.
 */
export function stopFail(st: TeamTally, res: MemberResult, cursor: number): TeamOut {
  // StageResult.reason là `DecisionReason` ⇒ chỉ `agent_failed`/`job_timeout` (hub.runs thành viên giữ mã thật qua
  // closeMemberRun). `not_configured` của member ⇒ decision `agent_failed` (TM-06/08).
  const reason =
    res.outcome.kind === "failed" && res.outcome.reason === "job_timeout"
      ? "job_timeout"
      : "agent_failed";
  return {
    result: { kind: "failed", reason },
    usage: st.usage,
    jobId: st.lastJobId,
    job: res.job,
    team: { teamRunId: st.teamRunId, cursor },
  };
}
