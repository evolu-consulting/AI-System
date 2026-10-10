// HUB-FR-114 · N4 · D7 · C2 · PF1 · chạy một job thành viên nhóm: tạo `hub.runs` (người bắt đầu, KHÔNG kiểm grant —
// `skipGrant`), gắn `team_run_id` + file nháp, `runJob` (role `member`), đóng run nền. Không SSE (run nền của nhóm).
import type { AgentResult, TokenUsage } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { RunFile } from "../../attachments/run-files.rules";
import { type JobOutcome, runJob } from "../../runner/job/job-agent-runner";
import { totalTokens } from "../core/limits.rules";
import type { TeamDeps as Deps } from "./team-load";

type Usage = { cache_read_tokens?: number; cache_write_tokens?: number } & TokenUsage;
const tokensOf = (u: TokenUsage): number =>
  totalTokens({
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: (u as Usage).cache_read_tokens ?? null,
    cacheWrite: (u as Usage).cache_write_tokens ?? null,
  });

/** Kết quả chuẩn hoá một lần gọi thành viên. */
export type MemberOutcome =
  | { kind: "output"; text: string }
  | { kind: "need_input"; question: string; choices: string[] }
  | { kind: "failed"; reason: "agent_failed" | "job_timeout" };

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

function outcomeOf(o: JobOutcome): MemberOutcome {
  if (o.kind === "aborted") return { kind: "failed", reason: "agent_failed" };
  if (o.kind === "failed")
    return { kind: "failed", reason: o.code === "TIMEOUT" ? "job_timeout" : "agent_failed" };
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
  const prepared = await d.runs.prepareProcess(m.u, prep, { skipGrant: true });
  if (!prepared.direct)
    return { outcome: { kind: "failed", reason: "agent_failed" }, usage: 0, jobId: null };
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
  await closeMemberRun(d, prepared.run.id, outcome.kind === "failed");
  return {
    outcome,
    usage: o.kind === "aborted" ? 0 : tokensOf(o.usage),
    jobId: o.kind === "aborted" ? null : o.jobId || null,
  };
}

/** Đóng `hub.runs` nền của thành viên (không SSE); scope system. */
async function closeMemberRun(d: Deps, runId: string, failed: boolean): Promise<void> {
  await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute(sql`update hub.runs set status = ${failed ? "failed" : "finished"},
      finished_at = now(), owner = null, lease_until = null where id = ${runId} and status = 'running'`),
  );
}
