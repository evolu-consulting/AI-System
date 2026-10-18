// HUB-FR-112 · HUB-FR-145 · CR-093 · plan-addendum A10/A11 · DM "Quy trình" theo lô cho vòng nền (`systemBatch`): MỘT câu
// chèn notice + unread (`writeNotices`), dựng `process.notice` cho từng notice chèn thật rồi `outbox.emit` — Redis phát
// SAU COMMIT, một pipeline (adapter `makeOutboxPublisher`). Lớp 2 chỉ đưa hàng, không thấy `UserEvent`.
import type { NoticeKind } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import type { NoticeMetaRow, Outbox } from "../../application/ports";
import { processNotice } from "../../core/events";
import { unreadKey, writeNotices } from "../../notify/batch.repo";
import { buildNotice } from "../../notify/notifier";

/** Chèn notice `kind` cho cả lô + sự kiện vào outbox; trả số notice chèn thật (user ngoài tenant hàng bị bỏ — T6c). */
export async function notifyMany(
  tx: Tx,
  outbox: Outbox,
  kind: NoticeKind,
  rows: readonly NoticeMetaRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { inserted, unread } = await writeNotices(tx, kind, rows);
  const events = inserted.flatMap((n) => {
    const m = n.row as NoticeMetaRow;
    return processNotice(n.userId, {
      notice: buildNotice(n, kind, {
        processRunId: m.processRunId,
        taskId: m.taskId,
        processName: m.processName,
        stageName: m.stageName,
        ...(m.group && { group: m.group }),
        ...(m.afterH !== undefined && { afterH: m.afterH }),
      }),
      unread: unread.get(unreadKey(n.tenantId, n.userId)) ?? 1,
    });
  });
  if (events.length > 0) outbox.emit({ kind: "user_events", events });
  return inserted.length;
}
