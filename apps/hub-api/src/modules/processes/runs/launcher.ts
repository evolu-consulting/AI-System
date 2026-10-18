// HUB-FR-105 · HUB-FR-106 · D1 · D3 · D10 · BR-23/24 · PF1 · `StageLauncher.kick`: tx scope `user` người bắt đầu khoá run →
// kiểm lại quyền (grant agent / nhóm bật) → tạo `hub.runs` stage (RunService) → sau COMMIT `launch` driver stage. Idempotent
// theo `stage_runs.current_run_id` (P1-29/63). Mất quyền ⇒ needs_decision{permission_lost|user_inactive}. Thứ tự khoá §10.
import {
  type DecisionReason,
  PROCESS_STEP_STAGES_MAX,
  type ProcessRunStatus,
  type SendMessageRequest,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import type { ProcessStage, StageExecutor } from "../../runs/run-process";
import * as core from "../core/core.repo";
import { processUpdated } from "../core/events";
import { NOOP_LAUNCHER, type ProcessDeps, type StageLauncher } from "../core/ports";
import { isTerminal } from "../domain/runs/run-state.rules";
import { stageIdxsOfStep } from "../domain/runs/step.rules";
import { launchApplyStage } from "./apply-launch";
import { gateResolve, type Head, type SnapStage } from "./launcher-prompt";
import { stagePrompt } from "./launcher-session";
import { auditRealAction, priorFiles, realActionPre } from "./launcher-step";
import { stageDriver } from "./stage-driver";
import { stepsOfSnap } from "./step-persist";
import { createTeamRun } from "./team-counters";
import { teamReady } from "./team-load";
import { toDecision } from "./team-runner";

export type LauncherDeps = Omit<ProcessDeps, "launcher" | "start">;

type StageRow = {
  id: string;
  status: string;
  attempt: number;
  current_run_id: string | null;
  feedback: string | null;
  round: number;
  redo_sections: string[] | null;
};

/** B0: no-op; P-a mount dựng bản thật. */
export function createStageLauncher(d?: LauncherDeps): StageLauncher {
  if (!d) return NOOP_LAUNCHER;
  const self: StageLauncher = { kick: (runId) => kick(d, self, runId) };
  return self;
}

const execOf = (s: SnapStage): StageExecutor => {
  if (s.executor.kind === "agent") return { kind: "agent", agentId: s.executor.agent_id };
  if (s.executor.kind === "team") return { kind: "team", teamId: s.executor.team_id };
  // Stage Áp không chạy qua `hub.runs`/agent (nhánh riêng trong `plan`); execOf không được gọi.
  throw new Error("apply stage không dùng execOf");
};

async function headOf(tx: Tx, runId: string): Promise<Head | null> {
  const [r] = await tx.execute<Head>(sql`select tenant_id, started_by, status, current_stage_idx,
    conversation_id, input, snapshot, pinned_sources, inputs from hub.process_runs where id = ${runId}`);
  return r ?? null;
}

/** `current_run_id` đang có `hub.runs` chạy ⇒ đã kick (idempotent P1-29/63). */
async function alreadyRunning(tx: Tx, stage: StageRow): Promise<boolean> {
  if (!stage.current_run_id) return false;
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.runs
    where id = ${stage.current_run_id} and status = 'running' limit 1`);
  return r !== undefined;
}

type Prepared = Awaited<ReturnType<ProcessDeps["runs"]["prepareProcess"]>>;
type KickResult = (
  | { kind: "skip" }
  | { kind: "launch"; prepared: Prepared; files: unknown[]; useSession: boolean }
  | { kind: "events"; events: UserEvent[] }
) & {
  /** D5 · còn stage `queued` khác của bước ⇒ kick lặp thêm (vắng ⇒ dừng; tránh tx thừa ở def tuần tự). */
  more?: boolean;
};

/** D5 · kick = khởi động LẦN LƯỢT mọi stage `queued` của bước hiện tại (mỗi stage một tx), dừng khi `skip`. */
async function kick(d: LauncherDeps, self: StageLauncher, runId: string): Promise<void> {
  for (let i = 0; i <= PROCESS_STEP_STAGES_MAX; i++) if (!(await kickOnce(d, self, runId))) return;
}

/** D10 · một lượt kick của run (idempotent, khoá `process_runs` FOR UPDATE trước). `false` ⇒ không còn gì để làm. */
async function kickOnce(d: LauncherDeps, self: StageLauncher, runId: string): Promise<boolean> {
  const sysHead = await withHubScope(d.db, { kind: "system" }, (tx) => headOf(tx, runId));
  if (!sysHead || isTerminal(sysHead.status as ProcessRunStatus)) return false;
  // P-R10 · kiểm lại quyền mỗi stage trên cấu hình MỚI NHẤT đã COMMIT (không chờ timer poll nền): thu hồi grant bump
  // `hub_config_version` ⇒ `poll` nạp lại ⇒ `prepareProcess` thấy mất grant (P1-24). Lỗi poll không chặn kick.
  await d.config.poll().catch(() => {});
  const u: AuthUser = { userId: sysHead.started_by, tenantId: sysHead.tenant_id, role: "member" };
  const result = await withHubScope(d.db, { kind: "user", ...u }, (tx) => plan(d, tx, u, runId));
  if (result.kind === "events") {
    await publishUserEvents(d.redis, result.events, d.log);
    await d.postThread(runId).catch(() => {});
    return result.more === true;
  }
  if (result.kind !== "launch") return false;
  await d.runs.launch(result.prepared, result.files as never, {
    driver: stageDriver(d, self, { useSession: result.useSession }),
  });
  return result.more === true;
}

/** D3/D5 · stage `queued` nhỏ nhất của bước hiện tại chưa có `hub.runs` chạy (run đã khoá); `more` = còn stage queued sau nó. */
async function nextQueued(
  tx: Tx,
  runId: string,
  head: Head,
  step: number,
): Promise<{ idx: number; stage: StageRow; more: boolean } | null> {
  const idxs = stageIdxsOfStep(stepsOfSnap(head.snapshot), step);
  if (idxs.length === 0) return null;
  const rows = await tx.execute<
    StageRow & { stage_idx: number }
  >(sql`select id, stage_idx, status, attempt, round,
      redo_sections, current_run_id, feedback from hub.stage_runs where process_run_id = ${runId}
      and stage_idx in (${sql.join(
        idxs.map((i) => sql`${i}`),
        sql`, `,
      )}) and status = 'queued' order by stage_idx`);
  for (const [k, stage] of rows.entries())
    if (!(await alreadyRunning(tx, stage)))
      return { idx: Number(stage.stage_idx), stage, more: k < rows.length - 1 };
  return null;
}

/** Trong tx scope user người bắt đầu: khoá run, chọn stage queued của bước, kiểm quyền, tạo `hub.runs`. */
async function plan(d: LauncherDeps, tx: Tx, u: AuthUser, runId: string): Promise<KickResult> {
  const run = await core.lockRun(tx, u.tenantId, runId);
  if (!run || isTerminal(run.status as ProcessRunStatus)) return { kind: "skip" };
  const head = await headOf(tx, runId);
  if (!head) return { kind: "skip" };
  const next = await nextQueued(tx, runId, head, Number(run.currentStep));
  if (!next) return { kind: "skip" };
  const { idx, stage, more } = next;
  const def = head.snapshot.stages[idx];
  if (!def) return { kind: "skip" };
  // PB-R05 · cổng nguồn: def có nguồn ∧ chưa ghim ⇒ enqueue `source.resolve` (idempotent: run đã khoá FOR UPDATE),
  // KHÔNG launch stage nào của run. Runtime báo `/sources-resolved` ⇒ ghim + kick lại.
  if (await gateResolve(tx, runId, head)) return { kind: "skip" };
  const lost = (reason: "permission_lost" | "user_inactive") =>
    lostPermission(d, tx, { runId, tenantId: u.tenantId, idx, stageRunId: stage.id, reason });
  // P-R10 · người bắt đầu phải còn dùng được (active, không bị tenant khoá, tenant bật) — đọc TƯƠI trong tx (khoá
  // `locked_by_tenant` KHÔNG bump config version ⇒ cache có thể cũ; P1-24 user_inactive).
  if (!(await starterUsable(tx, u))) return { ...(await lost("user_inactive")), more };
  const team = await teamRunFor(d, tx, {
    u,
    def,
    stageId: stage.id,
    attempt: stage.attempt,
    runId,
  });
  if (!team.ok) return { ...(await lost("permission_lost")), more };
  // P-c2 · PC2-R03 · stage Áp: nhánh riêng (audit + applyPlan + job/không-job), KHÔNG tạo `hub.runs`/agent.
  if (def.executor.kind === "apply") {
    const r = await launchApplyStage(d, tx, {
      runId,
      idx,
      head,
      stage: { id: stage.id, attempt: Number(stage.attempt) },
      def,
    });
    return { ...r, more };
  }
  const ctx = { runId, idx, head, stage, def, teamRunId: team.teamRunId, lost };
  return { ...(await launchStage(d, tx, u, ctx)), more };
}

type Lost = (reason: "permission_lost" | "user_inactive") => Promise<KickResult>;
type LaunchCtx = {
  runId: string;
  idx: number;
  head: Head;
  stage: StageRow;
  def: SnapStage;
  teamRunId: string | null;
  lost: Lost;
};

const processStageOf = (
  c: LaunchCtx,
  files: ProcessStage["process"]["files"],
  preconfirm: ProcessStage["process"]["preconfirm"],
): ProcessStage => ({
  executor: execOf(c.def),
  process: {
    processRunId: c.runId,
    stageRunId: c.stage.id,
    teamRunId: c.teamRunId,
    files,
    preconfirm,
  },
});

/** Dựng run `direct` stage (kèm preconfirm D4) → `createRunTx` → đánh dấu stage running + audit `authorize_real_action`. */
async function launchStage(
  d: LauncherDeps,
  tx: Tx,
  u: AuthUser,
  c: LaunchCtx,
): Promise<KickResult> {
  const priorOut = await priorFiles(tx, {
    tenantId: u.tenantId,
    runId: c.runId,
    idx: c.idx,
    stages: c.head.snapshot.stages,
  });
  const real = await realActionPre(d, tx, {
    ...c,
    tenantId: u.tenantId,
    stages: c.head.snapshot.stages,
  });
  const p = processStageOf(c, priorOut, real?.preconfirm);
  const sp = await stagePrompt(
    tx,
    { tenantId: u.tenantId, runId: c.runId, idx: c.idx, head: c.head, stage: c.stage, def: c.def },
    await d.config.snapshot().catch(() => null),
  );
  const req: SendMessageRequest = { content: sp.content };
  let prepared: Prepared;
  try {
    prepared = await d.runs.prepareProcess(u, {
      conversationId: c.head.conversation_id,
      req,
      stage: p,
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "AGENT_NOT_FOUND")
      return await c.lost("permission_lost");
    throw err;
  }
  const files = await d.runs.createRunTx(tx, prepared);
  await tx.execute(sql`update hub.stage_runs set status = 'running', current_run_id = ${prepared.run.id},
      started_at = coalesce(started_at, now()), updated_at = now(), ${markLaunched}
    where id = ${c.stage.id}`);
  if (real && c.def.executor.kind === "agent")
    await auditRealAction(tx, {
      tenantId: u.tenantId,
      runId: c.runId,
      actorId: real.passedBy,
      name: c.def.name,
      agentId: c.def.executor.agent_id,
      pre: real,
    });
  return { kind: "launch", prepared, files, useSession: sp.useSession };
}

/**
 * T7 · D-PD02 · `markLaunched`: chuẩn hoá bộ đếm thử lại mỗi lần chạy stage — (attempt, round) đổi ⇒ `retry_count = 0` +
 * `retry_since` mới (đầu cửa sổ side_effect PD-R05). Mốc cắt ms như `hub.runs.started_at` (cùng tx ⇒ `started_at ≥ mốc`).
 */
const markLaunched = sql`retry_since = case
      when retry_since is null or retry_attempt is distinct from attempt or retry_round is distinct from round
      then date_trunc('milliseconds', now()) else retry_since end,
    retry_count = case when retry_attempt is distinct from attempt or retry_round is distinct from round
      then 0 else retry_count end,
    retry_attempt = attempt, retry_round = round`;

/** P-R10 · người bắt đầu còn dùng được: `admin.users.active` ∧ ¬`locked_by_tenant` ∧ `admin.tenants.active` (đọc tươi). */
async function starterUsable(tx: Tx, u: AuthUser): Promise<boolean> {
  const [r] = await tx.execute<{ usable: boolean }>(sql`select
      (u.active and not u.locked_by_tenant and t.active) as usable
    from admin.users u join admin.tenants t on t.id = u.tenant_id
    where u.id = ${u.userId} and u.tenant_id = ${u.tenantId}`);
  return r?.usable === true;
}

/** C2 · nhóm: kiểm entitlement + thành viên bật (`teamReady`) ⇒ tạo `team_run` (gán `runs.team_run_id` lúc INSERT). */
async function teamRunFor(
  d: LauncherDeps,
  tx: Tx,
  p: { u: AuthUser; def: SnapStage; stageId: string; attempt: number; runId: string },
): Promise<{ ok: true; teamRunId: string | null } | { ok: false }> {
  if (p.def.executor.kind !== "team") return { ok: true, teamRunId: null };
  // HUB-FR-110 · resume: team_run của (stage, attempt) đã có (đang chạy / chờ trả lời) ⇒ nhóm đã được kiểm sẵn sàng lúc
  // tạo và run đã chụp cấu hình (HUB-BR-06) ⇒ tiếp tục, KHÔNG kiểm `teamReady` lại (tránh fail giả khi snapshot chưa kịp
  // thấy cấu hình nhóm). Fresh (chưa có team_run) ⇒ kiểm C2 như thường (P1-36 permission_lost trước kick).
  const resuming = await existingTeamRun(tx, p.stageId, Number(p.attempt));
  if (resuming) return { ok: true, teamRunId: resuming };
  const ready = await teamReady(tx, await d.config.snapshot(), {
    teamId: p.def.executor.team_id,
    tenantId: p.u.tenantId,
  });
  if (!ready.ok) return { ok: false };
  const teamRunId = await createTeamRun(tx, {
    tenantId: p.u.tenantId,
    procRunId: p.runId,
    stageRunId: p.stageId,
    attempt: Number(p.attempt),
    teamId: p.def.executor.team_id,
    mode: ready.team.mode,
  });
  return { ok: true, teamRunId };
}

/** team_run còn hiệu lực của (stage, attempt) — có ⇒ đang resume (createTeamRun cũng dùng lại chính nó). */
async function existingTeamRun(tx: Tx, stageId: string, attempt: number): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select id from hub.team_runs
    where stage_run_id = ${stageId} and attempt = ${attempt}
      and status in ('running', 'waiting_answer') order by started_at desc limit 1`);
  return r?.id ?? null;
}

/** P-R10 · kiểm lại quyền hỏng ⇒ needs_decision{permission_lost|user_inactive}; mở task decision (team-runner). */
async function lostPermission(
  d: LauncherDeps,
  tx: Tx,
  p: { runId: string; tenantId: string; idx: number; stageRunId: string; reason: DecisionReason },
): Promise<KickResult> {
  const events = await toDecision(d, tx, p);
  const recipients = await core.runRecipients(tx, p.runId, p.tenantId);
  events.push(
    ...processUpdated(recipients, { id: p.runId, status: "needs_decision", stageIdx: p.idx }),
  );
  return { kind: "events", events };
}
