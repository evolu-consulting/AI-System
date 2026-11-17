// CR-120 · G3/G4 · nối use case `enterTimedWait` vào `launcher.plan()` cho stage `wait_for` / `wait_event` (cùng khuôn
// `wait-launch.ts`: tx scope user người bắt đầu, run ĐÃ khoá, `tenantId` từ hàng run đã khoá). Luôn `waiting` (không có đường
// `invalid`) ⇒ trạng thái run theo bước (`settleStepTx`, PD-R15) + `process_updated`; kick tiếp do `kickOnce` SAU COMMIT.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { UserEvent } from "../../../lib/user-stream";
import { bindTx } from "../adapters/hub-uow";
import { settleStepTx } from "../adapters/runs/step.repo";
import { tenantTzRepo } from "../adapters/timers/tenant-tz.repo";
import { waitRepo } from "../adapters/timers/wait.repo";
import { enterTimedWait } from "../application/timers/enter-timed-wait.usecase";
import * as core from "../core/core.repo";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";

type Deps = Omit<ProcessDeps, "launcher" | "start">;
export type TimedWaitLaunch = {
  runId: string;
  tenantId: string;
  stage: { id: string; round: number; attempt: number };
  hours: number;
  /** Chỉ `wait_event`. */
  event?: string;
};

export async function launchTimedWaitStage(
  d: Deps,
  tx: Tx,
  w: TimedWaitLaunch,
): Promise<{ kind: "events"; events: UserEvent[] }> {
  const { repos } = bindTx(tx, w.tenantId);
  if (w.event !== undefined) await packWaitEarly(d, tx, w, w.event);
  await enterTimedWait(
    {
      timers: repos.timers,
      wait: waitRepo(tx, w.tenantId),
      tz: tenantTzRepo(tx, w.tenantId, d.log),
      events: repos.runEvents,
    },
    {
      runId: w.runId,
      stageRunId: w.stage.id,
      round: Number(w.stage.round),
      attempt: Number(w.stage.attempt),
      hours: w.hours,
      ...(w.event === undefined ? {} : { event: w.event }),
      now: d.now(),
    },
  );
  const recipients = await core.runRecipients(tx, w.runId, w.tenantId);
  const step = await settleStepTx(tx, w.runId, w.tenantId);
  if (!step) return { kind: "events", events: [] };
  const run = { id: w.runId, status: step.status, stageIdx: step.stageIdx, step: step.step };
  return { kind: "events", events: processUpdated(recipients, run) };
}

/**
 * CR-181 · s9 · Q8/D3 · stage `wait_event` của run gắn gói sắp mở: gói báo việc đã xong (vd bước Ký ondoc đã đủ ô Bên A từ bước duyệt) ⇒
 * ghi sự kiện TRONG tx này (run đã khoá) ⇒ `enterTimedWait` thấy `early` ⇒ hẹn tới hạn ngay. Một câu đọc run + câu của gói (cùng tx).
 */
async function packWaitEarly(d: Deps, tx: Tx, w: TimedWaitLaunch, event: string): Promise<void> {
  if (!d.packWaitReady) return;
  const [r] = await tx.execute<{
    pack: string | null;
    rec: string | null;
    stages: unknown[] | null;
    idx: number;
  }>(sql`
    select r.pack_key as pack, r.pack_record_id::text as rec, r.snapshot->'stages' as stages, s.stage_idx as idx
    from hub.process_runs r join hub.stage_runs s on s.id = ${w.stage.id}::uuid and s.tenant_id = r.tenant_id
    where r.id = ${w.runId}::uuid and r.tenant_id = ${w.tenantId}::uuid`);
  if (!r?.pack || !r.rec) return;
  const e = { tenantId: w.tenantId, packKey: r.pack, recordId: r.rec, runId: w.runId, event };
  const ready = await d.packWaitReady(tx, { ...e, stages: r.stages ?? [], idx: Number(r.idx) });
  if (!ready) return;
  const { repos } = bindTx(tx, w.tenantId);
  if (!(await repos.runEvents.has(w.runId, event)))
    await repos.runEvents.record(w.runId, event, d.now());
}
