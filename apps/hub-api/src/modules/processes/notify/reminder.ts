// HUB-FR-112 · AC-H32 · HUB-BR-26 · PF3 · CR-093 · plan-addendum A9/A10 · TECH-DEBT #190 · nhắc task mở sau `REMIND_AFTER_H`.
// THEO TẬP: mỗi lô 100 task trong MỘT tx `system` = 2 câu SQL cố định (khoá + đặt `reminded_at` + người nhận; chèn notice +
// unread) — không lặp truy vấn từng task. `FOR UPDATE SKIP LOCKED` ⇒ nhiều Hub nhắc song song không trùng (#190).
// `remindOnce` = MỘT lượt xả: lặp lô tới khi lô < 100 hoặc hết ngân sách 60 s (A9); sự kiện phát SAU COMMIT mỗi lô, một
// pipeline Redis. Đồng hồ = seam `d.now` (SQL so với tham số, không `now()`).
import { withHubScope } from "@ai/db/hub-scope";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import { processNotice } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import { claimDueReminders, type NoticeRow, unreadKey, writeNotices } from "./batch.repo";
import { buildNotice } from "./notifier";
import { noticeRecipients } from "./notify.rules";

/** plan §11: mỗi lô ≤ 100 hàng. */
const REMINDER_BATCH = 100;
/** A9: một lượt xả tối đa 60 s rồi nhường lượt sau. */
const DRAIN_BUDGET_MS = 60_000;

/** Một lượt nhắc: trả tổng số task vừa nhắc (mọi lô). `processLoops:false` ⇒ test gọi qua `ProcessHandles.remindOnce`. */
export async function remindOnce(d: ProcessDeps): Promise<number> {
  const t0 = performance.now();
  let total = 0;
  for (;;) {
    const { n, more } = await remindBatch(d, REMINDER_BATCH);
    total += n;
    if (!more || n < REMINDER_BATCH || performance.now() - t0 >= DRAIN_BUDGET_MS) return total;
  }
}

async function remindBatch(d: ProcessDeps, limit: number): Promise<{ n: number; more: boolean }> {
  const now = d.now();
  const { count, more, events } = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const { tasks: due, more } = await claimDueReminders(tx, now, limit);
    if (due.length === 0) return { count: 0, more: false, events: [] as UserEvent[] };
    const rows: NoticeRow[] = [];
    for (const t of due) {
      for (const userId of noticeRecipients(t))
        rows.push({
          tenantId: t.tenantId,
          userId,
          processRunId: t.processRunId,
          taskId: t.taskId,
          payload: { process_name: t.processName, stage_name: t.stageName },
        });
    }
    const { inserted, unread } = await writeNotices(tx, "reminder", rows);
    const byTask = new Map(due.map((t) => [t.taskId, t]));
    const evs = inserted.flatMap((n) => {
      const t = byTask.get(n.row.taskId ?? "");
      if (!t) return [];
      return processNotice(n.userId, {
        notice: buildNotice(n, "reminder", {
          processRunId: t.processRunId,
          taskId: t.taskId,
          processName: t.processName,
          stageName: t.stageName,
        }),
        unread: unread.get(unreadKey(n.tenantId, n.userId)) ?? 1,
      });
    });
    return { count: due.length, more, events: evs };
  });
  await publishUserEvents(d.redis, events, d.log);
  return { n: count, more };
}
