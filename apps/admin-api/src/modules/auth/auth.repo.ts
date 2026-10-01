// ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-06, ADM-NFR-07 · truy vấn auth. Luôn chạy trong withScope (RLS)
// và vẫn lọc tenant_id tường minh. Thời gian của token dùng now() của DB (plan §10 G7).
import type { Locale, Role } from "@ai/contracts";
import { refreshTokens, type Tx, tenants, users } from "@ai/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { LockState, RevokeReason } from "./auth.rules";

export type AuthUser = {
  id: string;
  tenantId: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  locale: Locale;
  active: boolean;
  lockedByTenant: boolean;
  mustChangePassword: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
  passwordHash: string;
  passwordChangedAt: Date;
  tenant: { id: string; key: string; name: string; active: boolean };
};

const userCols = {
  id: users.id,
  tenantId: users.tenantId,
  username: users.username,
  displayName: users.displayName,
  email: users.email,
  role: users.role,
  locale: users.locale,
  active: users.active,
  lockedByTenant: users.lockedByTenant,
  mustChangePassword: users.mustChangePassword,
  failedLogins: users.failedLogins,
  lockedUntil: users.lockedUntil,
  passwordHash: users.passwordHash,
  passwordChangedAt: users.passwordChangedAt,
  tenant: { id: tenants.id, key: tenants.key, name: tenants.name, active: tenants.active },
};

async function scalarUuid(tx: Tx, query: ReturnType<typeof sql>): Promise<string | null> {
  const rows = (await tx.execute(query)) as unknown as { id: string | null }[];
  return rows[0]?.id ?? null;
}

/** Hàm SECURITY DEFINER: chỉ trả tenant_id, gọi được trước khi có scope. */
export function tenantIdByKey(tx: Tx, key: string): Promise<string | null> {
  return scalarUuid(tx, sql`select admin.tenant_id_by_key(${key}) as id`);
}

export function tenantIdByRefreshHash(tx: Tx, hash: Buffer): Promise<string | null> {
  return scalarUuid(tx, sql`select admin.tenant_id_by_refresh_hash(${hash}) as id`);
}

async function findUser(tx: Tx, tenantId: string, cond: ReturnType<typeof eq>) {
  const [row] = await tx
    .select(userCols)
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(users.tenantId, tenantId), cond))
    .limit(1);
  return (row as AuthUser | undefined) ?? null;
}

export function findUserByUsername(tx: Tx, tenantId: string, username: string) {
  return findUser(tx, tenantId, eq(users.username, username));
}

export function findUserById(tx: Tx, tenantId: string, userId: string) {
  return findUser(tx, tenantId, eq(users.id, userId));
}

/** Khoá hàng user để cập nhật bộ đếm an toàn khi nhiều request sai cùng lúc. */
export async function lockCounter(tx: Tx, tenantId: string, userId: string) {
  const [row] = await tx
    .select({ failedLogins: users.failedLogins, lockedUntil: users.lockedUntil })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
    .for("update");
  return row ?? null;
}

/** Bộ đếm đăng nhập không tăng `version` (spec §3). */
export async function setCounter(tx: Tx, tenantId: string, userId: string, s: LockState) {
  await tx
    .update(users)
    .set({ failedLogins: s.failedLogins, lockedUntil: s.lockedUntil })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
}

export async function markLoginSuccess(tx: Tx, tenantId: string, userId: string, now: Date) {
  await tx
    .update(users)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
}

export type NewRefresh = {
  id: string;
  userId: string;
  tenantId: string;
  familyId: string;
  tokenHash: Buffer;
  client: "web" | "extension";
  userAgent: string | null;
  /** null = đầu chuỗi: now() + 30 ngày theo giờ DB. */
  expiresAt: Date | null;
};

export async function insertRefresh(tx: Tx, r: NewRefresh): Promise<void> {
  await tx.insert(refreshTokens).values({
    ...r,
    expiresAt: r.expiresAt ?? sql`now() + interval '30 days'`,
  });
}

export type RefreshRow = {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: RevokeReason | null;
  dbNow: Date;
};

export async function findRefresh(tx: Tx, tenantId: string, hash: Buffer) {
  const [row] = await tx
    .select({
      id: refreshTokens.id,
      userId: refreshTokens.userId,
      familyId: refreshTokens.familyId,
      expiresAt: refreshTokens.expiresAt,
      revokedAt: refreshTokens.revokedAt,
      revokedReason: refreshTokens.revokedReason,
      dbNow: sql<string>`now()`.mapWith((v: string) => new Date(v)),
    })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tenantId, tenantId), eq(refreshTokens.tokenHash, hash)))
    .limit(1);
  return (row as RefreshRow | undefined) ?? null;
}

const revokeSet = (reason: RevokeReason) => ({ revokedAt: sql`now()`, revokedReason: reason });
const active = (tenantId: string) =>
  and(eq(refreshTokens.tenantId, tenantId), isNull(refreshTokens.revokedAt));

/** Thu hồi token cũ khi xoay; false = request khác đã xoay trước (thua race). */
export async function rotateRefresh(tx: Tx, tenantId: string, id: string, replacedBy: string) {
  const rows = await tx
    .update(refreshTokens)
    .set({ ...revokeSet("rotated"), replacedBy })
    .where(and(active(tenantId), eq(refreshTokens.id, id)))
    .returning({ id: refreshTokens.id });
  return rows.length === 1;
}

export async function revokeRefresh(tx: Tx, tenantId: string, id: string, reason: RevokeReason) {
  await tx
    .update(refreshTokens)
    .set(revokeSet(reason))
    .where(and(active(tenantId), eq(refreshTokens.id, id)));
}

export async function revokeFamily(tx: Tx, tenantId: string, familyId: string, r: RevokeReason) {
  await tx
    .update(refreshTokens)
    .set(revokeSet(r))
    .where(and(active(tenantId), eq(refreshTokens.familyId, familyId)));
}

/** Thu hồi mọi token đang sống của user; `keepFamily` = phiên hiện tại được giữ (tự đổi mật khẩu). */
export async function revokeUserTokens(
  tx: Tx,
  t: { tenantId: string; userId: string; reason: RevokeReason; keepFamily?: string | null },
): Promise<void> {
  const keep = t.keepFamily ? ne(refreshTokens.familyId, t.keepFamily) : undefined;
  await tx
    .update(refreshTokens)
    .set(revokeSet(t.reason))
    .where(and(active(t.tenantId), eq(refreshTokens.userId, t.userId), keep));
}

/** Đổi mật khẩu: tăng version, đặt lại bộ đếm, đổi password_changed_at (change_token cũ mất hiệu lực). */
export async function updatePassword(tx: Tx, tenantId: string, userId: string, hash: string) {
  await tx
    .update(users)
    .set({
      passwordHash: hash,
      mustChangePassword: false,
      passwordChangedAt: sql`now()`,
      failedLogins: 0,
      lockedUntil: null,
      version: sql`${users.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
}

export async function lockPasswordRow(tx: Tx, tenantId: string, userId: string) {
  const [row] = await tx
    .select({ passwordChangedAt: users.passwordChangedAt })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
    .for("update");
  return row ?? null;
}

/** PATCH /auth/me: ghi sau thắng, vẫn tăng version. */
export async function updateLocale(tx: Tx, tenantId: string, userId: string, locale: Locale) {
  await tx
    .update(users)
    .set({ locale, version: sql`${users.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
}
