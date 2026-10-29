// HUB-FR-105 · D3 · D4 · CR-103 R1: phần dùng chung của launcher cho mọi loại node — kiểu `KickResult`/`LaunchCtx`/
// `NodeLauncher`, dựng run `direct` qua `hub.runs` (agent/team), đánh dấu stage running + audit hành động thật, quyết
// needs_decision khi mất quyền. Chuyển nguyên văn từ `launcher.ts` (module node gọi vào đây, lõi gọi node qua registry).
import type { DecisionReason, SendMessageRequest } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import type { UserEvent } from "../../../lib/user-stream";
import type { ProcessStage, StageExecutor } from "../../runs/run-process";
import type { ToolLaunch } from "../adapters/tools/tool-launch";
import * as core from "../core/core.repo";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import { agentIdOf, gatesRealAction } from "../nodes/registry";
import type { Head, SnapStage } from "./launcher-prompt";
import { stagePrompt } from "./launcher-session";
import { auditRealAction, priorFiles, realActionPre } from "./launcher-step";
import { toDecision } from "./team-runner";

export type LauncherDeps = Omit<ProcessDeps, "launcher" | "start">;

export type StageRow = {
  id: string;
  status: string;
  attempt: number;
  current_run_id: string | null;
  feedback: string | null;
  round: number;
  redo_sections: string[] | null;
};

type Prepared = Awaited<ReturnType<ProcessDeps["runs"]["prepareProcess"]>>;
export type KickResult = (
  | { kind: "skip" }
  | {
      kind: "launch";
      prepared: Prepared;
      files: unknown[];
      useSession: boolean;
      toolLink?: ToolLaunch["toolLink"];
    }
  | { kind: "events"; events: UserEvent[] }
) & {
  /** D5 · còn stage `queued` khác của bước ⇒ kick lặp thêm (vắng ⇒ dừng; tránh tx thừa ở def tuần tự). */
  more?: boolean;
};

type Lost = (reason: "permission_lost" | "user_inactive") => Promise<KickResult>;
export type LaunchCtx = {
  u: AuthUser;
  runId: string;
  idx: number;
  head: Head;
  stage: StageRow;
  def: SnapStage;
  teamRunId: string | null;
  lost: Lost;
};

/** Chuẩn bị trước launch (C2 nhóm: kiểm sẵn sàng + tạo `team_run`); `ok: false` ⇒ permission_lost. */
export type NodePrep = { ok: true; teamRunId: string | null } | { ok: false };
export type PrepInput = {
  u: AuthUser;
  def: SnapStage;
  stageId: string;
  attempt: number;
  runId: string;
};

/** CR-103 · phần chạy của một loại node (lõi gọi qua `nodes/registry.launch`). */
export type NodeLauncher = {
  prepare?(d: LauncherDeps, tx: Tx, p: PrepInput): Promise<NodePrep>;
  launch(d: LauncherDeps, tx: Tx, c: LaunchCtx): Promise<KickResult>;
};

const processStageOf = (
  c: LaunchCtx,
  executor: StageExecutor,
  files: ProcessStage["process"]["files"],
  preconfirm: ProcessStage["process"]["preconfirm"],
): ProcessStage => ({
  executor,
  process: {
    processRunId: c.runId,
    stageRunId: c.stage.id,
    teamRunId: c.teamRunId,
    files,
    preconfirm,
  },
});

/** Dựng run `direct` stage (kèm preconfirm D4) → `createRunTx` → đánh dấu stage running + audit `authorize_real_action`. */
export async function launchStage(
  d: LauncherDeps,
  tx: Tx,
  c: LaunchCtx,
  executor: StageExecutor,
): Promise<KickResult> {
  const { u } = c;
  const stages = c.head.snapshot.stages;
  // T19-perf · ba nhánh đọc độc lập (file bước trước / cổng hành động thật / prompt + phiên CLI) chạy xen kẽ trên cùng tx:
  // postgres.js pipeline các câu ⇒ tổng round-trip = nhánh dài nhất thay vì cộng dồn. Không nhánh nào đọc thứ nhánh khác ghi.
  const [priorOut, real, sp] = await Promise.all([
    priorFiles(tx, { tenantId: u.tenantId, runId: c.runId, idx: c.idx, stages }),
    realActionPre(d, tx, { ...c, tenantId: u.tenantId, stages }),
    d.config
      .snapshot()
      .catch(() => null)
      .then((snap) =>
        stagePrompt(
          tx,
          {
            tenantId: u.tenantId,
            runId: c.runId,
            idx: c.idx,
            head: c.head,
            stage: c.stage,
            def: c.def,
          },
          snap,
        ),
      ),
  ]);
  const p = processStageOf(c, executor, priorOut, real?.preconfirm);
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
  await markStageRunning(tx, { c, runId: prepared.run.id, real });
  return { kind: "launch", prepared, files, useSession: sp.useSession };
}

/** Đánh dấu stage `running` (gắn hub run) + audit `authorize_real_action` khi có cổng hành động thật. */
export async function markStageRunning(
  tx: Tx,
  o: { c: LaunchCtx; runId: string; real: Awaited<ReturnType<typeof realActionPre>> },
): Promise<void> {
  const { c, real } = o;
  await tx.execute(sql`update hub.stage_runs set status = 'running', current_run_id = ${o.runId},
      started_at = coalesce(started_at, now()), updated_at = now(), ${markLaunched}
    where id = ${c.stage.id}`);
  if (!real) return;
  // Chỉ loại có cổng hành động thật (agent/tool gọi tới đây; Áp chạy nhánh riêng, team luôn `real` null).
  const ex = c.def.executor;
  if (!gatesRealAction(ex.kind)) return;
  // R-1 · D2-49 · stage tool: không agent ⇒ agent_id null (như Áp, C32).
  await auditRealAction(tx, {
    tenantId: c.u.tenantId,
    runId: c.runId,
    actorId: real.passedBy,
    name: c.def.name,
    agentId: agentIdOf(ex),
    pre: real,
  });
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

/** P-R10 · kiểm lại quyền hỏng ⇒ needs_decision{permission_lost|user_inactive}; mở task decision (team-runner). */
export async function lostPermission(
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
