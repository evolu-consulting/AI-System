// HUB-FR-106 · HUB-FR-114 · D5 · D7 · D8 · PF1 · (1) hiệu ứng máy trạng thái stage (ghi `process_outputs`/task/thread +
// `notifier`, persist trạng thái) dùng chung cho agent đơn + nhóm; (2) chạy stage nhóm. Tách khỏi `stage-driver.ts` cho
// giới hạn 400 dòng (một chiều `stage-driver` → `team-runner`, không ngược). TODO(slice kế): team-runner thật (3 chế độ).

import { createHash } from "node:crypto";
import { DECISION_OPTIONS, type DecisionOption, type DecisionReason } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import type { ProcessDeps } from "../core/ports";
import type { Effect, RunEvent, RunState } from "../core/process-state.rules";
import { askExcerpt, decisionAssignees } from "../core/task.rules";
import { enqueueThread } from "../core/thread";
import { checkTemplate } from "./template.rules";

type Deps = Omit<ProcessDeps, "launcher" | "start">;
export type Link = { process_run_id: string | null; stage_run_id: string | null };

/** Kết quả thực thi stage (agent đơn / nhóm) chuẩn hoá cho máy trạng thái. */
export type StageResult =
  | {
      kind: "output";
      text: string;
      sections?: Record<string, string>;
      summaries?: Record<string, string>;
    }
  | { kind: "need_input"; question: string; choices: string[] }
  | { kind: "limit"; reason: DecisionReason }
  | { kind: "failed"; reason: "agent_failed" | "job_timeout" };

export type SnapStage = {
  name: string;
  executor: { kind: "agent"; agent_id: string } | { kind: "team"; team_id: string };
  output: {
    filename: string;
    template: string;
    required_sections: string[];
    fields: { key: string; type: string; required: boolean }[];
  };
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
  answerer:
    | { kind: "starter" }
    | { kind: "group"; group_id: string }
    | { kind: "user"; user_id: string };
  token_budget: number | null;
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
};

const executorRef = (def: SnapStage) => {
  const id = def.executor.kind === "agent" ? def.executor.agent_id : def.executor.team_id;
  return { kind: def.executor.kind, key: id, name: { vi: id, en: id } };
};
const missingArray = (missing: readonly string[]) =>
  missing.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        missing.map((m) => sql`${m}`),
        sql`, `,
      )}]::text[]`;

/** Hiệu ứng máy trạng thái trong tx quy trình; trả sự kiện phát sau COMMIT + có cần `kick` không. */
export async function effects(
  d: Deps,
  tx: Tx,
  c: Ctx,
): Promise<{ events: UserEvent[]; kick: boolean }> {
  const events: UserEvent[] = [];
  const out = c.ev.kind === "stage_output" ? await writeOutput(tx, c) : null;
  let reviewTaskId: string | null = null;
  for (const eff of c.list) {
    if (eff === "open_review") {
      const r = await openReview(d, tx, c, out?.id ?? null);
      reviewTaskId = r.taskId;
      events.push(...r.events);
    } else if (eff === "open_ask") events.push(...(await openAsk(d, tx, c)));
    else if (eff === "open_decision") events.push(...(await openDecision(d, tx, c)));
    else if (eff === "finish_run") events.push(...(await d.notifier.runFinished(tx, c.x.runId)));
  }
  await persistState(tx, c, out?.id ?? null);
  if (out) await threadOutput(tx, c, out, reviewTaskId);
  if (c.list.includes("finish_run")) await threadRunEnd(tx, c);
  return { events, kick: c.list.includes("queue_next_stage") || c.list.includes("queue_stage") };
}

type OutRow = { id: string; version: number; ok: boolean; missing: string[] };
async function writeOutput(tx: Tx, c: Ctx): Promise<OutRow> {
  const r = c.x.result as { text: string; sections?: Record<string, string>; summaries?: unknown };
  const text = r.text;
  const chk = checkTemplate(
    { requiredSections: c.def.output.required_sections, fields: c.def.output.fields as never },
    text,
  );
  const [v] = await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0) + 1 as v
    from hub.process_outputs where stage_run_id = ${c.x.stageRunId}`);
  const version = Number(v?.v ?? 1);
  const id = crypto.randomUUID();
  const attId = await outputAttachment(tx, c, text);
  await tx.execute(sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx,
      version, attempt, content, sections, fields, summaries, template_ok, template_missing, attachment_id)
    values (${id}, ${c.head.tenant_id}, ${c.x.runId}, ${c.x.stageRunId}, ${c.idx}, ${version},
      ${Number(c.stage.attempt)}, ${text}, ${r.sections ? JSON.stringify(r.sections) : null}::jsonb,
      ${chk.fields ? JSON.stringify(chk.fields) : null}::jsonb,
      ${r.summaries ? JSON.stringify(r.summaries) : null}::jsonb,
      ${chk.ok}, ${missingArray(chk.missing)}, ${attId})`);
  if (chk.missing.length > 0)
    await tx.execute(sql`update hub.stage_runs set feedback = ${`Thiếu mục: ${chk.missing.join(", ")}`}
      where id = ${c.x.stageRunId}`);
  return { id, version, ok: chk.ok, missing: chk.missing };
}

/** D5 · attachment `origin=output` (text/markdown, của người bắt đầu, `job_id` = job cuối). Rỗng ⇒ không tạo. */
async function outputAttachment(tx: Tx, c: Ctx, text: string): Promise<string | null> {
  const size = Buffer.byteLength(text, "utf8");
  if (size === 0) return null;
  const jobId = c.x.jobId ?? (await lastJobOf(tx, c.x.runId));
  if (!jobId) return null;
  const id = crypto.randomUUID();
  const filename = c.def.output.filename || `${c.def.name || "output"}.md`;
  const sha = createHash("sha256").update(text, "utf8").digest("hex");
  await tx.execute(sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename,
      safe_name, mime, size, sha256, storage_key)
    values (${id}, ${c.head.tenant_id}, ${c.head.started_by}, 'output', ${jobId}, ${filename},
      ${safeName(`s${c.idx}-v-${filename}`)}, 'text/markdown', ${size}, ${sha},
      ${c.head.tenant_id}::text || '/' || ${id}::text)`);
  return id;
}

/** ≤ 120 byte UTF-8, ký tự an toàn (khớp CHECK `attachments_safe_name_check`). */
const safeName = (s: string): string =>
  Buffer.from(s.replace(/[^\w.-]+/g, "-"), "utf8")
    .subarray(0, 120)
    .toString("utf8");

async function lastJobOf(tx: Tx, runId: string): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select j.id from hub.jobs j
    join hub.runs rr on rr.id = j.run_id where rr.process_run_id = ${runId}
    order by j.created_at desc limit 1`);
  return r?.id ?? null;
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
    executor: executorRef(c.def),
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
  const options = optionsFor(c.next.stage.hasOutput, reason);
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

/** `use_current` cần output; lý do nhóm + mất quyền/khoá luôn cho (dùng bản nháp ghép / bỏ qua stage). */
const FORCE_USE_CURRENT: ReadonlySet<DecisionReason> = new Set([
  "team_calls",
  "team_tokens",
  "team_time",
  "team_no_change",
  "permission_lost",
  "user_inactive",
]);
const optionsFor = (hasOutput: boolean, reason: DecisionReason): DecisionOption[] =>
  DECISION_OPTIONS.filter((o) => o !== "use_current" || hasOutput || FORCE_USE_CURRENT.has(reason));
const decisionJson = (d: Deps, reason: DecisionReason, idx: number, options: DecisionOption[]) =>
  JSON.stringify({ reason, stage_idx: idx, options, at: d.now().toISOString() });

async function persistState(tx: Tx, c: Ctx, outputId: string | null): Promise<void> {
  const n = c.next;
  const finished = n.status === "done";
  await tx.execute(sql`update hub.process_runs set status = ${n.status}, current_stage_idx = ${n.stageIdx},
      updated_at = now(), finished_at = ${finished ? sql`now()` : sql`finished_at`} where id = ${c.x.runId}`);
  const keepOut = outputId && n.stage.hasOutput ? outputId : null;
  if (n.stageIdx === c.idx)
    await tx.execute(sql`update hub.stage_runs set status = ${n.stage.status}, attempt = ${n.stage.attempt},
        attempt_limit = ${n.stage.attemptLimit}, asks_count = ${n.stage.asksCount}, ask_limit = ${n.stage.askLimit},
        current_output_id = ${keepOut ?? sql`current_output_id`},
        finished_at = ${finished ? sql`now()` : sql`finished_at`}, updated_at = now() where id = ${c.x.stageRunId}`);
  else {
    await tx.execute(sql`update hub.stage_runs set status = 'done', current_output_id = ${keepOut ?? sql`current_output_id`},
      finished_at = now(), updated_at = now() where id = ${c.x.stageRunId}`);
    await tx.execute(sql`update hub.stage_runs set status = 'queued', updated_at = now()
      where process_run_id = ${c.x.runId} and stage_idx = ${n.stageIdx}`);
  }
}

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
    executor: executorRef(c.def),
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
    steps: [],
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
  const options = optionsFor(stage.current_output_id !== null, p.reason);
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
