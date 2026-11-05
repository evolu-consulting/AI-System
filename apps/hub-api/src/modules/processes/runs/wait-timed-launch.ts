// CR-120 · G3/G4 · nối use case `enterTimedWait` vào `launcher.plan()` cho stage `wait_for` / `wait_event` (cùng khuôn
// `wait-launch.ts`: tx scope user người bắt đầu, run ĐÃ khoá, `tenantId` từ hàng run đã khoá). Luôn `waiting` (không có đường
// `invalid`) ⇒ trạng thái run theo bước (`settleStepTx`, PD-R15) + `process_updated`; kick tiếp do `kickOnce` SAU COMMIT.
import type { Tx } from "@ai/db";
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
