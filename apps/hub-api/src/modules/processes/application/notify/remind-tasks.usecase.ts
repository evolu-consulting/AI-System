// HUB-FR-112 · HUB-FR-145 · AC-H32 · AC-H42 · HUB-BR-26/43 · PF3 · CR-093 · plan §4.9 · plan-addendum A9/A10/A11 · TECH-DEBT
// #190 · use case lớp 2 vòng nhắc THEO TẬP: mỗi lô MỘT tx `systemBatch`, số câu cố định — nhắc ≤ 3 câu (khoá ứng viên +
// người nhận; áp mốc kế; chèn notice + unread), rồi chuyển cấp (`escalateBatch`, 1 câu khi không có hàng). Luật lớp 1
// (`dueReminder`/`nextRemind`/`noticeRecipients`) chạy trên mảng trong bộ nhớ. Một lượt xả = lặp lô tới khi lô < 100 /
// hết hàng / hết ngân sách 60 s (A9); sự kiện qua outbox ⇒ phát SAU COMMIT mỗi lô. Đồng hồ = tham số `now()` (seam).
import { dueReminder, nextRemind, noticeRecipients } from "../../domain/notify/remind.rules";
import type { BatchRepos, ClaimedReminder, NoticeMetaRow, ReminderMark, SystemUow } from "../ports";
import { escalateBatch } from "./escalate-task.usecase";

/** plan §11: mỗi lô ≤ 100 hàng. */
export const REMINDER_BATCH = 100;
/** A9: một lượt xả tối đa 60 s rồi nhường lượt sau. */
const DRAIN_BUDGET_MS = 60_000;

export type RemindDeps = { sysUow: SystemUow; now(): Date; elapsedMs(): number };

/** Một lượt nhắc: trả tổng số task vừa nhắc (mọi lô). */
export async function remindTasks(d: RemindDeps): Promise<number> {
  const t0 = d.elapsedMs();
  let total = 0;
  for (;;) {
    const now = d.now();
    const b = await d.sysUow.systemBatch((r) => remindBatch(r, now, REMINDER_BATCH));
    total += b.n;
    if (!b.more || d.elapsedMs() - t0 >= DRAIN_BUDGET_MS) return total;
  }
}

/** Một lô: nhắc rồi chuyển cấp trong cùng tx (A10). `more` = còn việc tới hạn ngoài lô (nhắc hoặc chuyển cấp). */
async function remindBatch(
  r: BatchRepos,
  now: Date,
  limit: number,
): Promise<{ n: number; more: boolean }> {
  const { tasks, more } = await r.reviewTasks.claimDueReminders(limit, now);
  const due = tasks.filter((t) => dueReminder({ ...t, status: "open" }, now));
  if (due.length > 0) {
    await r.reviewTasks.markRemindedMany(due.map(markOf), now);
    await r.notices.notifyMany("reminder", due.flatMap(noticeRows));
  }
  const esc = await escalateBatch(r, now, limit);
  return { n: due.length, more: (more && tasks.length >= limit) || esc.more };
}

/** Lặp ⇒ `nextRemind`; cũ ⇒ giữ `remindAt`/`remindCount` (chỉ đặt `reminded_at`). */
function markOf(t: ClaimedReminder): ReminderMark {
  const next =
    t.remindEveryH === null
      ? { remindAt: t.remindAt, remindCount: t.remindCount }
      : nextRemind({
          remindAt: t.remindAt,
          remindCount: t.remindCount,
          remindEveryH: t.remindEveryH,
        });
  return { taskId: t.taskId, tenantId: t.tenantId, ...next };
}

function noticeRows(t: ClaimedReminder): NoticeMetaRow[] {
  return noticeRecipients(t).map((userId) => ({
    tenantId: t.tenantId,
    userId,
    processRunId: t.processRunId,
    taskId: t.taskId,
    payload: { process_name: t.processName, stage_name: t.stageName },
    processName: t.processName,
    stageName: t.stageName,
  }));
}
