// HUB-FR-106 · HUB-BR-38(a) · P-b2 plan §3.3–3.4 (D2–D4) · ghi trạng thái MỘT stage rồi join bước: mọi chuyển bước
// (`next_step`, `finish`) và trạng thái run tổng hợp (`runStatusOf`) đi qua đây. Chạy TRONG tx đã khoá `process_runs`
// FOR UPDATE (plan §7); `stage_runs` cập nhật theo `stage_idx` tăng dần. Dùng chung stage-driver, gates, asks.
import type { ProcessRunStatus, StageRunStatus } from "@ai/contracts/chat";
import { resolveSteps } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { enqueueKhSummary } from "../../kh/kh.writes.repo";
import type { RunState } from "../domain/runs/run-state.rules";
import {
  firstIdxOfStep,
  runStatusOf,
  stageIdxsOfStep,
  statusForRun,
  stepJoin,
} from "../domain/runs/step.rules";

/** Kết quả sau ghi: `process_runs.status/current_step/current_stage_idx` mới. */
export type StepOutcome = {
  kind: "wait" | "next_step" | "finish";
  status: ProcessRunStatus;
  step: number;
  stageIdx: number;
};

/** Hàng `stage_runs` + `stage_idx` (D3: idx lấy từ `stage_run_id` của job/task, không từ `current_stage_idx`). */
export type StageRowIdx = {
  id: string;
  stage_idx: number;
  status: StageRunStatus;
  attempt: number;
  attempt_limit: number;
  asks_count: number;
  ask_limit: number;
  current_output_id: string | null;
  current_run_id: string | null;
};

export async function stageRowById(
  tx: Tx,
  runId: string,
  stageRunId: string,
  tenantId: string,
): Promise<StageRowIdx | null> {
  const [s] =
    await tx.execute<StageRowIdx>(sql`select id, stage_idx, status, attempt, attempt_limit,
    asks_count, ask_limit, current_output_id, current_run_id from hub.stage_runs
    where id = ${stageRunId} and process_run_id = ${runId} and tenant_id = ${tenantId}`);
  return s ? { ...s, stage_idx: Number(s.stage_idx) } : null;
}

/** Bước của từng stage theo snapshot (def cũ không `step` ⇒ mỗi stage một bước). */
export const stepsOfSnap = (snap: { stages?: readonly { step?: number }[] } | null): number[] =>
  resolveSteps(snap?.stages ?? []);

/** Hiệu ứng máy trạng thái "stage xong" (`advance`): stage ⇒ done rồi join (D1 — `transition` không biết bước). */
export const stageDoneOf = (effects: readonly string[]): boolean =>
  effects.includes("queue_next_stage") || effects.includes("finish_run");

export type StageWrite = {
  runId: string;
  tenantId: string;
  stageRunId: string;
  next: RunState;
  done: boolean;
  /** Output vừa ghi: done ⇒ ghim `current_output_id`; chưa done ⇒ chỉ ghim khi `next.stage.hasOutput`. */
  outputId?: string | null;
};

/** Ghi stage theo `next.stage` (hoặc `done`) rồi `settleStep`. */
export async function persistStage(tx: Tx, w: StageWrite): Promise<StepOutcome | null> {
  if (w.done) {
    await tx.execute(sql`update hub.stage_runs set status = 'done',
        current_output_id = ${w.outputId ?? sql`current_output_id`}, finished_at = now(), updated_at = now()
      where id = ${w.stageRunId} and tenant_id = ${w.tenantId}`);
    // K1 · D8 · HUB-FR-133 · auto / gate Đạt / người cho qua ⇒ hàng chờ ghi `## Tóm tắt` (savepoint, lỗi ⇒ warn).
    await enqueueKhSummary(tx, { tenantId: w.tenantId, stageRunId: w.stageRunId });
  } else {
    const n = w.next.stage;
    const keep = w.outputId && n.hasOutput ? w.outputId : null;
    await tx.execute(sql`update hub.stage_runs set status = ${n.status}, attempt = ${n.attempt},
        attempt_limit = ${n.attemptLimit}, asks_count = ${n.asksCount}, ask_limit = ${n.askLimit},
        current_output_id = ${keep ?? sql`current_output_id`}, updated_at = now()
      where id = ${w.stageRunId} and tenant_id = ${w.tenantId}`);
  }
  return settleStep(tx, w.runId, w.tenantId);
}

type StepHead = {
  current_step: number;
  snapshot: { stages?: { step?: number; executor?: { kind: string } }[] } | null;
};

/**
 * Join bước hiện tại trên trạng thái SAU ghi (D2/D4): mọi stage done ⇒ bước kế `queued` (hoặc run `done`); còn lại ⇒
 * `process_runs.status = runStatusOf(bước)`. `current_stage_idx` luôn = stage nhỏ nhất của bước hiện tại.
 */
export async function settleStep(
  tx: Tx,
  runId: string,
  tenantId: string,
): Promise<StepOutcome | null> {
  const [h] = await tx.execute<StepHead>(sql`select current_step, snapshot from hub.process_runs
    where id = ${runId} and tenant_id = ${tenantId}`);
  if (!h) return null;
  const steps = stepsOfSnap(h.snapshot);
  const step = Number(h.current_step);
  const rows = await tx.execute<{ stage_idx: number; status: StageRunStatus }>(sql`select stage_idx,
    status from hub.stage_runs where process_run_id = ${runId} and tenant_id = ${tenantId}`);
  const statuses = new Map(rows.map((r) => [Number(r.stage_idx), r.status] as const));
  const j = stepJoin({ steps, step, statuses });
  if (j.kind === "next_step") return nextStep(tx, { runId, tenantId }, steps, j);
  const first = firstIdxOfStep(steps, step);
  if (j.kind === "finish") {
    await tx.execute(sql`update hub.process_runs set status = 'done', current_stage_idx = ${first},
      finished_at = now(), updated_at = now() where id = ${runId} and tenant_id = ${tenantId}`);
    return { kind: "finish", status: "done", step, stageIdx: first };
  }
  // PD-R15 · loại hẹn suy từ executor (stage `wait_until` không bao giờ thử lại; stage khác không hẹn `wait_until`).
  const kindOf = (i: number) =>
    h.snapshot?.stages?.[i]?.executor?.kind === "wait_until" ? "wait_until" : "retry";
  const agg = runStatusOf(
    stageIdxsOfStep(steps, step).map((i) => statusForRun(statuses.get(i) ?? "pending", kindOf(i))),
  );
  const status: ProcessRunStatus = agg === "step_done" ? "running" : agg;
  await tx.execute(sql`update hub.process_runs set status = ${status}, current_stage_idx = ${first},
    updated_at = now() where id = ${runId} and tenant_id = ${tenantId}`);
  return { kind: "wait", status, step, stageIdx: first };
}

async function nextStep(
  tx: Tx,
  r: { runId: string; tenantId: string },
  steps: readonly number[],
  j: { step: number; queue: number[] },
): Promise<StepOutcome> {
  const { runId, tenantId } = r;
  const first = firstIdxOfStep(steps, j.step);
  const ids = sql.join(
    j.queue.map((i) => sql`${i}`),
    sql`, `,
  );
  await tx.execute(sql`update hub.stage_runs set status = 'queued', updated_at = now()
    where process_run_id = ${runId} and tenant_id = ${tenantId} and stage_idx in (${ids})`);
  await tx.execute(sql`update hub.process_runs set status = 'running', current_step = ${j.step},
    current_stage_idx = ${first}, updated_at = now() where id = ${runId} and tenant_id = ${tenantId}`);
  return { kind: "next_step", status: "running", step: j.step, stageIdx: first };
}
