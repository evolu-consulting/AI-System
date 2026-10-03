// ADM-FR-08 · ADM-FR-07 · M4-R16 · M4-AC11 · bước 2 đăng nhập `POST /auth/totp/verify` (plan-cd §4.2, §7 hàng Verify).
// Khoá users NKU (hạng 2) → user_totp NKU (hạng 2b). Mã sai: tx TRẢ "wrong" để commit bộ đếm rồi mới ném 401.
// Không log totp_token / mã. Không ghi audit (Q6).
import type { TotpVerifyRequest } from "@ai/contracts";
import { type Tx, withScope } from "@ai/db";
import { appError } from "../../../lib/errors";
import { type TotpClaims, verifyTotpToken } from "../../../lib/jwt";
import { backupCodePepper, hashBackupCode, type SecretKey } from "../../../lib/secret-crypto";
import { matchTotp } from "../../../lib/totp";
import { tempLocked } from "../auth.errors";
import type { AuthUser } from "../auth.repo";
import * as authRepo from "../auth.repo";
import {
  afterFailedLogin,
  canSignIn,
  changeTokenMatches,
  clearExpiredLock,
  isTempLocked,
  type LockState,
} from "../auth.rules";
import { changeRequired, type LoginResult, resetCounter } from "../auth.service";
import { type ClientMeta, issueSession, type Session } from "../auth.session";
import * as repo from "./totp.repo";
import { normalizeBackupCode } from "./totp.rules";
import { keyOf, openSecret, type TotpCtx } from "./totp.service";

type Who = { tenantId: string; userId: string };
type Verdict = "wrong" | { kind: "change"; user: AuthUser } | ({ kind: "session" } & Session);
type Locked = { counter: LockState; row: repo.TotpRow; user: AuthUser };

/** Khoá hàng và kiểm token còn khớp trạng thái hiện tại: user mất / đổi mật khẩu / tắt-bật lại 2FA → 401. */
async function lockAndCheck(tx: Tx, c: TotpClaims, now: Date): Promise<Locked> {
  const counter = await authRepo.lockCounter(tx, c.tid, c.sub);
  const row = counter ? await repo.lockTotp(tx, { tenantId: c.tid, userId: c.sub }) : null;
  const user = row ? await authRepo.findUserById(tx, c.tid, c.sub) : null;
  if (!counter || !row?.enabledAt || !user) throw appError("INVALID_TOTP_TOKEN");
  if (!changeTokenMatches(c.pwc, user.passwordChangedAt) || row.enabledAt.getTime() !== c.tte) {
    throw appError("INVALID_TOTP_TOKEN");
  }
  if (!canSignIn(user, user.tenant.active)) throw appError("ACCOUNT_LOCKED");
  if (isTempLocked(counter.lockedUntil, now)) throw tempLocked(counter.lockedUntil as Date);
  return { counter, row, user };
}

/** TOTP: bước khớp và > last_used_step (D5) rồi ghi bước; mã dự phòng: tiêu một lần. Sai → false. */
async function acceptFactor(
  tx: Tx,
  x: { k: SecretKey; w: Who; row: repo.TotpRow; input: TotpVerifyRequest; now: Date },
): Promise<boolean> {
  if ("code" in x.input) {
    const secret = openSecret(x.k, x.w.userId, x.row);
    const step = matchTotp(secret, x.input.code, x.now, x.row.lastUsedStep);
    if (step === null) return false;
    await repo.setLastUsedStep(tx, x.w, step, x.now);
    return true;
  }
  const norm = normalizeBackupCode(x.input.backup_code);
  if (!norm) return false;
  return repo.consumeBackupCode(tx, x.w, hashBackupCode(backupCodePepper(x.k), norm), x.now);
}

async function verifyInTx(
  tx: Tx,
  ctx: TotpCtx,
  x: { k: SecretKey; c: TotpClaims; input: TotpVerifyRequest; meta: ClientMeta; now: Date },
): Promise<Verdict> {
  const { counter, row, user } = await lockAndCheck(tx, x.c, x.now);
  const w = { tenantId: x.c.tid, userId: x.c.sub };
  if (!(await acceptFactor(tx, { k: x.k, w, row, input: x.input, now: x.now }))) {
    const next = afterFailedLogin(clearExpiredLock(counter, x.now).failedLogins, x.now);
    await authRepo.setCounter(tx, w.tenantId, w.userId, next);
    return "wrong";
  }
  if (user.mustChangePassword) {
    await resetCounter(tx, user);
    return { kind: "change", user };
  }
  await authRepo.markLoginSuccess(tx, w.tenantId, w.userId, x.now);
  // Đọc lại sau khi tiêu mã dự phòng để `user.backup_codes_left` đúng.
  const fresh = (await authRepo.findUserById(tx, w.tenantId, w.userId)) as AuthUser;
  return { kind: "session", ...(await issueSession(ctx, tx, fresh, x.meta)) };
}

/** POST /auth/totp/verify: token hỏng → 401 INVALID_TOTP_TOKEN; mã sai/đã dùng → 401 INVALID_OTP (+1 bộ đếm). */
export async function verifyTotpLogin(
  ctx: TotpCtx,
  input: TotpVerifyRequest,
  meta: ClientMeta,
): Promise<LoginResult> {
  const k = keyOf(ctx);
  const now = ctx.now();
  const c = await verifyTotpToken(ctx.keys, input.totp_token, now);
  if (!c) throw appError("INVALID_TOTP_TOKEN");
  const res = await withScope(ctx.db, { kind: "tenant", tenantId: c.tid }, (tx) =>
    verifyInTx(tx, ctx, { k, c, input, meta, now }),
  );
  if (res === "wrong") throw appError("INVALID_OTP");
  if (res.kind === "change") return changeRequired(ctx, res.user);
  return res;
}
