// HUB · tách từ pack-runs.ts (CR-127 R1 #3): huỷ/thử lại run ở scope system + đọc trạng thái.

import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import type { PackRunCaller } from "../../packs/kit/public";
import * as core from "../core/core.repo";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import { isTerminal } from "../domain/runs/run-state.rules";
import type { ProcessRunStatus } from "../domain/types";
import { cancelEnd } from "../gates/gates.effects";
import type * as g from "../gates/gates.repo";
import type { GateService } from "../gates/gates.service";
import { UUID } from "./pack-runs-view";

export const asUser = (u: PackRunCaller): AuthUser => u as AuthUser;
export const uuids = (xs: readonly string[]) => `{${xs.filter((x) => UUID.test(x)).join(",")}}`;
export const SYS = { kind: "system" as const };
/** Lỗi engine coi như "đã có người làm trước" (đua) — không ném cho gói. */
export const raced = (e: unknown, code: string) => e instanceof AppError && e.code === code;

/** Huỷ run ở scope system (khoá run trước — §10); không có trong tenant / đã kết thúc ⇒ false. */
export async function cancelSys(d: ProcessDeps, tenantId: string, runId: string): Promise<boolean> {
  if (!UUID.test(runId) || !UUID.test(tenantId)) return false;
  const events = await withHubScope(d.db, SYS, async (tx) => {
    const run = await core.lockRun(tx, tenantId, runId);
    if (!run || isTerminal(run.status as ProcessRunStatus)) return null;
    const recipients = await core.runRecipients(tx, run.id, tenantId);
    const idx = Number(run.currentStageIdx);
    // Không có người thao tác (hệ thống) ⇒ run_end không kèm actor.
    const ref = null as unknown as g.ActorRef;
    const ev = await cancelEnd({ d, tx }, { run, idx, ref }, null);
    const upd = {
      id: run.id,
      status: "cancelled" as const,
      stageIdx: idx,
      step: Number(run.currentStep),
    };
    return [...ev, ...processUpdated(recipients, upd)];
  });
  if (events === null) return false;
  await publishUserEvents(d.redis, events, d.log);
  await d.postThread(runId).catch(() => {});
  return true;
}

export const OUTCOME_SYS = (tenantIds: readonly string[], runIds: readonly string[]) => sql`
  select r.id as run_id, r.tenant_id, r.status, (rj.id is not null) as rejected, rj.feedback,
    r.snapshot->'stages'->(r.current_stage_idx::int)->>'key' as stage_key
  from hub.process_runs r
  left join lateral (select t.id, t.feedback from hub.review_tasks t where t.process_run_id = r.id
    and t.tenant_id = r.tenant_id and t.result = 'reject' limit 1) rj on true
  where r.id = any(${uuids(runIds)}::uuid[]) and r.tenant_id = any(${uuids(tenantIds)}::uuid[])`;

/**
 * Stage `done` mà task REVIEW đóng gần nhất là Đạt (`pass`) — stage bị quay lại rồi chưa xong không tính. fix-review: decision
 * `use_current` (coi như Đạt, không ai trong Group duyệt quyết) KHÔNG tính.
 */
export const PASSED = (tenantId: string, runId: string) => sql`
  select r.snapshot->'stages'->(s.stage_idx::int)->>'key' as k
  from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
  where s.process_run_id = ${runId} and s.tenant_id = ${tenantId} and s.status = 'done'
    and (select t.result from hub.review_tasks t where t.stage_run_id = s.id and t.tenant_id = s.tenant_id
      and t.kind = 'review' and t.status = 'closed'
      order by t.decided_at desc nulls last, t.created_at desc limit 1) = 'pass'
  order by s.stage_idx`;

/**
 * Huỷ bù của gói (`PackRunsPort.cancel`): run gắn gói không huỷ được qua API process-runs (fix-review) ⇒ người bắt đầu huỷ
 * run gắn gói của CHÍNH mình qua `cancelSys` (lọc tenant + `started_by`); run không gắn gói ⇒ như cũ (`GateService.cancel`).
 */
export async function cancelOwn(
  d: ProcessDeps,
  gates: GateService,
  u: PackRunCaller,
  runId: string,
) {
  if (!UUID.test(runId) || !UUID.test(u.tenantId)) return;
  const [r] = await withHubScope(d.db, SYS, (tx) =>
    tx.execute<{
      own: boolean;
    }>(sql`select (started_by = ${u.userId}::uuid) as own from hub.process_runs
      where id = ${runId} and tenant_id = ${u.tenantId} and pack_key is not null`),
  );
  if (r?.own === true) await cancelSys(d, u.tenantId, runId);
  else await gates.cancel(asUser(u), runId);
}

/**
 * CR-107 · "Thử lại" của gói cho run gắn gói đang `needs_decision`: CÙNG đường quyết `GateService.decide` (`add_attempt`) — người
 * gọi mang vai admin vì run gắn gói chỉ admin quyết (`canDecide`); quyền thật (admin gói) gói đã kiểm trước. Không gắn gói / không
 * còn decision mở (đua) ⇒ "not_open".
 */
export async function retryDecision(
  d: ProcessDeps,
  gates: GateService,
  u: PackRunCaller,
  runId: string,
): Promise<"ok" | "not_open"> {
  if (!UUID.test(runId) || !UUID.test(u.tenantId)) return "not_open";
  const [r] = await withHubScope(d.db, SYS, (tx) =>
    tx.execute<{ ok: boolean }>(sql`select (status = 'needs_decision') as ok from hub.process_runs
      where id = ${runId} and tenant_id = ${u.tenantId} and pack_key is not null`),
  );
  if (r?.ok !== true) return "not_open";
  try {
    await gates.decide({ ...asUser(u), role: "tenant_admin" }, runId, { option: "add_attempt" });
  } catch (e) {
    if (raced(e, "PROCESS_RUN_STATE")) return "not_open";
    throw e;
  }
  return "ok";
}
