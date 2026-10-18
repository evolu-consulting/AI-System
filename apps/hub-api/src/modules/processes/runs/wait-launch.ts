// HUB-FR-144 · AC-H41 · PD-R13/R14/R15 · plan §4.6 (Vào) · nối use case `enterWait` vào `launcher.plan()` (tx scope user người
// bắt đầu, run ĐÃ khoá — K2: `tenantId` từ hàng run đã khoá). `waiting` ⇒ trạng thái run theo bước (`settleStep`, PD-R15)
// + `process_updated`; `invalid` ⇒ `needs_decision{timer_invalid}` qua `toDecision` cũ (người quyết như `agent_failed`).
// Kick tiếp + đăng thread do `kickOnce` làm SAU COMMIT (kết quả `events`). Không tạo `hub.runs`/job.

import type { Tx } from "@ai/db";
import type { UserEvent } from "../../../lib/user-stream";
import { bindTx } from "../adapters/hub-uow";
import { tenantTzRepo } from "../adapters/timers/tenant-tz.repo";
import { waitRepo } from "../adapters/timers/wait.repo";
import { enterWait } from "../application/timers/enter-wait.usecase";
import * as core from "../core/core.repo";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import type { WaitUntilSnap } from "./launcher-prompt";
import { settleStep } from "./step-persist";
import { toDecision } from "./team-runner";

type Deps = Omit<ProcessDeps, "launcher" | "start">;
export type WaitLaunch = {
  runId: string;
  tenantId: string;
  idx: number;
  stage: { id: string; round: number; attempt: number };
  exec: WaitUntilSnap;
  stageKeys: readonly string[];
};

const fromOf = (e: WaitUntilSnap) =>
  e.from.kind === "input"
    ? { kind: "input" as const, key: e.from.key }
    : { kind: "field" as const, stageKey: e.from.stage_key, field: e.from.field };

export async function launchWaitStage(
  d: Deps,
  tx: Tx,
  w: WaitLaunch,
): Promise<{ kind: "events"; events: UserEvent[] }> {
  const { repos } = bindTx(tx, w.tenantId);
  const out = await enterWait(
    {
      timers: repos.timers,
      wait: waitRepo(tx, w.tenantId),
      tz: tenantTzRepo(tx, w.tenantId, d.log),
    },
    {
      runId: w.runId,
      stageRunId: w.stage.id,
      round: Number(w.stage.round),
      attempt: Number(w.stage.attempt),
      wait: { from: fromOf(w.exec), offsetDays: w.exec.offset_days, time: w.exec.time },
      stageKeys: w.stageKeys,
      now: d.now(),
    },
  );
  const recipients = await core.runRecipients(tx, w.runId, w.tenantId);
  if (out.kind === "invalid") {
    const p = { runId: w.runId, tenantId: w.tenantId, idx: w.idx, stageRunId: w.stage.id };
    const events = await toDecision(d, tx, { ...p, reason: "timer_invalid" });
    events.push(
      ...processUpdated(recipients, { id: w.runId, status: "needs_decision", stageIdx: w.idx }),
    );
    return { kind: "events", events };
  }
  const step = await settleStep(tx, w.runId, w.tenantId);
  if (!step) return { kind: "events", events: [] };
  const run = { id: w.runId, status: step.status, stageIdx: step.stageIdx, step: step.step };
  return { kind: "events", events: processUpdated(recipients, run) };
}
