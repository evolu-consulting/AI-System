// HUB-FR-114 · N4 · D7 · C2 · PF1 · chạy một job thành viên nhóm: tạo `hub.runs` (người bắt đầu, KHÔNG kiểm grant —
// `skipGrant`), gắn `team_run_id` + file nháp, `runJob` (role `member`), đóng run nền. Không SSE (run nền của nhóm).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { RunFile } from "../../attachments/run-files.rules";
import { runJob } from "../../runner/job/job-agent-runner";
import { runErrorText } from "../../runs/run-errors";
import { jobFailOf, tokensOf } from "../adapters/runs/job-result";
import { type MemberOutcome, type MemberResult, outcomeOf } from "../adapters/runs/team-failure";
import { mapTeamError } from "./sources.rules";
import type { TeamDeps as Deps } from "./team-load";

export type MemberCall = {
  u: AuthUser;
  conversationId: string;
  processRunId: string;
  stageRunId: string;
  teamRunId: string;
  agentId: string;
  memberKey: string;
  role: "member" | "plan";
  prompt: string;
  files: RunFile[];
  fallback: boolean;
  signal: AbortSignal;
};

const detailOf = (m: MemberCall) => ({
  process_run_id: m.processRunId,
  stage_run_id: m.stageRunId,
  team_run_id: m.teamRunId,
  member_key: m.memberKey,
  role: m.role,
  ...(m.fallback && { plan_fallback: true }),
});
const process = (m: MemberCall) => ({
  processRunId: m.processRunId,
  stageRunId: m.stageRunId,
  teamRunId: m.teamRunId,
  files: m.files,
});

const NOT_CONFIGURED: MemberOutcome = { kind: "failed", reason: "not_configured" };

/** Tạo run nền thành viên + chạy job + đóng run. */
export async function runMember(d: Deps, m: MemberCall): Promise<MemberResult> {
  const prep = {
    conversationId: m.conversationId,
    req: { content: m.prompt },
    stage: { executor: { kind: "agent" as const, agentId: m.agentId }, process: process(m) },
  };
  // #134 · agent không cấu hình được (mất khỏi ảnh ⇒ AGENT_NOT_FOUND, hoặc `!direct`) ⇒ `not_configured`, KHÔNG ném
  // (ném sẽ bong qua stage-driver ⇒ run kẹt `running`). Không có `hub.runs` để đóng (chưa tạo) ⇒ trả thẳng.
  let prepared: Awaited<ReturnType<Deps["runs"]["prepareProcess"]>>;
  try {
    prepared = await d.runs.prepareProcess(m.u, prep, { skipGrant: true });
  } catch {
    return { outcome: NOT_CONFIGURED, usage: 0, jobId: null, job: null };
  }
  if (!prepared.direct) return { outcome: NOT_CONFIGURED, usage: 0, jobId: null, job: null };
  await withHubScope(d.db, { kind: "user", ...m.u }, (tx) => d.runs.createRunTx(tx, prepared));
  const task = {
    run: prepared.run,
    snapshot: prepared.snapshot,
    agent: prepared.direct.agent,
    role: "agent" as const,
    prompt: m.prompt,
    history: [],
    files: m.files,
    detail: detailOf(m),
    // K1 §3.4 bước 0 · mọi job nhóm (kể cả `plan` của trưởng nhóm) dùng chung 5 lần của stage.
    stageRunId: m.stageRunId,
  };
  const o = await runJob(d.runner, task, m.signal, d.log);
  const outcome = outcomeOf(o);
  await closeMemberRun(d, prepared.run.id, outcome);
  return {
    outcome,
    usage: o.kind === "aborted" ? 0 : tokensOf(o.usage),
    jobId: o.kind === "aborted" ? null : o.jobId || null,
    // T7b · lỗi job thô chỉ khi thành viên lỗi (output không đọc được ⇒ `agent_failed`, không thử lại — như agent đơn).
    job: outcome.kind === "failed" ? jobFailOf(o) : null,
  };
}

/**
 * #134 · PB-R17 · đóng `hub.runs` nền của thành viên (không SSE); scope system. Lỗi ⇒ set `error_code` (mapTeamError) +
 * `error_message`/`error_hint` (non-null, `runs_error_cols_ck`) để KHÔNG vi phạm `runs_error_code_ck` (trước đây set
 * `status='failed'` mà thiếu `error_code` ⇒ UPDATE ném ⇒ run kẹt `running`). Thành công ⇒ `finished` (error_code NULL).
 */
async function closeMemberRun(d: Deps, runId: string, outcome: MemberOutcome): Promise<void> {
  if (outcome.kind !== "failed") {
    await withHubScope(d.db, { kind: "system" }, (tx) =>
      tx.execute(sql`update hub.runs set status = 'finished', finished_at = now(),
        owner = null, lease_until = null where id = ${runId} and status = 'running'`),
    );
    return;
  }
  const code = mapTeamError(outcome.reason);
  const t = runErrorText(code, "vi");
  await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute(sql`update hub.runs set status = 'failed', error_code = ${code},
      error_message = ${t.message}, error_hint = ${t.hint}, finished_at = now(),
      owner = null, lease_until = null where id = ${runId} and status = 'running'`),
  );
}
