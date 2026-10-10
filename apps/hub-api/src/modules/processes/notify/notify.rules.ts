// HUB-FR-112 · AC-H32 · HUB-BR-26 · luật thuần PF3 (plan-contract §7): người nhận notice + task tới hạn nhắc. Không DB.
import type { TaskStatus } from "@ai/contracts/chat";

/**
 * Người nhận DM "Quy trình": hợp user assignee + thành viên group của task, bỏ trùng, loại `exclude` (vd người vừa thao
 * tác không cần tự báo). Thứ tự giữ ổn định (users trước, rồi member mới).
 */
export function noticeRecipients(
  t: { userIds: readonly string[]; groupMemberIds: readonly string[] },
  exclude?: string,
): string[] {
  const out = new Set<string>([...t.userIds, ...t.groupMemberIds]);
  if (exclude !== undefined) out.delete(exclude);
  return [...out];
}

/** Task còn mở, tới hạn (`remindAt ≤ now`) và chưa nhắc ⇒ nhắc (đúng 1 lần, HUB-BR-26). */
export function dueReminder(
  t: { status: TaskStatus; remindAt: Date; remindedAt: Date | null },
  now: Date,
): boolean {
  return t.status === "open" && t.remindedAt === null && t.remindAt.getTime() <= now.getTime();
}
