// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-BR-05, ADM-BR-08, ADM-BR-09 · luật users dạng hàm thuần (plan M1 §4).
import type { ErrorCode } from "@ai/contracts";

export type Role = "platform_admin" | "tenant_admin" | "member";
export type Actor = { userId: string; tenantId: string; role: Role };
export type RuleError = { code: ErrorCode; details?: unknown };

const err = (code: ErrorCode, details?: unknown): RuleError =>
  details === undefined ? { code } : { code, details };

export function isAdminRole(role: Role): boolean {
  return role === "platform_admin" || role === "tenant_admin";
}

export function canManageUsers(actor: Actor): boolean {
  return actor.role !== "member";
}

/** tenant_admin: luôn tenant mình; platform: query ?? null (null = mọi tenant, chỉ hợp lệ khi đọc). */
export function resolveTenantScope(
  actor: Actor,
  queryTenantId: string | undefined,
  op: "read" | "write",
): { tenantId: string | null } | RuleError {
  if (actor.role !== "platform_admin") return { tenantId: actor.tenantId };
  if (queryTenantId) return { tenantId: queryTenantId };
  return op === "write" ? err("TENANT_REQUIRED") : { tenantId: null };
}

/** false → 404 (cùng body với id không tồn tại, M1-R13). */
export function canSeeUser(actor: Actor, target: { tenantId: string }): boolean {
  return actor.role === "platform_admin" || target.tenantId === actor.tenantId;
}

/** Tenant `platform` ⇔ role platform_admin; tenant_admin không gán platform_admin (M1-R12). */
export function checkRoleAssignment(
  actor: Actor,
  tenantIsPlatform: boolean,
  role: Role,
): RuleError | null {
  if (actor.role !== "platform_admin" && role === "platform_admin") return err("ROLE_NOT_ALLOWED");
  if (tenantIsPlatform !== (role === "platform_admin")) return err("ROLE_NOT_ALLOWED");
  return null;
}

/** Thứ tự (plan §10 G2): tự đổi role → SELF_ACTION_FORBIDDEN; rồi đổi role của platform_admin → ROLE_NOT_ALLOWED. */
export function checkRoleChange(
  actor: Actor,
  target: { id: string; role: Role },
  next: Role,
): RuleError | null {
  if (next === target.role) return null;
  if (actor.userId === target.id) return err("SELF_ACTION_FORBIDDEN");
  if (target.role === "platform_admin") return err("ROLE_NOT_ALLOWED");
  return null;
}

export function checkSelfAction(
  actor: Actor,
  targetId: string,
  _action: "lock" | "reset_password",
): RuleError | null {
  return actor.userId === targetId ? err("SELF_ACTION_FORBIDDEN") : null;
}

export function isEmailRequired(role: Role): boolean {
  return role === "tenant_admin";
}

/** BR-08: thay đổi làm target thôi là admin đang hoạt động và không còn admin cùng phạm vi → LAST_ADMIN {scope}. */
export function checkLastAdmin(
  target: { role: Role; active: boolean },
  change: { active?: boolean; role?: Role },
  otherActiveAdminsInScope: number,
): RuleError | null {
  if (!isAdminRole(target.role) || !target.active) return null;
  const staysActive = change.active ?? true;
  const staysRole = (change.role ?? target.role) === target.role;
  if (staysActive && staysRole) return null;
  if (otherActiveAdminsInScope > 0) return null;
  return err("LAST_ADMIN", { scope: target.role === "platform_admin" ? "platform" : "tenant" });
}

export function userStatus(u: { active: boolean; lockedByTenant: boolean }): "active" | "locked" {
  return !u.active || u.lockedByTenant ? "locked" : "active";
}

const VERSIONED_FIELDS = new Set([
  "display_name",
  "email",
  "role",
  "locale",
  "active",
  "locked_by_tenant",
  "must_change_password",
  "name",
  "max_concurrent_sub",
]);

/** Trường nào đổi thì tăng version (spec §3); bộ đếm đăng nhập thì không. */
export function bumpsVersion(changedFields: readonly string[]): boolean {
  return changedFields.some((f) => VERSIONED_FIELDS.has(f));
}
