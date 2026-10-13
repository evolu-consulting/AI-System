// HUB-FR-106 · D5 · D11 · M3 · PF1 · driver stage: chạy job agent (một job vai `agent`) → kiểm template/ngân sách → máy
// trạng thái (plan §3.2) → hiệu ứng (`team-runner.effects`) trong tx quy trình TRƯỚC, `writer.finish` SAU (D11), rồi `kick`
// stage kế. Idempotent theo `stage_runs.current_run_id`. Nhóm ⇒ `team-runner.runTeamStage`.
import type { DecisionReason, ProcessRunStatus } from "@ai/contracts/chat";
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
import { isTerminal, type RunEvent, type RunState, transition } from "../core/process-state.rules";
import { stageGateStatus, stepCountOf } from "../core/step.rules";
import { autofixDecision, stageJobExtras } from "./autofix.repo";
import { commitOutputBlob } from "./output-attachment";
import { defaultSourceBudget } from "./sources.rules";
import {
  auditSourceReads,
  loadStageSourceCtx,
  type StageSourceCtx,
  stageRefsCheck,
} from "./stage-sources";
import { type StageRowIdx, stageRowById, stepsOfSnap } from "./step-persist";
import { runTeamStage } from "./team-exec";
import {
  type ApplyInput,
  effects,
  headOf,
  type Link,
  type RunHead,
  type SnapStage,
  type StageResult,
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
  return {
    kind: "output",
    text: r.text,
    ...(o.kind === "result" && o.sourceReads ? { sourceReads: o.sourceReads } : {}),
  };
}

/** P-b2 R12 · tuỳ chọn job stage: `useSession=false` ⇒ `payload.use_session=false` (vắng ⇒ true như cũ). */
export type StageDriverOpts = { useSession?: boolean };

export function stageDriver(d: Deps, launcher: StageLauncher, o: StageDriverOpts = {}): RunDriver {
  return { start: (ctx) => void drive(d, launcher, ctx, o) };
}

async function drive(
  d: Deps,
  launcher: StageLauncher,
  ctx: RunContext,
  o: StageDriverOpts,
): Promise<void> {
  const log = ctx.log.child({ run_id: ctx.writer.run.id });
  try {
    const link = await linkOf(d, ctx.writer.run.id);
    if (!link?.process_run_id || !link.stage_run_id) return void ctx.writer.abort();
    const {
      result,
      usage,
      jobId,
      jobReason = null,
    } = ctx.direct
      ? await runAgent(d, ctx, link, o)
      : { ...(await runTeamStage(d, ctx, link)), jobReason: null };
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
      jobReason,
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
    if (!head || isTerminal(head.status as ProcessRunStatus)) return [];
    // P-b2 D3 · guard theo STAGE của job (bước song song: run có thể waiting_review vì stage khác).
    const stage = await stageRowById(tx, runId, stageRunId, head.tenant_id);
    if (stage?.status !== "running") return [];
    return toDecision(d, tx, {
      runId,
      tenantId: head.tenant_id,
      idx: stage.stage_idx,
      stageRunId,
      reason: "agent_failed",
    });
  });
  if (events.length > 0) await publishUserEvents(d.redis, events, d.log);
  await d.postThread(runId).catch(() => {});
}

/** §4 · `stage.timeout_s` (60..3600) ⇒ `AgentTask.agent.timeoutS` cho job (P1-25). P-b2 D3 · stage theo `stage_run_id`. */
async function stageTimeout(d: Deps, link: Link): Promise<number | null> {
  if (!link.process_run_id || !link.stage_run_id) return null;
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{
      t: number | null;
    }>(sql`select (r.snapshot->'stages'->(s.stage_idx::int)->>'timeout_s')::int as t
      from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id
      where s.id = ${link.stage_run_id} and r.id = ${link.process_run_id}`),
  );
  return r?.t ? Number(r.t) : null;
}

async function linkOf(d: Deps, hubRunId: string): Promise<Link | null> {
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<Link>(
      sql`select process_run_id, stage_run_id, tenant_id from hub.runs where id = ${hubRunId}`,
    ),
  );
  return r ?? null;
}

/** PB-R10 · P-c1 PC-R05/R11 · `sources`/`autofix` của job stage (`stageJobExtras`, scope system + tenant tường minh). */
const jobExtras = (d: Deps, link: Link) =>
  withHubScope(d.db, { kind: "system" }, (tx) => stageJobExtras(tx, link));

type AgentOut = {
  result: StageResult;
  usage: number;
  jobId: string | null;
  jobReason: string | null;
};

/** N4 · một job vai `agent`; `detail` mang `process_run_id/stage_run_id/role` cho usage (PF4). */
async function runAgent(
  d: Deps,
  ctx: RunContext,
  link: Link,
  opts: StageDriverOpts,
): Promise<AgentOut> {
  if (!ctx.direct)
    return {
      result: { kind: "failed", reason: "agent_failed" },
      usage: 0,
      jobId: null,
      jobReason: null,
    };
  const timeoutS = await stageTimeout(d, link);
  const extras = await jobExtras(d, link);
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
      // K1 §3.4 bước 0 · job stage ⇒ KH của job (`kh-query`).
      ...(link.stage_run_id ? { stageRunId: link.stage_run_id } : {}),
      ...(opts.useSession === false ? { useSession: false } : {}),
      ...extras,
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
    jobReason: o.kind === "failed" ? (o.reason ?? o.code) : null,
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

type Applied = Awaited<ReturnType<typeof effects>>;
type Loaded = { head: RunHead; stage: StageRowIdx; def: SnapStage; srcCtx: StageSourceCtx };

/** D11 · tx quy trình (scope system, RLS T): khoá run, máy trạng thái + hiệu ứng (chỉ DB). Null ⇒ bỏ (đua/kết thúc đã commit). */
async function runApplyTx(d: Deps, x: ApplyInput): Promise<Applied | null> {
  return withHubScope(d.db, { kind: "system" }, async (tx) => {
    const l = await lockAndLoad(tx, x);
    if (!l) return null;
    const { head, stage, def, srcCtx } = l;
    const idx = stage.stage_idx;
    await tx.execute(sql`update hub.process_runs set tokens_total = tokens_total + ${x.tokens}
      where id = ${x.runId}`);
    const ev = await eventFor(tx, x, { head, def, srcCtx });
    const t = transition(buildState(head, stage, def), ev);
    if (!t.ok) return null;
    // PB-R11 · audit nguồn đã đọc (append-only) khi stage ra output — độc lập template_ok.
    if (x.result.kind === "output" && x.result.sourceReads?.length)
      await auditSourceReads(
        tx,
        { runId: x.runId, stageRunId: x.stageRunId, jobId: x.jobId, tenantId: head.tenant_id },
        x.result.sourceReads,
        srcCtx,
      );
    const ctx = { x, head, stage, def, idx, ev, next: t.next, list: t.effects, srcCtx };
    const res = await effects(d, tx, ctx);
    const recipients = await core.runRecipients(tx, x.runId, head.tenant_id);
    const st = res.step;
    if (st)
      res.events.push(
        ...processUpdated(recipients, {
          id: x.runId,
          status: st.status,
          stageIdx: st.stageIdx,
          step: st.step,
        }),
      );
    return res;
  });
}

/**
 * §10/D11 · khoá `process_runs` FOR UPDATE TRƯỚC mọi đọc/ghi: job hoàn tất tự nhiên đua với huỷ (gates) hoặc hết hạn
 * (sweep) phải chờ tx kia commit rồi đọc lại — không hồi sinh run. P-b2 D3 · `idx` theo `x.stageRunId`; run không kết
 * thúc ∧ `current_run_id` = run này (đua với quay lại/huỷ ⇒ bỏ).
 */
async function lockAndLoad(tx: Tx, x: ApplyInput): Promise<Loaded | null> {
  const head0 = await headOf(tx, x.runId);
  if (!head0 || !(await core.lockRun(tx, head0.tenant_id, x.runId))) return null;
  const head = await headOf(tx, x.runId);
  if (!head || isTerminal(head.status as ProcessRunStatus)) return null;
  const stage = await stageRowById(tx, x.runId, x.stageRunId, head.tenant_id);
  if (!stage || stage.current_run_id !== x.hubRunId) return null;
  const def = head.snapshot.stages[stage.stage_idx];
  if (!def) return null;
  return { head, stage, def, srcCtx: await loadStageSourceCtx(tx, x.runId, stage.stage_idx) };
}

/** Ngữ cảnh stage đã nạp cho đánh giá kết quả job. */
type EvalCtx = Pick<Loaded, "head" | "def" | "srcCtx">;

/**
 * PC-R10 · thứ tự: limit (huỷ/ngắt) → lỗi job (stage thường) → ngân sách token → (stage tự-sửa, output/lỗi job) báo cáo
 * + lý do lỗi job ⇒ "Cần người quyết" → need_input → template.
 */
async function eventFor(tx: Tx, x: ApplyInput, c: EvalCtx): Promise<RunEvent> {
  const { def, srcCtx } = c;
  if (x.result.kind === "limit") return { kind: "limit", reason: x.result.reason };
  if (x.result.kind === "failed" && !def.autofix) return { kind: "limit", reason: x.result.reason };
  const over = await budgetReason(tx, x, c);
  if (over) return { kind: "limit", reason: over };
  if (def.autofix && x.result.kind !== "need_input") {
    const jobReason = x.result.kind === "failed" ? (x.jobReason ?? x.result.reason) : null;
    const why = await autofixDecision(tx, {
      jobId: x.jobId,
      tenantId: c.head.tenant_id,
      jobReason,
    });
    if (why) return { kind: "limit", reason: why };
  }
  if (x.result.kind === "failed") return { kind: "limit", reason: x.result.reason };
  if (x.result.kind === "need_input") return { kind: "need_input" };
  const ok = checkTemplate(
    { requiredSections: def.output.required_sections, fields: def.output.fields as never },
    x.result.text,
  );
  return { kind: "stage_output", templateOk: ok.ok && refsOk(x, srcCtx) };
}

/** PB-R09/C16 · stage có nguồn ⇒ output phải có `## Nguồn tham chiếu` (key∈stage, @version khớp pin, path∈files_read). */
function refsOk(x: ApplyInput, srcCtx: StageSourceCtx): boolean {
  if (x.result.kind !== "output") return true;
  return stageRefsCheck(srcCtx, x.result.text, x.result.sourceReads).ok;
}

async function budgetReason(
  tx: Tx,
  x: ApplyInput,
  { head, def, srcCtx }: EvalCtx,
): Promise<DecisionReason | null> {
  const [row] = await tx.execute<{ stage_sum: number; run_sum: number }>(sql`
    select coalesce(sum(case when r.stage_run_id = ${x.stageRunId} then ul.input_tokens + ul.output_tokens
        + coalesce(ul.cache_read_tokens, 0) + coalesce(ul.cache_write_tokens, 0) end), 0)::int as stage_sum,
      coalesce(sum(ul.input_tokens + ul.output_tokens
        + coalesce(ul.cache_read_tokens, 0) + coalesce(ul.cache_write_tokens, 0)), 0)::int as run_sum
    from hub.usage_logs ul join hub.runs r on r.id = ul.run_id and r.tenant_id = ul.tenant_id
    where r.process_run_id = ${x.runId}`);
  // PB-R12/C17 · stage có nguồn không đặt budget ⇒ trần 200000; không nguồn ⇒ giữ P-a.
  // P-c1 · PC-R13 · stage tự-sửa luôn có nguồn (workspace) ⇒ cũng trần 200000 khi không đặt.
  const stageBudget = defaultSourceBudget(
    { token_budget: def.token_budget },
    srcCtx.stageSources.length > 0 || Boolean(def.autofix),
  );
  if (budgetHit(Number(row?.stage_sum ?? 0), stageBudget)) return "stage_tokens";
  if (budgetHit(Number(row?.run_sum ?? 0), head.snapshot.token_budget)) return "run_tokens";
  return null;
}

/** D1 · `transition` một stage: trạng thái "run" dựng từ trạng thái stage; stageIdx/stageCount = bước/tổng bước. */
function buildState(head: RunHead, stage: StageRowIdx, def: SnapStage): RunState {
  const steps = stepsOfSnap(head.snapshot);
  return {
    status: stageGateStatus(head.status as ProcessRunStatus, stage.status),
    stageIdx: steps[stage.stage_idx] ?? stage.stage_idx,
    stageCount: stepCountOf(steps),
    stage: {
      status: stage.status,
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
