// HUB-FR-105 · HUB-FR-106 · D1 · D3 · D10 · BR-23/24 · PF1 · `StageLauncher.kick`: tx scope `user` người bắt đầu khoá run →
// kiểm lại quyền (grant agent / nhóm bật) → tạo `hub.runs` stage (RunService) → sau COMMIT `launch` driver stage. Idempotent
// theo `stage_runs.current_run_id` (P1-29/63). Mất quyền ⇒ needs_decision{permission_lost|user_inactive}. Thứ tự khoá §10.
import type { DecisionReason, SendMessageRequest, StageRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { clipEntityName, dbHubAudit } from "../../../lib/hub-audit";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import type { RunFile } from "../../attachments/run-files.rules";
import { agentWorkflowIds } from "../../config/config.rules";
import type { ProcessRunInput } from "../../runs/create-run";
import type { ProcessStage, StageExecutor } from "../../runs/run-process";
import * as core from "../core/core.repo";
import { NOOP_LAUNCHER, type ProcessDeps, type StageLauncher } from "../core/ports";
import { realActionAllowed } from "../gates/gate.rules";
import { stageDriver } from "./stage-driver";
import { createTeamRun } from "./team-counters";
import { teamReady } from "./team-load";
import { toDecision } from "./team-runner";

export type LauncherDeps = Omit<ProcessDeps, "launcher" | "start">;

type SnapStage = {
  key: string;
  name: string;
  instruction: string;
  executor: { kind: "agent"; agent_id: string } | { kind: "team"; team_id: string };
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
  output: { filename: string };
  real_action: boolean;
  timeout_s: number;
};
type Head = {
  tenant_id: string;
  started_by: string;
  status: string;
  current_stage_idx: number;
  conversation_id: string;
  input: string;
  snapshot: { stages: SnapStage[]; token_budget: number | null };
};
type StageRow = {
  id: string;
  status: string;
  attempt: number;
  current_run_id: string | null;
  feedback: string | null;
};

/** B0: no-op; P-a mount dựng bản thật. */
export function createStageLauncher(d?: LauncherDeps): StageLauncher {
  if (!d) return NOOP_LAUNCHER;
  const self: StageLauncher = { kick: (runId) => kick(d, self, runId) };
  return self;
}

const execOf = (s: SnapStage): StageExecutor =>
  s.executor.kind === "agent"
    ? { kind: "agent", agentId: s.executor.agent_id }
    : { kind: "team", teamId: s.executor.team_id };

/** Prompt stage (D6 rút gọn): instruction + input run + góp ý (làm lại). Output stage trước đi qua `files`. */
const promptOf = (stage: SnapStage, head: Head, feedback: string | null): string => {
  const parts = [stage.instruction.trim(), head.input.trim()].filter((p) => p.length > 0);
  if (feedback && feedback.trim().length > 0) parts.push(`Góp ý cần sửa:\n${feedback.trim()}`);
  return parts.join("\n\n") || stage.name;
};

async function headOf(tx: Tx, runId: string): Promise<Head | null> {
  const [r] = await tx.execute<Head>(sql`select tenant_id, started_by, status, current_stage_idx,
    conversation_id, input, snapshot from hub.process_runs where id = ${runId}`);
  return r ?? null;
}

async function stageOf(tx: Tx, runId: string, idx: number): Promise<StageRow | null> {
  const [s] = await tx.execute<StageRow>(sql`select id, status, attempt, current_run_id, feedback
    from hub.stage_runs where process_run_id = ${runId} and stage_idx = ${idx}`);
  return s ?? null;
}

/** `current_run_id` đang có `hub.runs` chạy ⇒ đã kick (idempotent P1-29/63). */
async function alreadyRunning(tx: Tx, stage: StageRow): Promise<boolean> {
  if (!stage.current_run_id) return false;
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.runs
    where id = ${stage.current_run_id} and status = 'running' limit 1`);
  return r !== undefined;
}

type Prepared = Awaited<ReturnType<ProcessDeps["runs"]["prepareProcess"]>>;
type KickResult =
  | { kind: "skip" }
  | { kind: "launch"; prepared: Prepared; files: unknown[] }
  | { kind: "events"; events: UserEvent[] };

/** D10 · một lượt kick của run (idempotent, khoá `process_runs` FOR UPDATE trước). */
async function kick(d: LauncherDeps, self: StageLauncher, runId: string): Promise<void> {
  const sysHead = await withHubScope(d.db, { kind: "system" }, (tx) => headOf(tx, runId));
  if (sysHead?.status !== "running") return;
  // P-R10 · kiểm lại quyền mỗi stage trên cấu hình MỚI NHẤT đã COMMIT (không chờ timer poll nền): thu hồi grant bump
  // `hub_config_version` ⇒ `poll` nạp lại ⇒ `prepareProcess` thấy mất grant (P1-24). Lỗi poll không chặn kick.
  await d.config.poll().catch(() => {});
  const u: AuthUser = { userId: sysHead.started_by, tenantId: sysHead.tenant_id, role: "member" };
  const result = await withHubScope(d.db, { kind: "user", ...u }, (tx) => plan(d, tx, u, runId));
  if (result.kind === "events") {
    await publishUserEvents(d.redis, result.events, d.log);
    await d.postThread(runId).catch(() => {});
    return;
  }
  if (result.kind !== "launch") return;
  await d.runs.launch(result.prepared, result.files as never, {
    driver: stageDriver(d, self),
  });
}

/** Trong tx scope user người bắt đầu: khoá run, kiểm stage queued, kiểm quyền, tạo `hub.runs`. */
async function plan(d: LauncherDeps, tx: Tx, u: AuthUser, runId: string): Promise<KickResult> {
  const run = await core.lockRun(tx, u.tenantId, runId);
  if (run?.status !== "running") return { kind: "skip" };
  const idx = Number(run.currentStageIdx);
  const head = await headOf(tx, runId);
  const stage = await stageOf(tx, runId, idx);
  if (!head || !stage || stage.status !== "queued" || (await alreadyRunning(tx, stage)))
    return { kind: "skip" };
  const def = head.snapshot.stages[idx];
  if (!def) return { kind: "skip" };
  const lost = (reason: "permission_lost" | "user_inactive") =>
    lostPermission(d, tx, { runId, tenantId: u.tenantId, idx, stageRunId: stage.id, reason });
  // P-R10 · người bắt đầu phải còn dùng được (active, không bị tenant khoá, tenant bật) — đọc TƯƠI trong tx (khoá
  // `locked_by_tenant` KHÔNG bump config version ⇒ cache có thể cũ; P1-24 user_inactive).
  if (!(await starterUsable(tx, u))) return await lost("user_inactive");
  const team = await teamRunFor(d, tx, {
    u,
    def,
    stageId: stage.id,
    attempt: stage.attempt,
    runId,
  });
  if (!team.ok) return await lost("permission_lost");
  return launchStage(d, tx, u, { runId, idx, head, stage, def, teamRunId: team.teamRunId, lost });
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

/** Dựng run `direct` stage (kèm preconfirm D4) → `createRunTx` → đánh dấu stage running + audit `authorize_real_action`. */
async function launchStage(
  d: LauncherDeps,
  tx: Tx,
  u: AuthUser,
  c: LaunchCtx,
): Promise<KickResult> {
  const priorOut = await priorFiles(tx, c.runId, c.idx, c.head.snapshot.stages);
  const real = await realActionPre(d, tx, { ...c, stages: c.head.snapshot.stages });
  const p: ProcessStage = {
    executor: execOf(c.def),
    process: {
      processRunId: c.runId,
      stageRunId: c.stage.id,
      teamRunId: c.teamRunId,
      files: priorOut,
      preconfirm: real?.preconfirm,
    },
  };
  const req: SendMessageRequest = { content: promptOf(c.def, c.head, c.stage.feedback) };
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
      started_at = coalesce(started_at, now()), updated_at = now() where id = ${c.stage.id}`);
  if (real)
    await auditRealAction(tx, {
      tenantId: u.tenantId,
      runId: c.runId,
      actorId: real.passedBy,
      name: c.def.name,
      preconfirm: real.preconfirm,
    });
  return { kind: "launch", prepared, files };
}

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

type RealPre = { preconfirm: NonNullable<ProcessRunInput["preconfirm"]>; passedBy: string };

/**
 * D4 · HUB-FR-109 · stage "Hành động thật" NGAY SAU cổng kiểm đã Đạt (`realActionAllowed(prev)`): Hub chèn sẵn xác nhận cho
 * mọi workflow `side_effect` của agent stage này (người Đạt stage trước = người cho phép). Stage trước `auto`/chưa `done`
 * hoặc không có workflow side_effect ⇒ null (tool sẽ hỏi lại ⇒ CONFIRMATION_REQUIRED).
 */
async function realActionPre(
  d: LauncherDeps,
  tx: Tx,
  p: { runId: string; idx: number; def: SnapStage; stages: readonly SnapStage[] },
): Promise<RealPre | null> {
  if (!p.def.real_action || p.def.executor.kind !== "agent" || p.idx === 0) return null;
  const prevDef = p.stages[p.idx - 1];
  if (!prevDef) return null;
  const [prev] = await tx.execute<{ status: StageRunStatus; passed_by: string | null }>(
    sql`select status, passed_by from hub.stage_runs where process_run_id = ${p.runId}
      and stage_idx = ${p.idx - 1}`,
  );
  const after = prevDef.after.kind === "review" ? "review" : "auto";
  if (!prev || !realActionAllowed({ after, status: prev.status }) || !prev.passed_by) return null;
  const agentId = p.def.executor.agent_id;
  const snap = await d.config.snapshot();
  const catalog = await d.config.catalog();
  const workflowIds = [...agentWorkflowIds(snap, agentId)].filter(
    (id) => catalog.workflows.get(id)?.sideEffect === true,
  );
  if (workflowIds.length === 0) return null;
  return { preconfirm: { agentId, workflowIds }, passedBy: prev.passed_by };
}

/** D4 · audit `authorize_real_action` (append-only trong tx): actor = người Đạt cổng trước (entity `process_run`). */
async function auditRealAction(
  tx: Tx,
  p: {
    tenantId: string;
    runId: string;
    actorId: string;
    name: string;
    preconfirm: NonNullable<ProcessRunInput["preconfirm"]>;
  },
): Promise<void> {
  await dbHubAudit.insert(tx, {
    tenantId: p.tenantId,
    actorId: p.actorId,
    actorUsername: null,
    actorRole: "member",
    action: "authorize_real_action",
    entity: "process_run",
    entityId: p.runId,
    entityName: clipEntityName(p.name),
    hubConfigVersion: null,
    before: null,
    after: null,
    summary: { agent_id: p.preconfirm.agentId, workflow_ids: [...p.preconfirm.workflowIds] },
  });
}

type PriorRow = {
  stage_idx: number;
  version: number;
  attachment_id: string;
  size: string | number;
  sha256: string;
};

/** D6 · output đã chốt các stage trước (`stage_runs.current_output_id`) → `RunContext.files` (`s<idx>-v<ver>-<filename>`). */
async function priorFiles(
  tx: Tx,
  runId: string,
  idx: number,
  stages: readonly SnapStage[],
): Promise<RunFile[]> {
  if (idx === 0) return [];
  const rows = await tx.execute<PriorRow>(sql`select o.stage_idx, o.version, o.attachment_id,
      a.size, a.sha256
    from hub.stage_runs s
    join hub.process_outputs o on o.id = s.current_output_id
    join hub.attachments a on a.id = o.attachment_id
    where s.process_run_id = ${runId} and s.stage_idx < ${idx} and o.attachment_id is not null
    order by o.stage_idx`);
  return [...rows].map((r) => {
    const filename = stages[Number(r.stage_idx)]?.output.filename ?? "output.md";
    return {
      id: r.attachment_id,
      name: `s${Number(r.stage_idx)}-v${Number(r.version)}-${filename}`,
      mime: "text/markdown" as const,
      size: Number(r.size),
      sha256: r.sha256,
    };
  });
}

/** P-R10 · kiểm lại quyền hỏng ⇒ needs_decision{permission_lost|user_inactive}; mở task decision (team-runner). */
async function lostPermission(
  d: LauncherDeps,
  tx: Tx,
  p: { runId: string; tenantId: string; idx: number; stageRunId: string; reason: DecisionReason },
): Promise<KickResult> {
  return { kind: "events", events: await toDecision(d, tx, p) };
}
