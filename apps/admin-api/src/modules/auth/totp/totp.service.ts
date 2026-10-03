// ADM-FR-08 · M4-R10 · M4-R16 · M4-AC11 · bật/tắt 2FA và tạo lại mã dự phòng (plan-cd §4.2, §4.4, §7).
// Không log secret / otpauth_url / qr_svg / mã. Sai mã khi đã bật → tx TRẢ "wrong" để commit bộ đếm rồi mới ném.
import { randomBytes } from "node:crypto";
import type { BackupCodesResponse, TotpSetupResponse } from "@ai/contracts";
import { type Tx, verifyPassword, withScope } from "@ai/db";
import QRCode from "qrcode";
import { auditOf, recordAudit } from "../../../lib/audit/audit.write";
import type { Actor } from "../../../lib/auth-middleware";
import { appError } from "../../../lib/errors";
import {
  backupCodePepper,
  hashBackupCode,
  openBytes,
  type SecretKey,
  sealBytes,
  totpAad,
} from "../../../lib/secret-crypto";
import { base32Encode, matchTotp, otpauthUrl, TOTP_SECRET_BYTES } from "../../../lib/totp";
import { tempLocked } from "../auth.errors";
import { type AuthUser, findUserById, lockCounter, setCounter } from "../auth.repo";
import { afterFailedLogin, clearExpiredLock, isTempLocked } from "../auth.rules";
import { type AuthCtx, recordFailedLogin } from "../auth.service";
import * as repo from "./totp.repo";
import {
  generateBackupCodes,
  normalizeBackupCode,
  setupUsable,
  TOTP_SETUP_TTL_S,
} from "./totp.rules";

export type TotpCtx = AuthCtx & { secretKey?: SecretKey };
/** Mã đã bật: đúng một trong `code` (TOTP) / `backup_code`. */
export type SecondFactor = { code: string } | { backup_code: string };

const ISSUER = "AI System";
const rand = (n: number) => new Uint8Array(randomBytes(n));
const scopeOf = (tenantId: string) => ({ kind: "tenant", tenantId }) as const;
const who = (a: Actor) => ({ tenantId: a.tenantId, userId: a.userId });

export function keyOf(ctx: TotpCtx): SecretKey {
  if (!ctx.secretKey) throw new Error("totp: thiếu SECRET_MASTER_KEY");
  return ctx.secretKey;
}

export function openSecret(k: SecretKey, userId: string, row: repo.TotpRow): Uint8Array {
  return openBytes(k, totpAad(userId, row.keyVersion), {
    ciphertext: row.secretCt,
    iv: row.secretIv,
    keyVersion: row.keyVersion,
  });
}

/** Đọc user + kiểm mật khẩu hiện tại như `changePasswordSelf`: khoá tạm → 423, sai → +1 bộ đếm, 400. */
async function checkPassword(ctx: TotpCtx, actor: Actor, password: string): Promise<AuthUser> {
  const u = await withScope(ctx.db, scopeOf(actor.tenantId), (tx) =>
    findUserById(tx, actor.tenantId, actor.userId),
  );
  if (!u) throw appError("UNAUTHORIZED");
  const now = ctx.now();
  if (isTempLocked(u.lockedUntil, now)) throw tempLocked(u.lockedUntil as Date);
  if (!(await verifyPassword(password, u.passwordHash))) {
    await recordFailedLogin(ctx, u, now);
    throw appError("INVALID_CURRENT_PASSWORD");
  }
  return u;
}

/** Khoá hàng users (hạng 2) và kiểm lại khoá tạm; trả bộ đếm để ghi lần sai trong cùng tx. */
async function lockUser(tx: Tx, a: Actor, now: Date) {
  const row = await lockCounter(tx, a.tenantId, a.userId);
  if (!row) throw appError("UNAUTHORIZED");
  if (isTempLocked(row.lockedUntil, now)) throw tempLocked(row.lockedUntil as Date);
  return row;
}

async function countFailure(
  tx: Tx,
  a: Actor,
  row: { failedLogins: number; lockedUntil: Date | null },
  now: Date,
) {
  const next = afterFailedLogin(clearExpiredLock(row, now).failedLogins, now);
  await setCounter(tx, a.tenantId, a.userId, next);
}

function newBackupCodes(k: SecretKey): { codes: string[]; hashes: Uint8Array[] } {
  const codes = generateBackupCodes(rand);
  const pepper = backupCodePepper(k);
  return {
    codes,
    hashes: codes.map((c) => hashBackupCode(pepper, normalizeBackupCode(c) as string)),
  };
}

const totpAudit = (u: { id: string; tenantId: string; username: string }) => ({
  entityId: u.id,
  entityName: u.username,
  tenantId: u.tenantId,
});

/** POST /auth/totp/setup: mật khẩu → pending mới (thay pending cũ), trả secret + QR. */
export async function setupTotp(
  ctx: TotpCtx,
  actor: Actor,
  currentPassword: string,
): Promise<TotpSetupResponse> {
  const k = keyOf(ctx);
  const u = await checkPassword(ctx, actor, currentPassword);
  const now = ctx.now();
  const secret = rand(TOTP_SECRET_BYTES);
  await withScope(ctx.db, scopeOf(actor.tenantId), async (tx) => {
    await lockUser(tx, actor, now);
    const row = await repo.lockTotp(tx, who(actor));
    if (row?.enabledAt) throw appError("TOTP_ALREADY_ENABLED");
    const sealed = sealBytes(k, totpAad(actor.userId, k.version), secret);
    await repo.upsertPending(tx, {
      ...who(actor),
      secretCt: sealed.ciphertext,
      secretIv: sealed.iv,
      keyVersion: sealed.keyVersion,
      pendingExpiresAt: new Date(now.getTime() + TOTP_SETUP_TTL_S * 1000),
      now,
    });
  });
  const secretB32 = base32Encode(secret);
  const account = `${u.tenant.key} · ${u.username}`;
  const url = otpauthUrl({ secretB32, issuer: ISSUER, account });
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return {
    secret: secretB32,
    otpauth_url: url,
    qr_svg: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
    account_label: account,
    expires_in: TOTP_SETUP_TTL_S as TotpSetupResponse["expires_in"],
  };
}

/** POST /auth/totp/enable: mã sai KHÔNG tính bộ đếm (R16); đúng → bật, 10 mã dự phòng, audit create. */
export async function enableTotp(
  ctx: TotpCtx,
  actor: Actor,
  code: string,
): Promise<BackupCodesResponse> {
  const k = keyOf(ctx);
  const now = ctx.now();
  return withScope(ctx.db, scopeOf(actor.tenantId), async (tx) => {
    const u = await findUserById(tx, actor.tenantId, actor.userId);
    if (!u) throw appError("UNAUTHORIZED");
    const row = await repo.lockTotp(tx, who(actor));
    if (row?.enabledAt) throw appError("TOTP_ALREADY_ENABLED");
    if (!row || !setupUsable(row, now)) throw appError("TOTP_SETUP_EXPIRED");
    const step = matchTotp(openSecret(k, actor.userId, row), code, now, null);
    if (step === null) throw appError("INVALID_CURRENT_CODE");
    await repo.markEnabled(tx, who(actor), now, step);
    const { codes, hashes } = newBackupCodes(k);
    await repo.replaceBackupCodes(tx, who(actor), hashes);
    const after = { enabled: true, backup_codes_left: codes.length };
    await recordAudit(tx, {
      ...auditOf("create", "user_totp", { ...totpAudit(u), before: null, after }),
      actorId: actor.userId,
    });
    return { backup_codes: codes };
  });
}

/** Kiểm mã thứ hai của user đã bật (TOTP chống dùng lại / mã dự phòng một lần). */
async function checkFactor(
  tx: Tx,
  x: { k: SecretKey; a: Actor; row: repo.TotpRow; f: SecondFactor; now: Date },
): Promise<boolean> {
  if ("code" in x.f) {
    const secret = openSecret(x.k, x.a.userId, x.row);
    return matchTotp(secret, x.f.code, x.now, x.row.lastUsedStep) !== null;
  }
  const norm = normalizeBackupCode(x.f.backup_code);
  if (!norm) return false;
  const hash = hashBackupCode(backupCodePepper(x.k), norm);
  return repo.consumeBackupCode(tx, who(x.a), hash, x.now);
}

/** POST /auth/totp/disable (tự tắt): mật khẩu rồi mã (sai cả hai đều tính bộ đếm). */
export async function disableTotp(
  ctx: TotpCtx,
  actor: Actor,
  input: { current_password: string } & SecondFactor,
): Promise<void> {
  const k = keyOf(ctx);
  const u = await checkPassword(ctx, actor, input.current_password);
  const now = ctx.now();
  const res = await withScope(ctx.db, scopeOf(actor.tenantId), async (tx) => {
    const counter = await lockUser(tx, actor, now);
    const row = await repo.lockTotp(tx, who(actor));
    if (!row?.enabledAt) throw appError("TOTP_NOT_ENABLED");
    const left = await repo.countUnusedCodes(tx, who(actor));
    if (!(await checkFactor(tx, { k, a: actor, row, f: input, now }))) {
      await countFailure(tx, actor, counter, now);
      return "wrong" as const;
    }
    await repo.deleteTotp(tx, who(actor));
    const before = { enabled: true, backup_codes_left: left };
    await recordAudit(tx, {
      ...auditOf("delete", "user_totp", { ...totpAudit(u), before, after: null }),
      actorId: actor.userId,
    });
    return "ok" as const;
  });
  if (res === "wrong") throw appError("INVALID_CURRENT_CODE");
}

/** POST /auth/totp/backup-codes: mã TOTP hiện tại (sai tính bộ đếm) → 10 mã mới, mã cũ hết hiệu lực. */
export async function regenerateBackupCodes(
  ctx: TotpCtx,
  actor: Actor,
  code: string,
): Promise<BackupCodesResponse> {
  const k = keyOf(ctx);
  const now = ctx.now();
  const res = await withScope(ctx.db, scopeOf(actor.tenantId), async (tx) => {
    const u = await findUserById(tx, actor.tenantId, actor.userId);
    if (!u) throw appError("UNAUTHORIZED");
    const counter = await lockUser(tx, actor, now);
    const row = await repo.lockTotp(tx, who(actor));
    if (!row?.enabledAt) throw appError("TOTP_NOT_ENABLED");
    const step = matchTotp(openSecret(k, actor.userId, row), code, now, row.lastUsedStep);
    if (step === null) {
      await countFailure(tx, actor, counter, now);
      return null;
    }
    const left = await repo.countUnusedCodes(tx, who(actor));
    await repo.setLastUsedStep(tx, who(actor), step, now);
    const { codes, hashes } = newBackupCodes(k);
    await repo.replaceBackupCodes(tx, who(actor), hashes);
    await recordAudit(tx, {
      ...auditOf("update", "user_totp", {
        ...totpAudit(u),
        before: { backup_codes_left: left },
        after: { backup_codes_left: codes.length },
      }),
      actorId: actor.userId,
    });
    return { backup_codes: codes };
  });
  if (!res) throw appError("INVALID_CURRENT_CODE");
  return res;
}
