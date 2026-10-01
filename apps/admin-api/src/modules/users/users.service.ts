// ADM-FR-04, ADM-FR-05, ADM-FR-63 · nghiệp vụ users (plan M1 §5 "Users"). Không biết HTTP.
import type { Locale, User } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import type { UserRow } from "./users.repo";
import * as repo from "./users.repo";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toUser(u: UserRow): User {
  return {
    id: u.id,
    tenant_id: u.tenantId,
    tenant_key: u.tenantKey,
    username: u.username,
    display_name: u.displayName,
    email: u.email,
    role: u.role,
    locale: u.locale,
    status: !u.active || u.lockedByTenant ? "locked" : "active",
    active: u.active,
    locked_by_tenant: u.lockedByTenant,
    locked_until: iso(u.lockedUntil),
    must_change_password: u.mustChangePassword,
    last_login_at: iso(u.lastLoginAt),
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
    version: u.version,
  };
}

/** Dịch 23505 theo tên constraint (plan §5): username / email trùng trong tenant. */
export function mapUserConflict(err: unknown): never {
  const c = uniqueViolation(err);
  if (c === "users_tenant_username_uq") throw appError("USERNAME_TAKEN");
  if (c === "users_tenant_email_uq") throw appError("EMAIL_TAKEN");
  throw err;
}

async function insertAndRead(tx: Tx, u: repo.NewUser): Promise<User> {
  // Savepoint để lỗi 23505 không làm hỏng transaction ngoài trước khi dịch mã lỗi.
  const id = await tx.transaction((sp) => repo.insertUser(sp, u)).catch(mapUserConflict);
  const row = await repo.findUserRow(tx, u.tenantId, id);
  if (!row) throw new Error("users: không đọc lại được user vừa tạo");
  return toUser(row);
}

/** Tenant mới (FR-60): tenant_admin đầu tiên, `must_change_password=true`, cùng transaction với tenant. */
export function createFirstAdmin(
  tx: Tx,
  input: { tenantId: string; username: string; displayName: string; email: string; locale: Locale },
  passwordHash: string,
): Promise<User> {
  return insertAndRead(tx, {
    ...input,
    role: "tenant_admin",
    passwordHash,
    lockedByTenant: false,
  });
}

/** Khoá/mở khoá tenant (FR-61, M1-R10): đặt/gỡ `locked_by_tenant` cho user của tenant. */
export function setTenantLockFlags(tx: Tx, tenantId: string, locked: boolean): Promise<void> {
  return repo.setLockedByTenant(tx, tenantId, locked);
}
