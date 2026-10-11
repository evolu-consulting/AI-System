// HUB-FR-106 · D5 · D11 · M3 · PF1 · driver stage: chạy job agent (một job vai `agent`) → kiểm template/ngân sách → máy
// trạng thái (plan §3.2) → hiệu ứng (`team-runner.effects`) trong tx quy trình TRƯỚC, `writer.finish` SAU (D11), rồi `kick`
// stage kế. Idempotent theo `stage_runs.current_run_id`. Nhóm ⇒ `team-runner.runTeamStage`.
import type { DecisionReason } from "@ai/contracts/chat";
import type { AgentResult, TokenUsage } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import { type JobOutcome, runJob } from "../../runner/job/job-agent-runner";
import type { RunContext, RunDriver } from "../../runs/runs.service";
import type { RunOutcome } from "../../runs/sse/sse-writer";
import * as core from "../core/core.repo";
import { processUpdated } from "../core/events";
import { budgetHit, totalTokens } from "../core/limits.rules";
import type { ProcessDeps, StageLauncher } from "../core/ports";
import { type RunEvent, type RunState, transition } from "../core/process-state.rules";
import { commitOutputBlob } from "./output-attachment";
import { runTeamStage } from "./team-exec";
import {
  type ApplyInput,
  effects,
  headOf,
  type Link,
  type RunHead,
  type SnapStage,
  type StageResult,
  type StageRow,
  stageRowOf,
  toDecision,
} from "./team-runner";
import { checkTemplate } from "./template.rules";

type Deps = Omit<ProcessDeps, "launcher" | "start">;
type Usage = { cache_read_tokens?: number; cache_write_tokens?: number } & TokenUsage;

export const tokensOf = (u: TokenUsage): number =>
  totalTokens({
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: (u as Usage).cache_read_tokens ?? null,
    cacheWrite: (u as Usage).cache_write_tokens ?? null,
  });

function resultOf(o: JobOutcome): StageResult {
  // D11 · `aborted` = AbortSignal (huỷ run stage `/runs/:id/cancel` hoặc tắt instance), không phải lỗi agent ⇒ interrupted.
  if (o.kind === "aborted") return { kind: "limit", reason: "interrupted" };
  if (o.kind === "failed")
    return { kind: "failed", reason: o.code === "TIMEOUT" ? "job_timeout" : "agent_failed" };
  const r = o.output.kind === "agent_result" ? (o.output.result as AgentResult) : null;
  if (!r) return { kind: "failed", reason: "agent_failed" };
  if (r.status === "need_input")
    return { kind: "need_input", question: r.question, choices: r.choices ?? [] };
  return { kind: "output", text: r.text };
}

export function stageDriver(d: Deps, launcher: StageLauncher): RunDriver {
  return { start: (ctx) => void drive(d, launcher, ctx) };
}

async function drive(d: Deps, launcher: StageLauncher, ctx: RunContext): Promise<void> {
  const log = ctx.log.child({ run_id: ctx.writer.run.id });
  try {
    const link = await linkOf(d, ctx.writer.run.id);
    if (!link?.process_run_id || !link.stage_run_id) return void ctx.writer.abort();
    const { result, usage, jobId } = ctx.direct
      ? await runAgent(d, ctx, link)
      : await runTeamStage(d, ctx, link);
    // D11/P1-37 · `need_input` ⇒ đóng `hub.runs` TRƯỚC khi commit `waiting_answer` (người đọc không thấy cửa sổ
    // `running`); output/failed giữ thứ tự D11 (tx quy trình trước, `finish` sau) rồi `kick` stage kế.
    const needInput = result.kind === "need_input";
    if (needInput) await finish(ctx, result);
    const kick = await apply(d, {
      runId: link.process_run_id,
      stageRunId: link.stage_run_id,
      hubRunId: ctx.writer.run.id,
      jobId,
      result,
      tokens: usage,
    });
    if (!needInput) await finish(ctx, result);
    if (kick) await launcher.kick(link.process_run_id);
  } catch (err) {
    log.error("process-stage-failed", safeErrorFields(err));
    if (!ctx.writer.done) ctx.writer.abort();
    // #134 · mạng an toàn: lỗi bất ngờ trong drive (sau khi đã sửa closeMemberRun) KHÔNG được để `process_runs` kẹt
    // `running` ⇒ chuyển `needs_decision(agent_failed)`. Không ném tiếp (tránh unhandledRejection — TM-11).
    await failStuckRun(d, ctx.writer.run.id).catch((e) =>
      log.error("process-stuck-decision-failed", safeErrorFields(e)),
    );
  }
}

/** #134 · nếu run quy trình còn `running` (stage-driver ném trước khi apply) ⇒ `toDecision(agent_failed)` (không kẹt). */
async function failStuckRun(d: Deps, hubRunId: string): Promise<void> {
  const link = await linkOf(d, hubRunId);
  if (!link?.process_run_id || !link.stage_run_id) return;
  const runId = link.process_run_id;
  const stageRunId = link.stage_run_id;
  const events = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const head = await headOf(tx, runId);
    if (head?.status !== "running") return [];
    return toDecision(d, tx, {
      runId,
      tenantId: head.tenant_id,
      idx: Number(head.current_stage_idx),
      stageRunId,
      reason: "agent_failed",
    });
  });
  if (events.length > 0) await publishUserEvents(d.redis, events, d.log);
  await d.postThread(runId).catch(() => {});
}

/** §4 · `stage.timeout_s` (60..3600) ⇒ `AgentTask.agent.timeoutS` cho job (P1-25). */
async function stageTimeout(d: Deps, runId: string | null): Promise<number | null> {
  if (!runId) return null;
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{
      t: number | null;
    }>(sql`select (snapshot->'stages'->(current_stage_idx::int)->>'timeout_s')::int
      as t from hub.process_runs where id = ${runId}`),
  );
  return r?.t ? Number(r.t) : null;
}

async function linkOf(d: Deps, hubRunId: string): Promise<Link | null> {
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<Link>(sql`select process_run_id, stage_run_id from hub.runs where id = ${hubRunId}`),
  );
  return r ?? null;
}

/** N4 · một job vai `agent`; `detail` mang `process_run_id/stage_run_id/role` cho usage (PF4). */
async function runAgent(
  d: Deps,
  ctx: RunContext,
  link: Link,
): Promise<{ result: StageResult; usage: number; jobId: string | null }> {
  if (!ctx.direct)
    return { result: { kind: "failed", reason: "agent_failed" }, usage: 0, jobId: null };
  const timeoutS = await stageTimeout(d, link.process_run_id);
  const o = await runJob(
    d.runner,
    {
      run: ctx.writer.run,
      snapshot: ctx.snapshot,
      agent: timeoutS ? { ...ctx.direct.agent, timeoutS } : ctx.direct.agent,
      role: "agent",
      prompt: ctx.content,
      history: [],
      files: ctx.files,
      detail: {
        process_run_id: link.process_run_id,
        stage_run_id: link.stage_run_id,
        team_run_id: null,
        member_key: null,
        role: "agent",
      },
    },
    ctx.writer.signal,
    ctx.log,
  );
  return {
    result: resultOf(o),
    usage: o.kind === "aborted" ? 0 : tokensOf(o.usage),
    jobId: o.kind === "aborted" ? null : o.jobId || null,
  };
}

/** D11 · tx quy trình → ghi blob SAU COMMIT → phát sự kiện/thread. Trả `true` nếu cần `kick`. */
async function apply(d: Deps, x: ApplyInput): Promise<boolean> {
  const out = await runApplyTx(d, x);
  if (!out) return false;
  // CR-056/RV2 #1 · blob ghi NGOÀI tx (callback `withHubScope` có thể chạy lại khi 40001/40P01) + phải sẵn trên kho TRƯỚC
  // khi báo output (thread/SSE) ⇒ `commitOutputBlob` sau COMMIT, trước publish.
  for (const p of out.pending) await commitOutputBlob(d, p);
  await publishUserEvents(d.redis, out.events, d.log);
  await d.postThread(x.runId).catch(() => {});
  return out.kick;
}

/** D11 · tx quy trình (scope system, RLS T): khoá run, máy trạng thái + hiệu ứng (chỉ DB). Null ⇒ bỏ (đua/kết thúc đã commit). */
async function runApplyTx(
  d: Deps,
  x: ApplyInput,
): Promise<Awaited<ReturnType<typeof effects>> | null> {
  return withHubScope(d.db, { kind: "system" }, async (tx) => {
    // §10/D11 · khoá `process_runs` FOR UPDATE TRƯỚC mọi đọc/ghi: job hoàn tất tự nhiên đua với huỷ (gates) hoặc hết
    // hạn (sweep) phải chờ tx kia commit rồi đọc lại — không ghi đè trạng thái kết thúc đã commit (hồi sinh run).
    const head0 = await headOf(tx, x.runId);
    if (!head0) return null;
    if (!(await core.lockRun(tx, head0.tenant_id, x.runId))) return null;
    const head = await headOf(tx, x.runId);
    if (head?.status !== "running") return null;
    const idx = Number(head.current_stage_idx);
    const stage = await stageRowOf(tx, x.runId, idx);
    if (!stage || stage.current_run_id !== x.hubRunId) return null;
    const def = head.snapshot.stages[idx];
    if (!def) return null;
    await tx.execute(sql`update hub.process_runs set tokens_total = tokens_total + ${x.tokens}
      where id = ${x.runId}`);
    const ev = await eventFor(tx, x, head, def);
    const t = transition(buildState(head, stage, def, idx), ev);
    if (!t.ok) return null;
    const res = await effects(d, tx, {
      x,
      head,
      stage,
      def,
      idx,
      ev,
      next: t.next,
      list: t.effects,
    });
    const recipients = await core.runRecipients(tx, x.runId, head.tenant_id);
    res.events.push(
      ...processUpdated(recipients, {
        id: x.runId,
        status: t.next.status,
        stageIdx: t.next.stageIdx,
      }),
    );
    return res;
  });
}

async function eventFor(tx: Tx, x: ApplyInput, head: RunHead, def: SnapStage): Promise<RunEvent> {
  if (x.result.kind === "failed") return { kind: "limit", reason: x.result.reason };
  if (x.result.kind === "limit") return { kind: "limit", reason: x.result.reason };
  const over = await budgetReason(tx, x, head, def);
  if (over) return { kind: "limit", reason: over };
  if (x.result.kind === "need_input") return { kind: "need_input" };
  const ok = checkTemplate(
    { requiredSections: def.output.required_sections, fields: def.output.fields as never },
    x.result.text,
  );
  return { kind: "stage_output", templateOk: ok.ok };
}

async function budgetReason(
  tx: Tx,
  x: ApplyInput,
  head: RunHead,
  def: SnapStage,
): Promise<DecisionReason | null> {
  const [row] = await tx.execute<{ stage_sum: number; run_sum: number }>(sql`
    select coalesce(sum(case when r.stage_run_id = ${x.stageRunId} then ul.input_tokens + ul.output_tokens
        + coalesce(ul.cache_read_tokens, 0) + coalesce(ul.cache_write_tokens, 0) end), 0)::int as stage_sum,
      coalesce(sum(ul.input_tokens + ul.output_tokens
        + coalesce(ul.cache_read_tokens, 0) + coalesce(ul.cache_write_tokens, 0)), 0)::int as run_sum
    from hub.usage_logs ul join hub.runs r on r.id = ul.run_id and r.tenant_id = ul.tenant_id
    where r.process_run_id = ${x.runId}`);
  if (budgetHit(Number(row?.stage_sum ?? 0), def.token_budget)) return "stage_tokens";
  if (budgetHit(Number(row?.run_sum ?? 0), head.snapshot.token_budget)) return "run_tokens";
  return null;
}

function buildState(head: RunHead, stage: StageRow, def: SnapStage, idx: number): RunState {
  return {
    status: "running",
    stageIdx: idx,
    stageCount: head.snapshot.stages.length,
    stage: {
      status: "running",
      attempt: Number(stage.attempt),
      attemptLimit: Number(stage.attempt_limit),
      asksCount: Number(stage.asks_count),
      askLimit: Number(stage.ask_limit),
      after: def.after.kind,
      hasOutput: stage.current_output_id !== null,
      realAction: def.real_action === true,
    },
    decisionReason: null,
  };
}

/** D11 · đóng `hub.runs` stage SAU tx quy trình. */
async function finish(ctx: RunContext, result: StageResult): Promise<void> {
  if (ctx.writer.done) return;
  await ctx.writer.finishOrAbort(outcomeOf(result));
}

function outcomeOf(result: StageResult): RunOutcome {
  if (result.kind === "failed")
    return { kind: "failed", code: result.reason === "job_timeout" ? "TIMEOUT" : "INTERNAL_ERROR" };
  if (result.kind === "output") return { kind: "finished", content: result.text };
  if (result.kind === "need_input") return { kind: "finished", content: result.question };
  return { kind: "finished", content: "" };
}
