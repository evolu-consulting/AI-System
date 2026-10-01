// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-NFR-07 · truy vấn users. Luôn trong withScope (RLS) và lọc tenant_id tường minh.
import type { Locale, Role } from "@ai/contracts";
import { type Tx, tenants, users } from "@ai/db";
import { and, asc, eq, ilike, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";

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

export type UserFilter = {
  tenantId: string | null;
  q?: string;
  role?: Role;
  status?: "active" | "locked";
  login?: "never";
  limit: number;
  offset: number;
};

const isLocked = sql`(not ${users.active} or ${users.lockedByTenant})`;

/** Điều kiện chung của list và `counts` (trừ `status`). */
function baseWhere(f: UserFilter): SQL | undefined {
  const q = f.q ? likeArg(f.q) : undefined;
  return and(
    f.tenantId ? eq(users.tenantId, f.tenantId) : undefined,
    q
      ? or(ilike(users.username, q), ilike(users.displayName, q), ilike(users.email, q))
      : undefined,
    f.role ? eq(users.role, f.role) : undefined,
    f.login === "never" ? isNull(users.lastLoginAt) : undefined,
  );
}

export async function listUsers(tx: Tx, f: UserFilter) {
  const status = f.status ? (f.status === "locked" ? isLocked : sql`not ${isLocked}`) : undefined;
  const rows = await tx
    .select({ ...userRowCols, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(baseWhere(f), status))
    .orderBy(asc(users.username), asc(users.id))
    .limit(f.limit)
    .offset(f.offset);
  const [c] = await tx
    .select({
      all: sql<number>`count(*)`.mapWith(Number),
      active: sql<number>`count(*) filter (where not ${isLocked})`.mapWith(Number),
      locked: sql<number>`count(*) filter (where ${isLocked})`.mapWith(Number),
    })
    .from(users)
    .where(baseWhere(f));
  return {
    rows: rows as (UserRow & { total: number })[],
    counts: c ?? { all: 0, active: 0, locked: 0 },
  };
}

export type TenantBrief = { id: string; key: string; active: boolean };

/** `forUpdate`: khoá hàng tenant để kiểm BR-08 tuần tự (hai admin khoá nhau cùng lúc). */
export async function findTenantBrief(tx: Tx, tenantId: string, o: { forUpdate?: boolean } = {}) {
  const q = tx
    .select({ id: tenants.id, key: tenants.key, active: tenants.active })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const [row] = o.forUpdate ? await q.for("update") : await q;
  return (row as TenantBrief | undefined) ?? null;
}

/** Admin active khác target trong cùng phạm vi (BR-08): platform toàn hệ thống, tenant theo tenant (bỏ qua locked_by_tenant). */
export async function countOtherActiveAdmins(
  tx: Tx,
  t: { role: Role; tenantId: string; excludeId: string },
): Promise<number> {
  const scope = t.role === "platform_admin" ? undefined : eq(users.tenantId, t.tenantId);
  const [r] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(users)
    .where(and(scope, eq(users.role, t.role), eq(users.active, true), ne(users.id, t.excludeId)));
  return r?.n ?? 0;
}

export type UserSet = Partial<{
  displayName: string;
  email: string | null;
  role: Role;
  locale: Locale;
  active: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
  passwordHash: string;
  mustChangePassword: boolean;
}>;

/** `bump`: tăng version + updated_at (trường admin sửa được/trạng thái); bộ đếm đăng nhập thì không. */
export async function updateUser(
  tx: Tx,
  t: { tenantId: string; id: string },
  set: UserSet & { passwordChanged?: boolean },
  bump: boolean,
): Promise<void> {
  const { passwordChanged, ...cols } = set;
  await tx
    .update(users)
    .set({
      ...cols,
      ...(passwordChanged ? { passwordChangedAt: sql`now()` } : {}),
      ...(bump ? { version: sql`${users.version} + 1`, updatedAt: sql`now()` } : {}),
    })
    .where(and(eq(users.tenantId, t.tenantId), eq(users.id, t.id)));
}
