// CHAT-AC-55 · PF3: ánh xạ thuần cho DM "Quy trình" và "Chờ tôi kiểm" (khoá i18n, phân nhóm ngày). Không I/O.
import {
  NOTICE_KINDS,
  type NoticeKind,
  type ProcessNotice,
  type TaskKind,
} from "@ai/contracts/chat";

/** Khoá tiêu đề thẻ thông báo theo `kind` (phụ lục i18n §6). */
export const noticeTitleKey = (kind: NoticeKind): string => `process.inbox.notice.${kind}`;

/** Khoá phụ đề loại việc trong "Chờ tôi kiểm" (Kiểm / Trả lời / Quyết định). */
export const todoKindKey = (kind: TaskKind): string => `process.inbox.kind.${kind}`;

/** `kind` gắn với một việc có thể xử lý ngay trong thẻ (khi task còn mở). */
const TASK_NOTICE_KINDS = new Set<NoticeKind>([
  "review_requested",
  "ask_requested",
  "decision_requested",
  "reminder",
  "escalated",
]);

/** Thẻ có thể mở `TaskPanel` (cần `task_id` + `kind` gắn việc). */
export const noticeHasTask = (n: Pick<ProcessNotice, "kind" | "task_id">): boolean =>
  n.task_id !== null && TASK_NOTICE_KINDS.has(n.kind);

/** Mọi `NoticeKind` phải có khoá i18n (test chốt). */
export const ALL_NOTICE_KINDS: readonly NoticeKind[] = NOTICE_KINDS;

/** Ngày địa phương `YYYY-MM-DD` để chia nhóm `log` theo ngày. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
