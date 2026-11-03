// CR-113 · hai luật "Toàn quyền" của duyệt HĐ trên engine (thuần, lớp 1 — chỉ builtin):
// (1) chủ gói (Group Toàn quyền) quyết được MỌI bước nhưng khi không phải người của bước (Group duyệt / người cụ thể / Group chuyển
//     cấp) thì ghi rõ "duyệt thay" (`owner_override`); (2) bước duyệt có hạn mà không đặt nhóm chuyển cấp ⇒ quá hạn tự chuyển cấp về
//     Group Toàn quyền (đặt tường minh vẫn thắng; bước không hạn ⇒ không chuyển cấp). Lượt đang chạy giữ snapshot (không đổi).
import { PACK_OWNER_GROUP_KEY } from "./approval-def.rules";

/** Cách người quyết bước có quyền: người của bước, hay chủ gói "duyệt thay". */
export type DecidedAs = "member" | "owner_override";
/** Loại sự kiện `contract_events` ghi lần "duyệt thay" (lịch sử/audit). */
export const OVERRIDE_EVENT = "approval_override";

/**
 * Group Toàn quyền theo thứ tự ưu tiên làm đích chuyển cấp mặc định: Group vai owner của gói (`contracts-owner`) trước, rồi Group
 * cấp 2 của cài đặt. `ids` = mã ⇒ id theo tenant (mã thiếu bị bỏ).
 */
export function escalateOrder(ids: ReadonlyMap<string, string>, level2Key: string): string[] {
  const out = [ids.get(PACK_OWNER_GROUP_KEY), ids.get(level2Key)].filter(
    (x): x is string => typeof x === "string" && x !== "",
  );
  return [...new Set(out)];
}

/**
 * Đích chuyển cấp mặc định của một bước duyệt: có `escalate_group_id` ⇒ null (giữ tường minh); không hạn (`due_h` vắng/≤ 0) ⇒ null;
 * còn lại ⇒ Group đầu tiên của `escalateTo` còn ở tenant và khác Group gắn task của bước (`group`).
 */
export function defaultEscalateOf(
  s: { due_h?: number | null; escalate_group_id?: string | null },
  group: string | null,
  escalateTo: readonly string[],
  groupIds: ReadonlySet<string>,
): string | null {
  if (s.escalate_group_id) return null;
  if (typeof s.due_h !== "number" || !(s.due_h > 0)) return null;
  return escalateTo.find((g) => g !== group && groupIds.has(g)) ?? null;
}

/** `after.escalate` của stage review: đặt tường minh thắng (`resolve` = kiểm Group còn ở tenant, ném khi thiếu); không đặt ⇒
 *  mặc định về Toàn quyền (`defaultEscalateOf`); không có ⇒ null. */
export function escalateOf(
  s: { due_h: number; escalate_group_id: string | null },
  c: { group: string; groupIds: ReadonlySet<string>; escalateTo: readonly string[] },
  resolve: (id: string) => string,
): { after_h: number; group_id: string } | null {
  if (s.escalate_group_id !== null)
    return { after_h: s.due_h, group_id: resolve(s.escalate_group_id) };
  const d = defaultEscalateOf(s, c.group, c.escalateTo, c.groupIds);
  return d ? { after_h: s.due_h, group_id: d } : null;
}

/** Khoá một lần "duyệt thay" đã ghi: task × người (khớp `contract_events` `task_id` + `actor_user_id`). */
export const overrideKey = (taskId: string, userId: string): string => `${taskId}:${userId}`;

/**
 * `decided_as` của bước đã quyết: có bản ghi "duyệt thay" của ĐÚNG task quyết gần nhất (`taskRef`) bởi ĐÚNG người quyết
 * (`deciderId`) ⇒ `owner_override` (bản ghi write-ahead của người bấm thua đua không tính); còn lại `member`. Quyết định CR-113
 * (review): owner quyết khi bước CHƯA chuyển cấp ⇒ duyệt thay; SAU khi bước đã chuyển cấp cho nhóm owner ⇒ owner là đích chuyển
 * cấp hợp lệ ⇒ `member` (engine không gắn cờ override ⇒ không có bản ghi).
 */
export function decidedAsOf(
  deciderId: string | null | undefined,
  taskRef: string | null | undefined,
  overrides: ReadonlySet<string>,
): DecidedAs | null {
  if (!deciderId) return null;
  return taskRef && overrides.has(overrideKey(taskRef, deciderId)) ? "owner_override" : "member";
}
