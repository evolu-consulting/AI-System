// HUB-FR-143 · HUB-FR-144 · HUB-BR-42 · PD-R11 · CA-R06 · plan §5–§6 · vòng hẹn giờ của `sweepOnce` (chạy ĐẦU TIÊN): MỘT
// câu chọn ≤ 100 hẹn tới hạn (scope `system`, index một phần `due_at` của hẹn mở, `FOR UPDATE SKIP LOCKED` chỉ giữ khoá trong tx
// chọn này, commit TRƯỚC khi bắn ⇒ KHÔNG ngăn hai Hub cùng nhặt một hẹn; đúng nhờ `fireTimer` kiểm lại sau khi khoá
// run/stage/timer, nên chỉ một lần bắn), rồi mỗi hẹn MỘT tx `sysUow.system(tenantId)` — bắn là đổi trạng thái theo run
// (khoá run → stage → timer, lọc `tenant_id` tường minh), không phải cập nhật hàng loạt. Lỗi một hàng ⇒ log, tiếp hàng khác.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../../lib/errors";
import { type FireCandidate, fireTimer } from "../../application/timers/fire-timer.usecase";
import type { ProcessBgDeps } from "../../core/ports";
import { failedTimerDueAt } from "../../domain/timers/timer.rules";
import { claimTx } from "../hub-uow";
import { type SnapshotStages, waitOriginalDue } from "./timer-origin";

/** Q10 · trần mỗi lượt (`SweepResult.timers` ≤ 100). */
export const TIMER_SWEEP_BATCH = 100;

const SYSTEM = { kind: "system" } as const;

export type DueTimer = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  stage_run_id: string;
};

/**
 * Một lượt: số hẹn đã BẮN (không tính hẹn bị bỏ/huỷ vì stage đã đổi hay run đã kết thúc).
 * CR-114 · TD #196 (đo PD-P01, evotest): mỗi hẹn ~60 câu SQL / ~8 tx, ~90% là `kick` launcher SAU COMMIT. CR-115 ⇒ mặc
 * định theo lô (`fireBatch` + `kickMany`, `docs/specs/cr115-batch-launch/tasks.md`); `timerBatch: false` = đường từng
 * hàng cũ dưới đây (seam test tương đương).
 */
export async function fireDueTimers(d: ProcessBgDeps): Promise<number> {
  const now = d.now();
  if (d.timerBatch !== false) return fireBatch(d, now);
  const due = await withHubScope(d.db, SYSTEM, (tx) => dueTimers(tx, now));
  let fired = 0;
  for (const t of due) if ((await fireOne(d, t, now)) === "fired") fired++;
  return fired;
}

/**
 * CR-115 · lô: MỘT tx `systemEach` — chọn ≤ 100 hẹn `FOR UPDATE SKIP LOCKED` (khoá GIỮ tới COMMIT ⇒ Hub kia bỏ qua hẹn
 * này, không cùng bắn), bắn mỗi hẹn trong SAVEPOINT (sắp theo run ⇒ thứ tự khoá run nhất quán), kick cả lô một lần sau
 * COMMIT (`kickMany`). Hẹn lỗi ⇒ savepoint ROLLBACK, chạy lại đường từng hàng (`fireOne`: lỗi nữa ⇒ log + lùi hạn).
 */
async function fireBatch(d: ProcessBgDeps, now: Date): Promise<number> {
  // ≤ FIRE_TXS tx song song, mỗi tx chọn ≤ 100/FIRE_TXS hẹn: SKIP LOCKED ⇒ các tx nhặt tập rời nhau (tổng ≤ 100/lượt).
  const per = Math.ceil(TIMER_SWEEP_BATCH / FIRE_TXS);
  const counts = await Promise.all(Array.from({ length: FIRE_TXS }, () => fireChunk(d, now, per)));
  return counts.reduce((a, n) => a + n, 0);
}

/** CR-115 · số tx bắn song song mỗi lượt (đo PD-P01: 1 tx ≈ 1,02 s/100; chia tx ⇒ round-trip bắn chạy song song). */
const FIRE_TXS = 4;

async function fireChunk(d: ProcessBgDeps, now: Date, limit: number): Promise<number> {
  const claim = async (t: Parameters<typeof claimTx>[0]) =>
    [...(await dueTimers(claimTx(t), now, limit))].sort(byRun);
  const rows = await d.sysUow.systemEach(
    claim,
    (t) => t.tenant_id,
    (r, t) => fireTimer(r, { id: t.id, runId: t.process_run_id, stageRunId: t.stage_run_id }, now),
  );
  let fired = 0;
  for (const x of rows) {
    const out = x.ok ? x.value : await fireOne(d, x.item, now);
    if (out === "fired") fired++;
  }
  return fired;
}

const byRun = (a: DueTimer, b: DueTimer): number =>
  a.process_run_id < b.process_run_id ? -1 : a.process_run_id > b.process_run_id ? 1 : 0;

/** Một hẹn: tx `system(tenantId)` riêng (bắn + kick sau COMMIT); lỗi ⇒ log + lùi hạn, không ném. */
async function fireOne(d: ProcessBgDeps, t: DueTimer, now: Date): Promise<string> {
  const c: FireCandidate = { id: t.id, runId: t.process_run_id, stageRunId: t.stage_run_id };
  try {
    return await d.sysUow.system(t.tenant_id, (r) => fireTimer(r, c, now));
  } catch (err) {
    d.log.warn("process-timer-fire-failed", {
      timer_id: t.id,
      run_id: t.process_run_id,
      ...safeErrorFields(err),
    });
    await postponeFailed(d, t, now);
    return "failed";
  }
}

type OpenTimer = {
  kind: string;
  due_at: string | Date;
  created_at: string | Date;
  timezone: string | null;
  stage_idx: number | null;
  snapshot: SnapshotStages | null;
};

/** Hạn GỐC của hẹn (R2-2/R2-3, không migration): `wait_until` dựng lại từ snapshot; `retry` ≈ `created_at`. */
async function originOf(tx: Tx, t: DueTimer, cur: OpenTimer): Promise<Date> {
  const dueAt = new Date(cur.due_at);
  if (cur.kind !== "wait_until")
    return new Date(Math.min(dueAt.getTime(), new Date(cur.created_at).getTime()));
  return waitOriginalDue(tx, t.tenant_id, {
    runId: t.process_run_id,
    snapshot: cur.snapshot ?? {},
    stageIdx: Number(cur.stage_idx ?? 0),
    timezone: cur.timezone ?? "UTC",
    dueAt,
  });
}

/** #4 · lùi `due_at` hẹn lỗi (không thì ≥ 100 hẹn lỗi liên tục chiếm đầu `limit 100`, hẹn khác đói). Lỗi ở đây ⇒ chỉ log. */
export async function postponeFailed(
  d: Pick<ProcessBgDeps, "db" | "log">,
  t: DueTimer,
  now: Date,
): Promise<void> {
  try {
    await withHubScope(d.db, SYSTEM, async (tx) => {
      const [cur] =
        await tx.execute<OpenTimer>(sql`select t.kind, t.due_at, t.created_at, t.timezone,
          s.stage_idx, r.snapshot
        from hub.process_timers t
        left join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
        left join hub.process_runs r on r.id = t.process_run_id and r.tenant_id = t.tenant_id
        where t.id = ${t.id} and t.tenant_id = ${t.tenant_id} and t.fired_at is null and t.cancelled_at is null`);
      if (!cur) return;
      const next = failedTimerDueAt(await originOf(tx, t, cur), now);
      await tx.execute(sql`update hub.process_timers set due_at = ${next.toISOString()}::timestamptz
        where id = ${t.id} and tenant_id = ${t.tenant_id} and fired_at is null and cancelled_at is null`);
    });
  } catch (err) {
    d.log.warn("process-timer-postpone-failed", { timer_id: t.id, ...safeErrorFields(err) });
  }
}

/** Ứng viên (văn bản câu cố định; `limit` là tham số — dùng chung cho làm nóng pool). */
function dueTimers(tx: Tx, now: Date, limit = TIMER_SWEEP_BATCH): Promise<DueTimer[]> {
  return tx.execute<DueTimer>(sql`
    select id, tenant_id, process_run_id, stage_run_id from hub.process_timers
    where fired_at is null and cancelled_at is null and due_at <= ${now.toISOString()}::timestamptz
    order by due_at limit ${limit}
    for update skip locked`);
}

/** CR-093 · làm nóng pool: cùng văn bản câu quét hẹn giờ, limit 0 (không khoá, không đọc hàng nào). */
export async function warmTimerSweep(tx: Tx): Promise<void> {
  await dueTimers(tx, new Date(0), 0);
}
