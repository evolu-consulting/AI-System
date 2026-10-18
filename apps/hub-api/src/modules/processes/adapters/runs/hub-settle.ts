// HUB-FR-129 · HUB-FR-130 · HUB-FR-146 · PC2-R13 · PC2-R16 · P-c2 plan §6.2, §6.4 · P-d2 T18s (tách từ `runs/apply-settle.ts`,
// không đổi hành vi): chuyển trạng thái stage Áp dùng chung cho launcher (không job: no_changes/branch_only/invalid) và
// driver (sau job): ghi `process_outputs` (`apply.md`, content inline — không blob) rồi `done` (stage done + join bước,
// finish ⇒ run done) hoặc `decision` (`toDecision`). Trong tx đã khoá `process_runs`; trả sự kiện (phát sau COMMIT) + cần
// `kick`. Không I/O ngoài DB.
import type { DecisionReason } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { UserEvent } from "../../../../lib/user-stream";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import type { ProcessDeps } from "../../core/ports";
import { enqueueThread } from "../../core/thread";
import type { RunState } from "../../domain/runs/run-state.rules";
import type { ApplyStage, LoadedHead } from "../../runs/apply-settle";
import { persistStage } from "../../runs/step-persist";
import { toDecision } from "../../runs/team-runner";

type Deps = Omit<ProcessDeps, "launcher" | "start">;

/** Không dùng khi `done` (persistStage bỏ qua `next`); chỉ thoả kiểu `StageWrite`. */
const DONE_NEXT: RunState = {
  status: "done",
  stageIdx: 0,
  stageCount: 1,
  stage: {
    status: "done",
    attempt: 1,
    attemptLimit: 1,
    asksCount: 0,
    askLimit: 0,
    after: "auto",
    hasOutput: true,
  },
  decisionReason: null,
};

/** Ghi `process_outputs` (content inline — stage Áp không blob/attachment) + trả id. */
export async function writeApplyOutput(
  tx: Tx,
  p: {
    tenantId: string;
    runId: string;
    stageRunId: string;
    stageIdx: number;
    attempt: number;
    md: string;
  },
): Promise<string> {
  const [v] = await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0) + 1 as v
    from hub.process_outputs where stage_run_id = ${p.stageRunId}`);
  const id = crypto.randomUUID();
  await tx.execute(sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx,
      version, attempt, content, template_ok, template_missing, round)
    values (${id}, ${p.tenantId}, ${p.runId}, ${p.stageRunId}, ${p.stageIdx}, ${Number(v?.v ?? 1)},
      ${p.attempt}, ${p.md}, true, '{}'::text[],
      (select round from hub.stage_runs where id = ${p.stageRunId}))`);
  return id;
}

export type ApplySettle = { kind: "done" } | { kind: "decision"; reason: DecisionReason };
export type SettleOut = { events: UserEvent[]; kick: boolean };

/**
 * Ghi output `apply.md` + chuyển trạng thái: `done` ⇒ stage done + join bước (finish ⇒ run done + `run_end`);
 * `decision` ⇒ needs_decision (task + thread + notifier). Trả sự kiện + cần `kick`.
 */
export async function settleApply(
  d: Deps,
  tx: Tx,
  p: { head: LoadedHead; stage: ApplyStage; md: string; outcome: ApplySettle },
): Promise<SettleOut> {
  const { id: runId, tenant_id: tenantId } = p.head;
  const idx = p.stage.stage_idx;
  const outputId = await writeApplyOutput(tx, {
    tenantId,
    runId,
    stageRunId: p.stage.id,
    stageIdx: idx,
    attempt: p.stage.attempt,
    md: p.md,
  });
  if (p.outcome.kind === "decision") {
    await tx.execute(sql`update hub.stage_runs set current_output_id = ${outputId}, updated_at = now()
      where id = ${p.stage.id} and tenant_id = ${tenantId}`);
    const events = await toDecision(d, tx, {
      runId,
      tenantId,
      idx,
      stageRunId: p.stage.id,
      reason: p.outcome.reason as DecisionReason,
    });
    return { events, kick: false };
  }
  return settleDone(d, tx, { runId, tenantId, stageRunId: p.stage.id, outputId });
}

/** `done`: stage done + join bước (finish ⇒ run done + `run_end`); trả sự kiện + cần `kick`. */
async function settleDone(
  d: Deps,
  tx: Tx,
  p: { runId: string; tenantId: string; stageRunId: string; outputId: string },
): Promise<SettleOut> {
  const { runId, tenantId } = p;
  const step = await persistStage(tx, {
    runId,
    tenantId,
    stageRunId: p.stageRunId,
    next: DONE_NEXT,
    done: true,
    outputId: p.outputId,
  });
  const recipients = await core.runRecipients(tx, runId, tenantId);
  const events: UserEvent[] = step
    ? processUpdated(recipients, {
        id: runId,
        status: step.status,
        stageIdx: step.stageIdx,
        step: step.step,
      })
    : [];
  if (step?.kind === "finish") {
    events.push(...(await d.notifier.runFinished(tx, runId)));
    await enqueueThread(tx, {
      runId,
      roomId: "",
      kind: "run_end",
      process_run_id: runId,
      status: "done",
      actor: null,
    });
  }
  return { events, kick: step?.kind === "next_step" };
}
