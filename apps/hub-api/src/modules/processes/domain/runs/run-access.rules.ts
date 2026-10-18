// HUB-BR-25 · HUB-FR-105 · M1 · M5 · U5 · quyền xem / thao tác run quy trình (plan §5, plan-contract §7). Thuần.
// `originRoom` tính theo NGƯỜI XEM: `member` = đang là thành viên phòng nguồn, `outside` = không (kể cả đã rời).
import type { DecisionReason } from "../types";

export type Viewer = {
  userId: string;
  tenantId: string;
  role: "platform_admin" | "tenant_admin" | "member";
};
export type RunFacts = {
  tenantId: string;
  startedBy: string;
  originRoom: "none" | "deleted" | "member" | "outside";
  taskAssignee: boolean;
};
export type RunAccess = "full" | "task";

const sameTenant = (v: Viewer, r: RunFacts): boolean => v.tenantId === r.tenantId;
const isAdmin = (v: Viewer, r: RunFacts): boolean =>
  v.role === "platform_admin" || (v.role === "tenant_admin" && sameTenant(v, r));
const isStarter = (v: Viewer, r: RunFacts): boolean => sameTenant(v, r) && v.userId === r.startedBy;

/** null ⇒ 404 (không lộ tồn tại). Người bắt đầu đã rời phòng (`outside`) ⇒ `task` (U5); phòng xoá/gốc admin
 * (`deleted`/`none`) ⇒ `full` (không còn phòng để cổng). View dùng definer `hub.process_run_viewer` (phân biệt
 * `outside` vs `deleted` xuyên RLS); rule thuần này giữ cho test đơn vị + nhánh 404/403 của gates. */
export function runAccess(v: Viewer, r: RunFacts | null): RunAccess | null {
  if (!r) return null;
  if (isAdmin(v, r)) return "full";
  if (!sameTenant(v, r)) return null;
  if (r.originRoom === "member") return "full";
  if (isStarter(v, r)) return r.originRoom === "outside" ? "task" : "full";
  return r.taskAssignee ? "task" : null;
}

/** U5 · đọc thread phòng = đang là thành viên phòng nguồn (RLS `is_room_member`); admin ngoài phòng ⇒ false. */
export function canReadThread(v: Viewer, r: RunFacts): boolean {
  return sameTenant(v, r) && r.originRoom === "member";
}

/** Người bắt đầu (kể cả đã rời phòng, U5) ∨ tenant_admin cùng tenant ∨ platform_admin. */
export function canCancel(v: Viewer, r: RunFacts): boolean {
  return isStarter(v, r) || isAdmin(v, r);
}

/** Lý do mà Group duyệt của stage cũng được quyết (người quyết như `redo_limit` — P-b2 D8). */
export const REVIEW_GROUP_REASONS: ReadonlySet<DecisionReason> = new Set([
  "redo_limit",
  "back_limit",
]);

/** M5 · như `canCancel`; thêm thành viên Group duyệt khi lý do `redo_limit` / `back_limit` (P-b2 D8). */
export function canDecide(
  v: Viewer,
  r: RunFacts & { reason: DecisionReason; reviewGroupMember: boolean },
): boolean {
  if (canCancel(v, r)) return true;
  return REVIEW_GROUP_REASONS.has(r.reason) && r.reviewGroupMember && sameTenant(v, r);
}

/** M1 · user active, quy trình bật + chưa xoá, run group rỗng (cả công ty) hoặc user thuộc ≥ 1 group. */
export function canRun(
  u: { active: boolean; groupIds: ReadonlySet<string> },
  d: { enabled: boolean; deleted: boolean; runGroupIds: readonly string[] },
): boolean {
  if (!u.active || !d.enabled || d.deleted) return false;
  return d.runGroupIds.length === 0 || d.runGroupIds.some((g) => u.groupIds.has(g));
}
