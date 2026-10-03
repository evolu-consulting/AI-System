// ADM-FR-08 · M4-R16 · truy vấn 2FA (plan-cd §5, §7). Luôn chạy trong withScope(tenant) (RLS) và vẫn lọc
// tenant_id tường minh. Thứ tự khoá: users (hạng 2) → user_totp / user_backup_codes (hạng 2b).
import { type Tx, userBackupCodes, userTotp } from "@ai/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export type TotpRow = {
  secretCt: Uint8Array;
  secretIv: Uint8Array;
  keyVersion: number;
  enabledAt: Date | null;
  pendingExpiresAt: Date | null;
  lastUsedStep: bigint | null;
};
type Who = { tenantId: string; userId: string };

const whereUser = (w: Who) => and(eq(userTotp.tenantId, w.tenantId), eq(userTotp.userId, w.userId));

/** Hàng 2FA khoá FOR NO KEY UPDATE (gọi sau khi đã khoá hàng `users` nếu cần). */
export async function lockTotp(tx: Tx, w: Who): Promise<TotpRow | null> {
  const [row] = await tx
    .select({
      secretCt: userTotp.secretCt,
      secretIv: userTotp.secretIv,
      keyVersion: userTotp.keyVersion,
      enabledAt: userTotp.enabledAt,
      pendingExpiresAt: userTotp.pendingExpiresAt,
      lastUsedStep: userTotp.lastUsedStep,
    })
    .from(userTotp)
    .where(whereUser(w))
    .for("no key update");
  return row ?? null;
}

export type NewPending = Who & {
  secretCt: Uint8Array;
  secretIv: Uint8Array;
  keyVersion: number;
  pendingExpiresAt: Date;
  now: Date;
};

/** Setup: chèn hoặc thay pending cũ (bên gọi đã chắc chưa bật). Mã dự phòng cũ (nếu có) bị xoá ở bước enable. */
export async function upsertPending(tx: Tx, p: NewPending): Promise<void> {
  const v = {
    secretCt: p.secretCt,
    secretIv: p.secretIv,
    keyVersion: p.keyVersion,
    enabledAt: null,
    pendingExpiresAt: p.pendingExpiresAt,
    lastUsedStep: null,
    updatedAt: p.now,
  };
  await tx
    .insert(userTotp)
    .values({ ...v, tenantId: p.tenantId, userId: p.userId, createdAt: p.now })
    .onConflictDoUpdate({ target: userTotp.userId, set: v });
}

/** Bật: một UPDATE đặt `enabled_at` và bỏ `pending_expires_at` (CHECK user_totp_pending_check). */
export async function markEnabled(tx: Tx, w: Who, now: Date, step: bigint): Promise<void> {
  await tx
    .update(userTotp)
    .set({ enabledAt: now, pendingExpiresAt: null, lastUsedStep: step, updatedAt: now })
    .where(whereUser(w));
}

export async function setLastUsedStep(tx: Tx, w: Who, step: bigint, now: Date): Promise<void> {
  await tx.update(userTotp).set({ lastUsedStep: step, updatedAt: now }).where(whereUser(w));
}

/** Xoá hàng 2FA; mã dự phòng đi theo (FK cascade). */
export async function deleteTotp(tx: Tx, w: Who): Promise<void> {
  await tx.delete(userTotp).where(whereUser(w));
}

const backupOf = (w: Who) =>
  and(eq(userBackupCodes.tenantId, w.tenantId), eq(userBackupCodes.userId, w.userId));

export async function countUnusedCodes(tx: Tx, w: Who): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(userBackupCodes)
    .where(and(backupOf(w), isNull(userBackupCodes.usedAt)));
  return Number(row?.n ?? 0);
}

/** Thay toàn bộ mã dự phòng (cũ hết hiệu lực). */
export async function replaceBackupCodes(tx: Tx, w: Who, hashes: Uint8Array[]): Promise<void> {
  await tx.delete(userBackupCodes).where(backupOf(w));
  await tx
    .insert(userBackupCodes)
    .values(hashes.map((codeHash) => ({ tenantId: w.tenantId, userId: w.userId, codeHash })));
}

/** Dùng một mã dự phòng (một lần): true nếu đúng hash và chưa dùng. */
export async function consumeBackupCode(
  tx: Tx,
  w: Who,
  hash: Uint8Array,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(userBackupCodes)
    .set({ usedAt: now })
    .where(and(backupOf(w), eq(userBackupCodes.codeHash, hash), isNull(userBackupCodes.usedAt)))
    .returning({ id: userBackupCodes.id });
  return rows.length > 0;
}
