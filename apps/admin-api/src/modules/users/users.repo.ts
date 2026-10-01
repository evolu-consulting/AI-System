// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-NFR-07 · truy vấn users. Luôn trong withScope (RLS) và lọc tenant_id tường minh.
import type { Locale, Role } from "@ai/contracts";
import { type Tx, tenants, users } from "@ai/db";
import { and, eq, sql } from "drizzle-orm";

export type UserRow = {
  id: string;
  tenantId: string;
  tenantKey: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  locale: Locale;
  active: boolean;
  lockedByTenant: boolean;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export const userRowCols = {
  id: users.id,
  tenantId: users.tenantId,
  tenantKey: tenants.key,
  username: users.username,
  displayName: users.displayName,
  email: users.email,
  role: users.role,
  locale: users.locale,
  active: users.active,
  lockedByTenant: users.lockedByTenant,
  lockedUntil: users.lockedUntil,
  mustChangePassword: users.mustChangePassword,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  version: users.version,
};

/** `tenantId` null = mọi tenant (chỉ platform scope, RLS vẫn áp). */
export async function findUserRow(
  tx: Tx,
  tenantId: string | null,
  id: string,
): Promise<UserRow | null> {
  const where = tenantId ? and(eq(users.tenantId, tenantId), eq(users.id, id)) : eq(users.id, id);
  const [row] = await tx
    .select(userRowCols)
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(where)
    .limit(1);
  return (row as UserRow | undefined) ?? null;
}

export type NewUser = {
  tenantId: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  locale: Locale;
  passwordHash: string;
  lockedByTenant: boolean;
};

/** Luôn `must_change_password=true` (M1-R17). 23505 do service dịch theo tên constraint. */
export async function insertUser(tx: Tx, u: NewUser): Promise<string> {
  const id = Bun.randomUUIDv7();
  await tx.insert(users).values({ id, ...u, mustChangePassword: true });
  return id;
}

/** Khoá tenant: user đang active → locked_by_tenant (M1-R10). Mở khoá: chỉ gỡ cờ này. */
export async function setLockedByTenant(tx: Tx, tenantId: string, locked: boolean): Promise<void> {
  const cond = locked
    ? and(eq(users.tenantId, tenantId), eq(users.active, true), eq(users.lockedByTenant, false))
    : and(eq(users.tenantId, tenantId), eq(users.lockedByTenant, true));
  await tx
    .update(users)
    .set({ lockedByTenant: locked, version: sql`${users.version} + 1`, updatedAt: sql`now()` })
    .where(cond);
}
