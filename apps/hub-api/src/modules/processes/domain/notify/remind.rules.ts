// HUB-FR-112 · HUB-FR-145 · AC-H32 · AC-H42 · HUB-BR-26 · PD-R18/R19 · luật thuần: người nhận notice + task tới hạn nhắc
// (một lần như cũ hoặc lặp mỗi `remind_every_h`). Không DB.
import { REMIND_AFTER_H, REMIND_MAX } from "../limits";
import type { TaskStatus } from "../types";

const HOUR_MS = 3_600_000;

/**
 * Người nhận DM "Quy trình": hợp user assignee + thành viên group của task, bỏ trùng, loại `exclude` (vd người vừa thao
 * tác không cần tự báo). Thứ tự giữ ổn định (users trước, rồi member mới).
 */
export function noticeRecipients(
  t: {
    userIds: readonly string[];
    groupMemberIds: readonly string[];
    /** approval-inbox · thành viên Group `also_group_ids` (nhóm chủ HĐ); vắng ⇒ hành vi cũ. */
    alsoMemberIds?: readonly string[];
  },
  exclude?: string,
): string[] {
  const out = new Set<string>([...t.userIds, ...t.groupMemberIds, ...(t.alsoMemberIds ?? [])]);
  if (exclude !== undefined) out.delete(exclude);
  return [...out];
}

/**
 * Cũ (`remindEveryH` null/vắng): task mở, chưa nhắc, `remindAt ≤ now` ⇒ nhắc đúng 1 lần (HUB-BR-26).
 * Lặp (`remindEveryH ≠ null`): task mở, `remindCount < REMIND_MAX`, `remindAt ≤ now` (PD-R18).
 */
export function dueReminder(
  t: {
    status: TaskStatus;
    remindAt: Date;
    remindedAt: Date | null;
    remindEveryH?: number | null;
    remindCount?: number;
  },
  now: Date,
): boolean {
  if (t.status !== "open" || t.remindAt.getTime() > now.getTime()) return false;
  if (t.remindEveryH === null || t.remindEveryH === undefined) return t.remindedAt === null;
  return (t.remindCount ?? 0) < REMIND_MAX;
}

/** Lần nhắc kế: `remindAt += N giờ`, `remindCount + 1` (PD-R19). */
export function nextRemind(t: { remindAt: Date; remindCount: number; remindEveryH: number }): {
  remindAt: Date;
  remindCount: number;
} {
  return {
    remindAt: new Date(t.remindAt.getTime() + t.remindEveryH * HOUR_MS),
    remindCount: t.remindCount + 1,
  };
}

/** Giá trị chép vào review_task khi tạo (snapshot, PD-R19). Không cấu hình ⇒ `remindAt = created + 24 h` như cũ. */
export function reviewTaskTiming(
  createdAt: Date,
  cfg: { remindEveryH: number | null; escalate: { afterH: number; groupId: string } | null },
): {
  remindAt: Date;
  remindEveryH: number | null;
  escalateAt: Date | null;
  escalateGroupId: string | null;
} {
  const t = createdAt.getTime();
  return {
    remindAt: new Date(t + (cfg.remindEveryH ?? REMIND_AFTER_H) * HOUR_MS),
    remindEveryH: cfg.remindEveryH,
    escalateAt: cfg.escalate ? new Date(t + cfg.escalate.afterH * HOUR_MS) : null,
    escalateGroupId: cfg.escalate ? cfg.escalate.groupId : null,
  };
}
