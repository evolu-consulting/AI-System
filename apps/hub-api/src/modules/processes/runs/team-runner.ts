// HUB-FR-106 · HUB-FR-114 · D5 · D7 · D8 · PF1 · (1) hiệu ứng máy trạng thái stage (ghi `process_outputs`/task/thread +
// `notifier`, persist trạng thái) dùng chung cho agent đơn + nhóm; (2) chạy stage nhóm. Tách khỏi `stage-driver.ts` cho
// giới hạn 400 dòng (một chiều `stage-driver` → `team-runner`, không ngược).

import type { DecisionOption, DecisionReason } from "@ai/contracts/chat";
import type { JobSourceRead } from "@ai/contracts/hub";
import type { StageSource } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import type { ProcessDeps } from "../core/ports";
import { askExcerpt, decisionAssignees, decisionOptionsFor } from "../core/task.rules";
import { enqueueThread } from "../core/thread";
import type { Effect, RunEvent, RunState } from "../domain/runs/run-state.rules";
import { executorRefOf } from "./executor-ref";
import { outputAttachment, type PendingBlob } from "./output-attachment";
import { refsFeedback, type StageSourceCtx, stageRefsCheck } from "./stage-sources";
import { persistStage, type StepOutcome, stageDoneOf } from "./step-persist";
import { outputSteps, outputStepsSingle } from "./team-load";
import { checkTemplate } from "./template.rules";

export type Deps = Omit<ProcessDeps, "launcher" | "start">;
export type Link = {
  process_run_id: string | null;
  stage_run_id: string | null;
  tenant_id: string;
};

/** Kết quả thực thi stage (agent đơn / nhóm) chuẩn hoá cho máy trạng thái. */
export type StageResult =
  | {
      kind: "output";
      text: string;
      sections?: Record<string, string>;
      summaries?: Record<string, string>;
      sourceReads?: readonly JobSourceRead[]; // P-b C18 · từ `job.result.source_reads`
    }
  | { kind: "need_input"; question: string; choices: string[] }
  | { kind: "limit"; reason: DecisionReason }
  | { kind: "failed"; reason: "agent_failed" | "job_timeout" };

export type SnapStage = {
  name: string;
  step?: number; // P-b2 · vắng (def cũ) ⇒ mỗi stage một bước
  executor:
    | { kind: "agent"; agent_id: string }
    | { kind: "team"; team_id: string }
    | { kind: "apply" };
  output: {
    filename: string;
    template: string;
    required_sections: string[];
    fields: { key: string; type: string; required: boolean }[];
  };
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
  /** D4 · HUB-FR-109 · stage "Hành động thật" (chèn sẵn tool_confirmations; need_input ⇒ needs_decision). */
  real_action?: boolean;
  answerer:
    | { kind: "starter" }
    | { kind: "group"; group_id: string }
    | { kind: "user"; user_id: string };
  token_budget: number | null;
  sources?: StageSource[]; // P-b · nguồn + checklist stage (vắng ⇒ P-a)
  must_know?: string[];
  autofix?: { source_key: string } | null; // P-c1 · stage tự-sửa (vắng/null ⇒ stage thường)
};
export type RunHead = {
  tenant_id: string;
  started_by: string;
  status: string;
  current_stage_idx: number;
  input: string;
  snapshot: { stages: SnapStage[]; token_budget: number | null };
};
export type StageRow = {
  id: string;
  status: string;
  attempt: number;
  attempt_limit: number;
  asks_count: number;
  ask_limit: number;
  current_output_id: string | null;
  current_run_id: string | null;
};
export type ApplyInput = {
  runId: string;
  stageRunId: string;
  hubRunId: string;
  /** D5 · job cuối của stage (gán `attachments.job_id` cho output); null ⇒ tra job gần nhất của run. */
  jobId: string | null;
  result: StageResult;
  tokens: number;
  /** P-c1 · PC-R10 · `hub.jobs.error_reason` khi job lỗi (vd `container`); vắng ⇒ không biết. */
  jobReason?: string | null;
  /** T7 · lỗi job thô của stage agent (PD-R01); vắng/null ⇒ không thử lại (luồng cũ). */
  job?: { code: string | null; reason: string | null; interrupted: boolean } | null;
};
export type Ctx = {
  x: ApplyInput;
  head: RunHead;
  stage: StageRow;
  def: SnapStage;
  idx: number;
  ev: RunEvent;
  next: RunState;
  list: readonly Effect[];
  srcCtx?: StageSourceCtx; // P-b · kiểm `## Nguồn tham chiếu` cho `template_ok`
};

const missingArray = (missing: readonly string[]) =>
  missing.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        missing.map((m) => sql`${m}`),
        sql`, `,
      )}]::text[]`;

/**
 * Hiệu ứng máy trạng thái trong tx quy trình; trả sự kiện phát sau COMMIT + có cần `kick` không + blob output chờ ghi
 * (`pending`) để người gọi `commitOutputBlob` SAU COMMIT tx — PHẢI trước khi phát thread/SSE (CR-056, H2c-R05). CHỈ làm việc
 * DB (callback `withHubScope` có thể chạy lại); không chạm kho ở đây.
 */
export async function effects(
  d: Deps,
  tx: Tx,
  c: Ctx,
): Promise<{
  events: UserEvent[];
  kick: boolean;
  pending: PendingBlob[];
  step: StepOutcome | null;
}> {
  const events: UserEvent[] = [];
  const w = c.ev.kind === "stage_output" ? await writeOutput(d, tx, c) : null;
  const out = w?.out ?? null;
  const reviewTaskId = await dispatchEffects(d, tx, c, { out, events });
  // P-b2 §3.3 · stage xong ⇒ done + join bước (step-persist); `finish_run` chỉ khi CẢ bước cuối xong.
  const done = stageDoneOf(c.list);
  const step = await persistStage(tx, {
    runId: c.x.runId,
    tenantId: c.head.tenant_id,
    stageRunId: c.x.stageRunId,
    next: c.next,
    done,
    outputId: out?.id ?? null,
  });
  if (out) await threadOutput(tx, c, out, reviewTaskId);
  if (step?.kind === "finish") {
    events.push(...(await d.notifier.runFinished(tx, c.x.runId)));
    await threadRunEnd(tx, c);
  }
  return {
    events,
    kick: c.list.includes("queue_stage") || step?.kind === "next_step",
    pending: w?.pending ? [w.pending] : [],
    step,
  };
}

/** Chạy danh sách hiệu ứng (`c.list`): mở review/ask/decision, kết thúc run; gom `UserEvent` vào `events`, trả `reviewTaskId`. */
async function dispatchEffects(
  d: Deps,
  tx: Tx,
  c: Ctx,
  { out, events }: { out: OutRow | null; events: UserEvent[] },
): Promise<string | null> {
  let reviewTaskId: string | null = null;
  for (const eff of c.list) {
    if (eff === "open_review") {
      const r = await openReview(d, tx, c, out?.id ?? null);
      reviewTaskId = r.taskId;
      events.push(...r.events);
    } else if (eff === "open_ask") events.push(...(await openAsk(d, tx, c)));
    else if (eff === "open_decision") events.push(...(await openDecision(d, tx, c)));
  }
  return reviewTaskId;
}

type OutRow = { id: string; version: number; ok: boolean; missing: string[] };
type WriteOutput = { out: OutRow; pending: PendingBlob | null };
async function writeOutput(d: Deps, tx: Tx, c: Ctx): Promise<WriteOutput> {
  const r = c.x.result as { text: string; sections?: Record<string, string>; summaries?: unknown };
  const text = r.text;
  const chk = checkTemplate(
    { requiredSections: c.def.output.required_sections, fields: c.def.output.fields as never },
    text,
  );
  // PB-R09 · stage có nguồn: output phải có `## Nguồn tham chiếu` hợp lệ ⇒ gộp vào `template_ok`/`missing`.
  const reads = c.x.result.kind === "output" ? c.x.result.sourceReads : undefined;
  const refs = c.srcCtx ? stageRefsCheck(c.srcCtx, text, reads) : { ok: true as const };
  const ok = chk.ok && refs.ok;
  const missing = refs.ok ? chk.missing : [...chk.missing, "## Nguồn tham chiếu"];
  const [v] = await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0) + 1 as v
    from hub.process_outputs where stage_run_id = ${c.x.stageRunId}`);
  const version = Number(v?.v ?? 1);
  const id = crypto.randomUUID();
  const att = await outputAttachment(d, tx, c, text);
  await tx.execute(sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx,
      version, attempt, content, sections, fields, summaries, template_ok, template_missing, attachment_id, round)
    values (${id}, ${c.head.tenant_id}, ${c.x.runId}, ${c.x.stageRunId}, ${c.idx}, ${version},
      ${Number(c.stage.attempt)}, ${text}, ${r.sections ? JSON.stringify(r.sections) : null}::jsonb,
      ${chk.fields ? JSON.stringify(chk.fields) : null}::jsonb,
      ${r.summaries ? JSON.stringify(r.summaries) : null}::jsonb,
      ${ok}, ${missingArray(missing)}, ${att?.id ?? null},
      (select round from hub.stage_runs where id = ${c.x.stageRunId}))`);
  if (missing.length > 0)
    await tx.execute(sql`update hub.stage_runs set feedback = ${refsFeedback(missing, refs.ok, c.srcCtx, { text, reads })}
      where id = ${c.x.stageRunId}`);
  return { out: { id, version, ok, missing }, pending: att?.pending ?? null };
}

async function openReview(
  d: Deps,
  tx: Tx,
  c: Ctx,
  outputId: string | null,
): Promise<{ taskId: string; events: UserEvent[] }> {
  const groupId = c.def.after.kind === "review" ? c.def.after.group_id : null;
  const taskId = await core.insertTask(tx, {
    tenantId: c.head.tenant_id,
    runId: c.x.runId,
    stageRunId: c.x.stageRunId,
    kind: "review",
    remindAt: new Date(d.now().getTime() + 86_400_000),
    outputId,
    userIds: [],
    groupId,
  });
  return { taskId, events: await d.notifier.taskOpened(tx, taskId) };
}

async function openAsk(d: Deps, tx: Tx, c: Ctx): Promise<UserEvent[]> {
  const ask = c.x.result.kind === "need_input" ? c.x.result : { question: "", choices: [] };
  const a = c.def.answerer;
  const userIds = a.kind === "starter" ? [c.head.started_by] : a.kind === "user" ? [a.user_id] : [];
  const taskId = await core.insertTask(tx, {
    tenantId: c.head.tenant_id,
    runId: c.x.runId,
    stageRunId: c.x.stageRunId,
    kind: "ask",
    remindAt: new Date(d.now().getTime() + 86_400_000),
    question: ask.question,
    choices: ask.choices,
    excerpt: askExcerpt(c.head.input),
    userIds,
    groupId: a.kind === "group" ? a.group_id : null,
  });
  await enqueueThread(tx, {
    runId: c.x.runId,
    roomId: "",
    kind: "ask",
    process_run_id: c.x.runId,
    stage_idx: c.idx,
    stage_name: c.def.name,
    executor: await executorRefOf(tx, c.def.executor),
    task_id: taskId,
    question: ask.question,
    choices: ask.choices,
    asks_count: c.next.stage.asksCount,
    ask_limit: c.next.stage.askLimit,
  });
  return d.notifier.taskOpened(tx, taskId);
}

async function openDecision(d: Deps, tx: Tx, c: Ctx): Promise<UserEvent[]> {
  const reason = c.next.decisionReason as DecisionReason;
  const groupId = c.def.after.kind === "review" ? c.def.after.group_id : null;
  const asg = decisionAssignees(reason, c.head.started_by, groupId);
  const options = decisionOptionsFor(c.next.stage.hasOutput, reason);
  await tx.execute(sql`update hub.process_runs set decision = ${decisionJson(d, reason, c.idx, options)}::jsonb
    where id = ${c.x.runId}`);
  const taskId = await core.insertTask(tx, {
    tenantId: c.head.tenant_id,
    runId: c.x.runId,
    stageRunId: c.x.stageRunId,
    kind: "decision",
    remindAt: new Date(d.now().getTime() + 86_400_000),
    reason,
    userIds: asg.userIds,
    groupId: asg.groupId,
  });
  await enqueueThread(tx, {
    runId: c.x.runId,
    roomId: "",
    kind: "decision",
    process_run_id: c.x.runId,
    stage_idx: c.idx,
    task_id: taskId,
    reason,
    options,
  });
  return d.notifier.taskOpened(tx, taskId);
}

const decisionJson = (d: Deps, reason: DecisionReason, idx: number, options: DecisionOption[]) =>
  JSON.stringify({ reason, stage_idx: idx, options, at: d.now().toISOString() });

async function threadOutput(
  tx: Tx,
  c: Ctx,
  out: OutRow,
  reviewTaskId: string | null,
): Promise<void> {
  await enqueueThread(tx, {
    runId: c.x.runId,
    roomId: "",
    kind: "output",
    process_run_id: c.x.runId,
    stage_idx: c.idx,
    stage_name: c.def.name,
    executor: await executorRefOf(tx, c.def.executor),
    output: {
      id: out.id,
      version: out.version,
      attempt: Number(c.stage.attempt),
      template_ok: out.ok,
      template_missing: out.missing,
      created_at: new Date().toISOString(),
    },
    after: c.def.after.kind,
    review_task_id: reviewTaskId,
    // D6a · nhóm ⇒ bước thành viên theo team-run; agent đơn ⇒ run_steps của chính lần chạy stage.
    steps:
      c.def.executor.kind === "team"
        ? await outputSteps(tx, {
            stageRunId: c.x.stageRunId,
            tenantId: c.head.tenant_id,
            attempt: Number(c.stage.attempt),
          })
        : await outputStepsSingle(tx, {
            hubRunId: c.x.hubRunId,
            tenantId: c.head.tenant_id,
          }),
  });
}

const threadRunEnd = (tx: Tx, c: Ctx) =>
  enqueueThread(tx, {
    runId: c.x.runId,
    roomId: "",
    kind: "run_end",
    process_run_id: c.x.runId,
    status: "done",
    actor: null,
  });

export async function headOf(tx: Tx, runId: string): Promise<RunHead | null> {
  const [r] =
    await tx.execute<RunHead>(sql`select tenant_id, started_by, status, current_stage_idx, input,
    snapshot from hub.process_runs where id = ${runId}`);
  return r ?? null;
}
export async function stageRowOf(tx: Tx, runId: string, idx: number): Promise<StageRow | null> {
  const [s] =
    await tx.execute<StageRow>(sql`select id, status, attempt, attempt_limit, asks_count, ask_limit,
    current_output_id, current_run_id from hub.stage_runs where process_run_id = ${runId} and stage_idx = ${idx}`);
  return s ?? null;
}

/** Launcher (permission_lost/user_inactive) + sweeps reconcile: mở needs_decision + task + thread + notifier. */
export async function toDecision(
  d: Deps,
  tx: Tx,
  p: { runId: string; tenantId: string; idx: number; stageRunId: string; reason: DecisionReason },
): Promise<UserEvent[]> {
  const head = await headOf(tx, p.runId);
  const stage = await stageRowOf(tx, p.runId, p.idx);
  if (!head || !stage) return [];
  const def = head.snapshot.stages[p.idx];
  const groupId = def?.after.kind === "review" ? def.after.group_id : null;
  const options = decisionOptionsFor(stage.current_output_id !== null, p.reason);
  await tx.execute(sql`update hub.process_runs set status = 'needs_decision',
    decision = ${decisionJson(d, p.reason, p.idx, options)}::jsonb, updated_at = now() where id = ${p.runId}`);
  await tx.execute(sql`update hub.stage_runs set status = 'needs_decision', updated_at = now()
    where id = ${p.stageRunId}`);
  const asg = decisionAssignees(p.reason, head.started_by, groupId);
  const taskId = await core.insertTask(tx, {
    tenantId: p.tenantId,
    runId: p.runId,
    stageRunId: p.stageRunId,
    kind: "decision",
    remindAt: new Date(d.now().getTime() + 86_400_000),
    reason: p.reason,
    userIds: asg.userIds,
    groupId: asg.groupId,
  });
  await enqueueThread(tx, {
    runId: p.runId,
    roomId: "",
    kind: "decision",
    process_run_id: p.runId,
    stage_idx: p.idx,
    task_id: taskId,
    reason: p.reason,
    options,
  });
  return d.notifier.taskOpened(tx, taskId);
}
