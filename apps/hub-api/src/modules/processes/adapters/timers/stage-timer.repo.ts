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
import { type SnapshotStages, waitOriginalDue } from "./timer-origin";

export type RunFinishedNotifier = Pick<ProcessNotifier, "runFinished">;

type Head = {
  status: string;
  current_stage_idx: number;
  current_step: number;
  snapshot: SnapshotStages & { stages?: { name?: string; step?: number }[] };
};
type StageRow = { id: string; stage_idx: number; attempt: number; round: number };
type Ctx = { tx: Tx; tenantId: string; outbox: Outbox; notifier: RunFinishedNotifier };

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
  const c: Ctx = { tx, tenantId, outbox, notifier };
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
      const h = await head(c, runId);
      if (h) emit(c, await updated(c, runId, h));
    },
    finishWait: (runId, stageRunId, w) => finishWait(c, runId, stageRunId, w),
  };
}

async function head(c: Ctx, runId: string): Promise<Head | null> {
  const [h] = await c.tx.execute<Head>(sql`select status, current_stage_idx, current_step, snapshot
    from hub.process_runs where id = ${runId} and tenant_id = ${c.tenantId}`);
  return h ?? null;
}

async function updated(c: Ctx, runId: string, h: Head): Promise<UserEvent[]> {
  return processUpdated(await core.runRecipients(c.tx, runId, c.tenantId), {
    id: runId,
    status: h.status as ProcessRunStatus,
    stageIdx: Number(h.current_stage_idx),
    step: Number(h.current_step),
  });
}

function emit(c: Ctx, events: UserEvent[]): void {
  if (events.length > 0) c.outbox.emit({ kind: "user_events", events });
}

/** wait_until tới hạn: output .md (mốc gốc, R2-3) + stage `done` + sự kiện/kick/thread vào outbox. */
async function finishWait(
  c: Ctx,
  runId: string,
  stageRunId: string,
  w: { dueAt: Date; timezone: string },
): Promise<void> {
  const h = await head(c, runId);
  const s = await stageOf(c.tx, c.tenantId, runId, stageRunId);
  if (!h || !s) return;
  const name = h.snapshot.stages?.[s.stage_idx]?.name ?? "";
  // `due_at` có thể đã bị lùi (#4) ⇒ output in mốc cấu hình gốc, không in giờ đã lùi.
  const target = await waitOriginalDue(c.tx, c.tenantId, {
    runId,
    snapshot: h.snapshot,
    stageIdx: s.stage_idx,
    timezone: w.timezone,
    dueAt: w.dueAt,
  });
  const md = waitOutputMd(name, waitedText(target, w.timezone));
  const outputId = await insertOutput(c.tx, { tenantId: c.tenantId, runId, stage: s, md });
  const step = await persistStage(c.tx, {
    runId,
    tenantId: c.tenantId,
    stageRunId,
    next: DONE_NEXT,
    done: true,
    outputId,
  });
  await emitAfterWait(c, runId, step);
}

type WaitStep = Awaited<ReturnType<typeof persistStage>>;

/** Sự kiện + (finish: thông báo, thread `run_end`) / (next_step: kick) của stage chờ vừa xong — vào outbox. */
async function emitAfterWait(c: Ctx, runId: string, step: WaitStep): Promise<void> {
  const events: UserEvent[] = step
    ? processUpdated(await core.runRecipients(c.tx, runId, c.tenantId), {
        id: runId,
        status: step.status,
        stageIdx: step.stageIdx,
        step: step.step,
      })
    : [];
  if (step?.kind === "finish") {
    events.push(...(await c.notifier.runFinished(c.tx, runId)));
    await enqueueThread(c.tx, {
      runId,
      roomId: "",
      kind: "run_end",
      process_run_id: runId,
      status: "done",
      actor: null,
    });
    c.outbox.emit({ kind: "post_thread", runId });
  }
  emit(c, events);
  if (step?.kind === "next_step") c.outbox.emit({ kind: "kick", runId });
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
  o: { tenantId: string; runId: string; stage: StageRow; md: string },
): Promise<string> {
  const id = crypto.randomUUID();
  const { tenantId, runId, stage: s, md } = o;
  await tx.execute(sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx,
      version, attempt, content, template_ok, template_missing, round)
    select ${id}, ${tenantId}, ${runId}, ${s.id}, ${s.stage_idx}, coalesce(max(version), 0) + 1, ${s.attempt},
      ${md}, true, '{}'::text[], ${s.round}
    from hub.process_outputs where stage_run_id = ${s.id} and tenant_id = ${tenantId}`);
  return id;
}
