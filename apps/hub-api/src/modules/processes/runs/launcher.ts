// HUB-FR-105 · HUB-FR-106 · D1 · D3 · D10 · BR-23/24 · PF1 · `StageLauncher.kick`: tx scope `user` người bắt đầu khoá run →
// kiểm lại quyền (grant agent / nhóm bật) → tạo `hub.runs` stage (RunService) → sau COMMIT `launch` driver stage. Idempotent
// theo `stage_runs.current_run_id` (P1-29/63). Mất quyền ⇒ needs_decision{permission_lost|user_inactive}. Thứ tự khoá §10.
import {
  PROCESS_STAGES_MAX,
  PROCESS_STEP_STAGES_MAX,
  type ProcessRunStatus,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { publishUserEvents } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import { NOOP_LAUNCHER, type StageLauncher } from "../core/ports";
import { isTerminal } from "../domain/runs/run-state.rules";
import { stageIdxsOfStep } from "../domain/runs/step.rules";
import { nodeLauncherOf } from "../nodes/registry.launch";
import { type KickResult, type LauncherDeps, lostPermission, type StageRow } from "./launch-common";
import { gateResolve, type Head } from "./launcher-prompt";
import { stageDriver } from "./stage-driver";
import { stepsOfSnap } from "./step-persist";

export type { LauncherDeps } from "./launch-common";

/** B0: no-op; P-a mount dựng bản thật. */
export function createStageLauncher(d?: LauncherDeps): StageLauncher {
  if (!d) return NOOP_LAUNCHER;
  const self: StageLauncher = { kick: (runId) => kick(d, self, runId) };
  return self;
}

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

/** D5 · kick = khởi động LẦN LƯỢT mọi stage `queued` của bước hiện tại (mỗi stage một tx), dừng khi `skip`. */
async function kick(d: LauncherDeps, self: StageLauncher, runId: string): Promise<void> {
  // CR-103 · node đồng bộ (if/set) chốt stage ngay ⇒ chuỗi nhiều bước liên tiếp không được chờ quét mồ côi: lượt kick đồng bộ
  // (`events` + `more`) đếm theo trần RIÊNG (≤ số stage tối đa của def), không ăn trần stage-song-song của loại bất đồng bộ.
  let asyncRuns = 0;
  let sync = 0;
  while (asyncRuns <= PROCESS_STEP_STAGES_MAX && sync <= PROCESS_STAGES_MAX) {
    const r = await kickOnce(d, self, runId);
    if (!r.more) return;
    if (r.sync) sync++;
    else asyncRuns++;
  }
}

/** D10 · một lượt kick của run (idempotent, khoá `process_runs` FOR UPDATE trước). `false` ⇒ không còn gì để làm. */
async function kickOnce(
  d: LauncherDeps,
  self: StageLauncher,
  runId: string,
): Promise<{ more: boolean; sync: boolean }> {
  const none = { more: false, sync: false };
  // P-R10 · kiểm lại quyền mỗi stage trên cấu hình MỚI NHẤT đã COMMIT (không chờ timer poll nền): thu hồi grant bump
  // `hub_config_version` ⇒ `poll` nạp lại ⇒ `prepareProcess` thấy mất grant (P1-24). Lỗi poll không chặn kick.
  // T19-perf · đọc đầu run (scope system) ∥ poll cấu hình — độc lập, kết nối riêng; cả hai xong TRƯỚC tx khoá run.
  const [sysHead] = await Promise.all([
    withHubScope(d.db, { kind: "system" }, (tx) => headOf(tx, runId)),
    d.config.poll().catch(() => {}),
  ]);
  if (!sysHead || isTerminal(sysHead.status as ProcessRunStatus)) return none;
  const u: AuthUser = { userId: sysHead.started_by, tenantId: sysHead.tenant_id, role: "member" };
  const result = await withHubScope(d.db, { kind: "user", ...u }, (tx) => plan(d, tx, u, runId));
  if (result.kind === "events") {
    await publishUserEvents(d.redis, result.events, d.log);
    await d.postThread(runId).catch(() => {});
    return { more: result.more === true, sync: true };
  }
  if (result.kind !== "launch") return none;
  // m2 · stage tool không bao giờ rơi về `stageDriver`; thiếu `toolDriver` đã quyết `tool_failed` ở `plan`.
  const driver = result.toolLink
    ? d.toolDriver?.(result.toolLink)
    : stageDriver(d, self, { useSession: result.useSession });
  if (!driver) return none;
  await d.runs.launch(result.prepared, result.files as never, { driver });
  return { more: result.more === true, sync: false };
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
  // T19-perf · khoá run (câu ĐẦU, §10) + đọc đầu run gửi liền (pipeline): câu đọc chạy sau khoá, cùng ảnh.
  const [run, head] = await Promise.all([core.lockRun(tx, u.tenantId, runId), headOf(tx, runId)]);
  if (!run || isTerminal(run.status as ProcessRunStatus)) return { kind: "skip" };
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
  // C2 · chuẩn bị riêng loại node (nhóm: kiểm sẵn sàng + `team_run`) — giữ thứ tự cũ: starterUsable → team → launch.
  const node = nodeLauncherOf(def.executor.kind);
  const prep = { u, def, stageId: stage.id, attempt: stage.attempt, runId };
  const team = (await node.prepare?.(d, tx, prep)) ?? { ok: true as const, teamRunId: null };
  if (!team.ok) return { ...(await lost("permission_lost")), more };
  // CR-103 · launch theo loại node: wait_until (hẹn giờ) / apply (nhánh Áp) / tool (`hub.runs` không agent) / agent·team.
  const ctx = { u, runId, idx, head, stage, def, teamRunId: team.teamRunId, lost };
  // `more` do node quyết thắng (node chạy đồng bộ như `set` xong stage ⇒ cần kick bước kế); vắng ⇒ theo hàng đợi bước.
  return { more, ...(await node.launch(d, tx, ctx)) };
}

/** P-R10 · người bắt đầu còn dùng được: `admin.users.active` ∧ ¬`locked_by_tenant` ∧ `admin.tenants.active` (đọc tươi). */
async function starterUsable(tx: Tx, u: AuthUser): Promise<boolean> {
  const [r] = await tx.execute<{ usable: boolean }>(sql`select
      (u.active and not u.locked_by_tenant and t.active) as usable
    from admin.users u join admin.tenants t on t.id = u.tenant_id
    where u.id = ${u.userId} and u.tenant_id = ${u.tenantId}`);
  return r?.usable === true;
}
