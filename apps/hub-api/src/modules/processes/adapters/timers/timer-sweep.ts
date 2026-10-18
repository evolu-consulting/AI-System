// HUB-FR-143 · HUB-FR-144 · HUB-BR-42 · PD-R11 · CA-R06 · plan §5–§6 · vòng hẹn giờ của `sweepOnce` (chạy ĐẦU TIÊN): MỘT
// câu chọn ≤ 100 hẹn tới hạn (scope `system`, index một phần `due_at` của hẹn mở, `FOR UPDATE SKIP LOCKED` ⇒ instance
// khác đang bắn hàng đó thì bỏ qua), rồi mỗi hẹn MỘT tx `sysUow.system(tenantId)` — bắn là đổi trạng thái theo run
// (khoá run → stage → timer, lọc `tenant_id` tường minh), không phải cập nhật hàng loạt. Lỗi một hàng ⇒ log, tiếp hàng khác.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../../lib/errors";
import { type FireCandidate, fireTimer } from "../../application/timers/fire-timer.usecase";
import type { ProcessBgDeps } from "../../core/ports";

/** Q10 · trần mỗi lượt (`SweepResult.timers` ≤ 100). */
export const TIMER_SWEEP_BATCH = 100;

const SYSTEM = { kind: "system" } as const;

type DueTimer = { id: string; tenant_id: string; process_run_id: string; stage_run_id: string };

/** Một lượt: số hẹn đã BẮN (không tính hẹn bị bỏ/huỷ vì stage đã đổi hay run đã kết thúc). */
export async function fireDueTimers(d: ProcessBgDeps): Promise<number> {
  const now = d.now();
  const due = await withHubScope(d.db, SYSTEM, (tx) => dueTimers(tx, now));
  let fired = 0;
  for (const t of due) {
    const c: FireCandidate = { id: t.id, runId: t.process_run_id, stageRunId: t.stage_run_id };
    try {
      const out = await d.sysUow.system(t.tenant_id, (r) => fireTimer(r, c, now));
      if (out === "fired") fired++;
    } catch (err) {
      d.log.warn("process-timer-fire-failed", {
        timer_id: t.id,
        run_id: t.process_run_id,
        ...safeErrorFields(err),
      });
    }
  }
  return fired;
}

/** Ứng viên (văn bản câu cố định; `limit` là tham số — dùng chung cho làm nóng pool). */
function dueTimers(tx: Tx, now: Date, limit = TIMER_SWEEP_BATCH): Promise<DueTimer[]> {
  return tx.execute<DueTimer>(sql`
    select id, tenant_id, process_run_id, stage_run_id from hub.process_timers
    where fired_at is null and cancelled_at is null and due_at <= ${now.toISOString()}::timestamptz
    order by due_at limit ${limit}
    for update skip locked`);
}
