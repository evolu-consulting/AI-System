// HUB-FR-105 · HUB-FR-106 · D1 · D3 · D10 · BR-23/24 · PF1 · `StageLauncher.kick`: tx scope `user` người bắt đầu khoá run →
// kiểm lại quyền (grant agent / nhóm bật) → tạo `hub.runs` stage (RunService) → sau COMMIT `launch` driver stage. Idempotent
// theo `stage_runs.current_run_id` (P1-29/63). Mất quyền ⇒ needs_decision{permission_lost|user_inactive}. Thứ tự khoá §10.
import {
  PROCESS_STAGES_CEILING,
  PROCESS_STEP_STAGES_MAX,
  type ProcessRunStatus,
} from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { publishUserEvents } from "../../../lib/user-stream";
import { NOOP_LAUNCHER, type StageLauncher } from "../core/ports";
import { isTerminal } from "../domain/runs/run-state.rules";
import type { LauncherDeps } from "./launch-common";
import { kickMany } from "./launcher-batch";
import { headOf, launchAfterCommit, plan } from "./launcher-plan";

export type { LauncherDeps } from "./launch-common";

/** B0: no-op; P-a mount dựng bản thật. */
export function createStageLauncher(d?: LauncherDeps): StageLauncher {
  if (!d) return NOOP_LAUNCHER;
  const self: StageLauncher = {
    kick: (runId) => kick(d, self, runId),
    kickMany: (runIds) => kickMany(d, self, runIds, (runId) => kick(d, self, runId)),
  };
  return self;
}

/** D5 · kick = khởi động LẦN LƯỢT mọi stage `queued` của bước hiện tại (mỗi stage một tx), dừng khi `skip`. */
async function kick(d: LauncherDeps, self: StageLauncher, runId: string): Promise<void> {
  // CR-103 · node đồng bộ (if/set) chốt stage ngay ⇒ chuỗi nhiều bước liên tiếp không được chờ quét mồ côi: lượt kick đồng bộ
  // (`events` + `more`) đếm theo trần RIÊNG (≤ số stage tối đa của def), không ăn trần stage-song-song của loại bất đồng bộ.
  let asyncRuns = 0;
  let sync = 0;
  while (asyncRuns <= PROCESS_STEP_STAGES_MAX && sync <= PROCESS_STAGES_CEILING) {
    const r = await kickOnce(d, self, runId);
    if (!r.more) return;
    if (r.sync) sync++;
    else asyncRuns++;
  }
}

/** CR-125 · lượt con vừa mở (tx cha đã COMMIT): kick riêng từng lượt; lỗi chỉ log (quét mồ côi nhặt lại). */
async function kickOthers(
  d: Pick<LauncherDeps, "log">,
  self: StageLauncher,
  runIds: readonly string[] | undefined,
): Promise<void> {
  for (const id of runIds ?? [])
    await self.kick(id).catch(() => d.log.warn("process-kick-failed", { run_id: id }));
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
    await kickOthers(d, self, result.kicks);
    return { more: result.more === true, sync: true };
  }
  if (result.kind !== "launch") return none;
  if (!(await launchAfterCommit(d, self, result))) return none;
  return { more: result.more === true, sync: false };
}
