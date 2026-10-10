// HUB-FR-112 · AC-H32 · HUB-BR-26 · PF3 · nhắc task mở sau `REMIND_AFTER_H` (plan §4 hàng nhắc, plan-contract §7.1
// `remindOnce`). Scope `system` (vòng nền mọi tenant); chèn notice `reminder` + đặt `reminded_at` (đúng 1 lần) rồi phát
// `process.notice` SAU COMMIT. Đồng hồ = seam `d.now` (SQL so với tham số, không `now()`). Vòng 5 phút ở `processes.mount`.
import { withHubScope } from "@ai/db/hub-scope";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import { processNotice } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import {
  dueTasks,
  groupMemberIds,
  insertNotices,
  markReminded,
  taskAssigneeUserIds,
  unreadByUser,
} from "./inbox.repo";
import { buildNotice } from "./notifier";
import { noticeRecipients } from "./notify.rules";

/** plan §11: mỗi vòng ≤ 100 hàng. */
const REMINDER_BATCH = 100;

/**
 * Một lượt nhắc: trả số task vừa nhắc. `processLoops:false` ⇒ test gọi qua `ProcessHandles.remindOnce`. Gom sự kiện trong
 * tx, phát sau COMMIT (retry 40P01 không phát đôi — tx chỉ làm việc DB).
 */
export async function remindOnce(d: ProcessDeps): Promise<number> {
  const now = d.now();
  const { count, events } = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const due = await dueTasks(tx, now, REMINDER_BATCH);
    const evs: UserEvent[] = [];
    for (const t of due) {
      const userIds = await taskAssigneeUserIds(tx, t.tenantId, t.taskId);
      const members = t.groupId ? await groupMemberIds(tx, t.tenantId, t.groupId) : [];
      const recipients = noticeRecipients({ userIds, groupMemberIds: members });
      await markReminded(tx, t.taskId, now);
      if (recipients.length === 0) continue;
      const inserted = await insertNotices(tx, {
        tenantId: t.tenantId,
        kind: "reminder",
        processRunId: t.processRunId,
        taskId: t.taskId,
        payload: { process_name: t.processName, stage_name: t.stageName },
        userIds: recipients,
      });
      const unread = await unreadByUser(tx, t.tenantId, recipients);
      const meta = {
        processRunId: t.processRunId,
        taskId: t.taskId,
        processName: t.processName,
        stageName: t.stageName,
      };
      for (const n of inserted)
        evs.push(
          ...processNotice(n.userId, {
            notice: buildNotice(n, "reminder", meta),
            unread: unread.get(n.userId) ?? 1,
          }),
        );
    }
    return { count: due.length, events: evs };
  });
  await publishUserEvents(d.redis, events, d.log);
  return count;
}
