// HUB-FR-114 · N4 · D7 · C2 · PF1 · chạy một job thành viên nhóm: tạo `hub.runs` (người bắt đầu, KHÔNG kiểm grant —
// `skipGrant`), gắn `team_run_id` + file nháp, `runJob` (role `member`), đóng run nền. Không SSE (run nền của nhóm).
import type { AgentResult, TokenUsage } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { RunFile } from "../../attachments/run-files.rules";
import { type JobOutcome, runJob } from "../../runner/job/job-agent-runner";
import { runErrorText } from "../../runs/run-errors";
import { totalTokens } from "../core/limits.rules";
import { mapTeamError } from "./sources.rules";
import type { TeamDeps as Deps } from "./team-load";

type Usage = { cache_read_tokens?: number; cache_write_tokens?: number } & TokenUsage;
const tokensOf = (u: TokenUsage): number =>
  totalTokens({
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: (u as Usage).cache_read_tokens ?? null,
    cacheWrite: (u as Usage).cache_write_tokens ?? null,
  });

/** Lý do thành viên lỗi (PB-R17); `not_configured` tách khỏi `agent_failed` (TM-08, gỡ mâu thuẫn readiness #1). */
export type MemberFailReason = "agent_failed" | "job_timeout" | "not_configured";

/** Kết quả chuẩn hoá một lần gọi thành viên. */
export type MemberOutcome =
  | { kind: "output"; text: string }
  | { kind: "need_input"; question: string; choices: string[] }
  | { kind: "failed"; reason: MemberFailReason };

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

export type MemberResult = { outcome: MemberOutcome; usage: number; jobId: string | null };

/** Mã job lỗi → reason thành viên (PB-R17): TIMEOUT⇒job_timeout, NOT_CONFIGURED⇒not_configured, còn lại⇒agent_failed. */
function reasonOfCode(code: string): MemberFailReason {
  if (code === "TIMEOUT") return "job_timeout";
  if (code === "NOT_CONFIGURED") return "not_configured";
  return "agent_failed";
}

function outcomeOf(o: JobOutcome): MemberOutcome {
  if (o.kind === "aborted") return { kind: "failed", reason: "agent_failed" };
  if (o.kind === "failed") return { kind: "failed", reason: reasonOfCode(o.code) };
  const r = o.output.kind === "agent_result" ? (o.output.result as AgentResult) : null;
  if (!r) return { kind: "failed", reason: "agent_failed" };
  if (r.status === "need_input")
    return { kind: "need_input", question: r.question, choices: r.choices ?? [] };
  return { kind: "output", text: r.text };
}

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
    return { outcome: { kind: "failed", reason: "not_configured" }, usage: 0, jobId: null };
  }
  if (!prepared.direct)
    return { outcome: { kind: "failed", reason: "not_configured" }, usage: 0, jobId: null };
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
  };
  const o = await runJob(d.runner, task, m.signal, d.log);
  const outcome = outcomeOf(o);
  await closeMemberRun(d, prepared.run.id, outcome);
  return {
    outcome,
    usage: o.kind === "aborted" ? 0 : tokensOf(o.usage),
    jobId: o.kind === "aborted" ? null : o.jobId || null,
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
