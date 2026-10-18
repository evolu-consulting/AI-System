// HUB-FR-143 · HUB-FR-144 · PD-R11/R15 · K1/K3 · plan §4.6 (Bắn), §6 · `StageTimerRepo` gắn tx + `tenantId` của UoW: khoá
// stage của hẹn (SAU run, TRƯỚC timer), `requeue` (retry) và `finishWait` (wait_until: .md "Đã chờ tới …" + stage `done` +
// join bước như P-b2). MỌI câu lọc `tenant_id` kể cả scope system. Sự kiện/kick/thread vào outbox (phát SAU COMMIT).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { UserEvent } from "../../../../lib/user-stream";
import type { Outbox, StageTimerRepo } from "../../application/ports";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import type { ProcessNotifier } from "../../core/ports";
import { enqueueThread } from "../../core/thread";
import type { RunState } from "../../domain/runs/run-state.rules";
import { waitedText, waitOutputMd } from "../../domain/timers/due-at.rules";
import type { ProcessRunStatus, StageRunStatus } from "../../domain/types";
import { persistStage } from "../../runs/step-persist";

export type RunFinishedNotifier = Pick<ProcessNotifier, "runFinished">;

type Head = {
  status: string;
  current_stage_idx: number;
  current_step: number;
  snapshot: { stages?: { name?: string; step?: number }[] };
};
type StageRow = { id: string; stage_idx: number; attempt: number; round: number };

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

export function stageTimerRepo(
  tx: Tx,
  tenantId: string,
  outbox: Outbox,
  notifier: RunFinishedNotifier,
): StageTimerRepo {
  const head = async (runId: string): Promise<Head | null> => {
    const [h] = await tx.execute<Head>(sql`select status, current_stage_idx, current_step, snapshot
      from hub.process_runs where id = ${runId} and tenant_id = ${tenantId}`);
    return h ?? null;
  };
  const updated = async (runId: string, h: Head): Promise<UserEvent[]> =>
    processUpdated(await core.runRecipients(tx, runId, tenantId), {
      id: runId,
      status: h.status as ProcessRunStatus,
      stageIdx: Number(h.current_stage_idx),
      step: Number(h.current_step),
    });
  const emit = (events: UserEvent[]) => {
    if (events.length > 0) outbox.emit({ kind: "user_events", events });
  };
  return {
    async lockStage(runId, stageRunId) {
      const [s] = await tx.execute<{ id: string; status: StageRunStatus }>(sql`
        select id, status from hub.stage_runs
        where id = ${stageRunId} and process_run_id = ${runId} and tenant_id = ${tenantId} for update`);
      return s ?? null;
    },
    async requeue(runId, stageRunId, now) {
      await tx.execute(sql`update hub.stage_runs set status = 'queued', current_run_id = null,
          updated_at = ${now.toISOString()}::timestamptz
        where id = ${stageRunId} and process_run_id = ${runId} and tenant_id = ${tenantId}`);
      const h = await head(runId);
      if (h) emit(await updated(runId, h));
    },
    async finishWait(runId, stageRunId, w) {
      const h = await head(runId);
      const s = await stageOf(tx, tenantId, runId, stageRunId);
      if (!h || !s) return;
      const name = h.snapshot.stages?.[s.stage_idx]?.name ?? "";
      const outputId = await insertOutput(
        tx,
        tenantId,
        runId,
        s,
        waitOutputMd(name, waitedText(w.dueAt, w.timezone)),
      );
      const step = await persistStage(tx, {
        runId,
        tenantId,
        stageRunId,
        next: DONE_NEXT,
        done: true,
        outputId,
      });
      const events: UserEvent[] = step
        ? processUpdated(await core.runRecipients(tx, runId, tenantId), {
            id: runId,
            status: step.status,
            stageIdx: step.stageIdx,
            step: step.step,
          })
        : [];
      if (step?.kind === "finish") {
        events.push(...(await notifier.runFinished(tx, runId)));
        await enqueueThread(tx, {
          runId,
          roomId: "",
          kind: "run_end",
          process_run_id: runId,
          status: "done",
          actor: null,
        });
        outbox.emit({ kind: "post_thread", runId });
      }
      emit(events);
      if (step?.kind === "next_step") outbox.emit({ kind: "kick", runId });
    },
  };
}

async function stageOf(
  tx: Tx,
  tenantId: string,
  runId: string,
  stageRunId: string,
): Promise<StageRow | null> {
  const [s] =
    await tx.execute<StageRow>(sql`select id, stage_idx, attempt, round from hub.stage_runs
    where id = ${stageRunId} and process_run_id = ${runId} and tenant_id = ${tenantId}`);
  return s ? { ...s, stage_idx: Number(s.stage_idx) } : null;
}

/** Output .md Hub sinh (content inline, như stage Áp — không blob/attachment); trả id. */
async function insertOutput(
  tx: Tx,
  tenantId: string,
  runId: string,
  s: StageRow,
  md: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await tx.execute(sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx,
      version, attempt, content, template_ok, template_missing, round)
    select ${id}, ${tenantId}, ${runId}, ${s.id}, ${s.stage_idx}, coalesce(max(version), 0) + 1, ${s.attempt},
      ${md}, true, '{}'::text[], ${s.round}
    from hub.process_outputs where stage_run_id = ${s.id} and tenant_id = ${tenantId}`);
  return id;
}
