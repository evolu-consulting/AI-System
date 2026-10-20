// ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-07, ADM-NFR-01 · đăng nhập, refresh xoay vòng, đăng xuất (plan M1 §5).
// Không biết HTTP: route quyết định cookie/body. Mỗi bước có DB = một withScope.
import type { Locale, LoginRequest, Me, PasswordChangeRequired, TotpRequired } from "@ai/contracts";
import { hashPassword, NIL_SCOPE, setScope, type Tx, verifyPassword, withScope } from "@ai/db";
import { auditOf, recordAudit } from "../../lib/audit/audit.write";
import { appError } from "../../lib/errors";
import { signChangeToken, signTotpToken, verifyChangeToken } from "../../lib/jwt";
import { tempLocked } from "./auth.errors";
import { verifyLogin } from "./auth.legacy";
import { DEFAULT_LEGACY_SUNSET, legacyActive } from "./auth.legacy.rules";
import type { AuthUser } from "./auth.repo";
import * as repo from "./auth.repo";
import {
  afterFailedLogin,
  CHANGE_TOKEN_TTL_S,
  canSignIn,
  changeTokenMatches,
  clearExpiredLock,
  isTempLocked,
  normalizeLoginId,
  type RevokeReason,
} from "./auth.rules";
import { type AuthCtx, type ClientMeta, issueSession, type Session, toMe } from "./auth.session";
import { accountId } from "./limit/limit.keys";
import { hashSlot, type LoginSlot, openLoginSlot } from "./limit/limit.service";
import { loginNextStep, TOTP_TOKEN_TTL_S } from "./totp/totp.rules";

export type { AuthCtx, ClientMeta, Session } from "./auth.session";
export type LoginResult =
  | ({ kind: "session" } & Session)
  | { kind: "change"; body: PasswordChangeRequired }
  | { kind: "totp"; body: TotpRequired };

const tenantScope = (tenantId: string) => ({ kind: "tenant", tenantId }) as const;

/** Hash giả cho M1-R01 (user không tồn tại vẫn verify một lần); tính một lần lúc khởi động. */
export function createDummyHash(): Promise<string> {
  return hashPassword(`dummy-${Bun.randomUUIDv7()}`);
}

async function findLoginUser(ctx: AuthCtx, tenantKey: string, username: string) {
  return withScope(ctx.db, NIL_SCOPE, async (tx) => {
    const tid = await repo.tenantIdByKey(tx, tenantKey);
    if (!tid) return null;
    await setScope(tx, tenantScope(tid));
    return repo.findUserByUsername(tx, tid, username);
  });
}

/** Ghi một lần sai dưới FOR NO KEY UPDATE; đang khoá (request khác vừa khoá) thì không đụng. */
export async function recordFailedLogin(ctx: AuthCtx, u: AuthUser, now: Date): Promise<void> {
  await withScope(ctx.db, tenantScope(u.tenantId), async (tx) => {
    const row = await repo.lockCounter(tx, u.tenantId, u.id);
    if (!row || isTempLocked(row.lockedUntil, now)) return;
    const next = afterFailedLogin(clearExpiredLock(row, now).failedLogins, now);
    await repo.setCounter(tx, u.tenantId, u.id, next);
  });
}

/**
 * Mật khẩu đúng: trong transaction khoá hàng user (FOR NO KEY UPDATE) và kiểm lại khoá tạm — ảnh chụp đọc trước verify có
 * thể đã cũ vì request sai song song vừa khoá tài khoản (review vòng 1 #3). Đang khoá → 423; không thì đếm về 0.
 */
export async function confirmNotTempLocked<T>(
  ctx: AuthCtx,
  u: AuthUser,
  now: Date,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withScope(ctx.db, tenantScope(u.tenantId), async (tx) => {
    const row = await repo.lockCounter(tx, u.tenantId, u.id);
    if (row && isTempLocked(row.lockedUntil, now)) throw tempLocked(row.lockedUntil as Date);
    return fn(tx);
  });
}

export const resetCounter = (tx: Tx, u: AuthUser) =>
  repo.setCounter(tx, u.tenantId, u.id, { failedLogins: 0, lockedUntil: null });

export async function login(
  ctx: AuthCtx,
  input: LoginRequest,
  meta: ClientMeta,
): Promise<LoginResult> {
  const tenantKey = normalizeLoginId(input.tenant_key);
  const username = normalizeLoginId(input.username);
  const now = ctx.now();
  // L1 (#224): giới hạn theo (tenant_key, username) — cả tài khoản không tồn tại — và theo IP, trước mọi phép băm.
  // L1c (A-3): lượt giữ chỗ trong Redis; finally nhả chỗ nếu lượt không kết thúc bằng sai/đúng mật khẩu.
  const slot = ctx.limiter
    ? await openLoginSlot(
        { db: ctx.db, limiter: ctx.limiter },
        meta.ip ?? null,
        accountId(tenantKey, username),
        now,
      )
    : null;
  try {
    return await verifyAndContinue(ctx, { input, meta, now, tenantKey, username, slot });
  } finally {
    await slot?.release();
  }
}

type LoginRun = {
  input: LoginRequest;
  meta: ClientMeta;
  now: Date;
  tenantKey: string;
  username: string;
  slot: LoginSlot | null;
};

async function verifyAndContinue(ctx: AuthCtx, r: LoginRun): Promise<LoginResult> {
  const { input, meta, now, slot } = r;
  const u = await findLoginUser(ctx, r.tenantKey, r.username);
  const opts = {
    dummyHash: ctx.dummyHash,
    legacyOn: legacyActive(now, ctx.legacySunset ?? DEFAULT_LEGACY_SUNSET),
  };
  const failed = async (who: AuthUser | null) => {
    await slot?.fail(who);
    return appError("INVALID_CREDENTIALS");
  };
  if (!u) {
    await hashSlot(ctx.hashSlots, () => verifyLogin(input.password, null, opts));
    throw await failed(null);
  }
  if (isTempLocked(u.lockedUntil, now)) throw tempLocked(u.lockedUntil as Date);
  await ctx.beforeVerify?.();
  const v = await hashSlot(ctx.hashSlots, () => verifyLogin(input.password, u.passwordHash, opts));
  if (!v.ok) {
    await recordFailedLogin(ctx, u, now);
    throw await failed(u);
  }
  await slot?.ok();
  // N5B-FR-03: hash argon2id đã băm song song lúc verify (ngoài tx); ghi trong tx của bước sau mật khẩu.
  const rehash = v.rehash ? { from: u.passwordHash, to: v.rehash } : null;
  return afterPasswordOk(ctx, u, meta, { now, rehash });
}

type Rehash = { from: string; to: string } | null;

/** CAS legacy ⇒ argon2id + audit `legacy_rehash` (câu cuối của tx; actor = chính user). Không có ⇒ không làm gì. */
async function applyRehash(tx: Tx, u: AuthUser, r: Rehash): Promise<void> {
  if (!r || !(await repo.rehashLegacy(tx, { tenantId: u.tenantId, userId: u.id }, r.from, r.to)))
    return;
  await recordAudit(tx, {
    ...auditOf("update", "user", {
      entityId: u.id,
      entityName: u.username,
      tenantId: u.tenantId,
      before: null,
      after: null,
      summary: { op: "legacy_rehash" },
    }),
    actorId: u.id,
  });
}

/** Body `password_change_required` (login M1 và bước 2FA khi còn phải đổi mật khẩu). */
export async function changeRequired(ctx: AuthCtx, u: AuthUser): Promise<LoginResult> {
  const changeToken = await signChangeToken(ctx.keys, {
    sub: u.id,
    tid: u.tenantId,
    pwc: u.passwordChangedAt.getTime(),
  });
  const body = {
    status: "password_change_required",
    change_token: changeToken,
    expires_in: CHANGE_TOKEN_TTL_S,
  };
  return { kind: "change", body: body as PasswordChangeRequired };
}

/**
 * Sau mật khẩu đúng (plan-cd §7, Q10): account_locked → totp_required → password_change_required → authenticated.
 * `totp_required` KHÔNG đưa bộ đếm về 0 (D4) nhưng vẫn kiểm khoá tạm dưới khoá hàng.
 */
async function afterPasswordOk(
  ctx: AuthCtx,
  u: AuthUser,
  meta: ClientMeta,
  { now, rehash }: { now: Date; rehash: Rehash },
): Promise<LoginResult> {
  const step = loginNextStep({
    canSignIn: canSignIn(u, u.tenant.active),
    totpEnabled: u.totpEnabledAt !== null,
    mustChangePassword: u.mustChangePassword,
  });
  // Rehash ở mọi bước trừ account_locked (readiness R6); luôn là việc cuối trong tx.
  if (step === "totp_required") {
    await confirmNotTempLocked(ctx, u, now, (tx) => applyRehash(tx, u, rehash));
    const claims = { sub: u.id, tid: u.tenantId, pwc: u.passwordChangedAt.getTime() };
    const token = await signTotpToken(
      ctx.keys,
      { ...claims, tte: (u.totpEnabledAt as Date).getTime() },
      now,
    );
    const body = { status: "totp_required", totp_token: token, expires_in: TOTP_TOKEN_TTL_S };
    return { kind: "totp", body: body as TotpRequired };
  }
  if (step !== "authenticated") {
    const r = step === "account_locked" ? null : rehash;
    await confirmNotTempLocked(ctx, u, now, async (tx) => {
      await resetCounter(tx, u);
      await applyRehash(tx, u, r);
    });
    if (step === "account_locked") throw appError("ACCOUNT_LOCKED");
    return changeRequired(ctx, u);
  }
  const session = await confirmNotTempLocked(ctx, u, now, async (tx) => {
    await repo.markLoginSuccess(tx, u.tenantId, u.id, now);
    const s = await issueSession(ctx, tx, u, meta);
    await applyRehash(tx, u, rehash);
    return s;
  });
  return { kind: "session", ...session };
}

export { logout, refresh } from "./auth.refresh";

export type Actor = { userId: string; tenantId: string; sid: string | null };

/** Ghi mật khẩu mới dưới FOR NO KEY UPDATE; `expectPwc` (bắt buộc) chặn dùng lại change_token khi song song. */
async function writePassword(
  ctx: AuthCtx,
  u: AuthUser,
  hash: string,
  o: { expectPwc?: number; keepFamily: string | null; tempLockAt?: Date },
  after: (tx: Tx) => Promise<Session | null>,
): Promise<Session | null> {
  return withScope(ctx.db, tenantScope(u.tenantId), async (tx) => {
    const row = await repo.lockPasswordRow(tx, u.tenantId, u.id);
    if (!row) throw appError("INVALID_CHANGE_TOKEN");
    if (o.expectPwc !== undefined && !changeTokenMatches(o.expectPwc, row.passwordChangedAt)) {
      throw appError("INVALID_CHANGE_TOKEN");
    }
    // Tự đổi: kiểm lại khoá tạm dưới khoá hàng (request sai song song có thể vừa khoá).
    if (o.tempLockAt && isTempLocked(row.lockedUntil, o.tempLockAt)) {
      throw tempLocked(row.lockedUntil as Date);
    }
    await repo.updatePassword(tx, u.tenantId, u.id, hash);
    await repo.revokeUserTokens(tx, {
      tenantId: u.tenantId,
      userId: u.id,
      reason: "password_changed",
      keepFamily: o.keepFamily,
    });
    return after(tx);
  });
}

/** Đổi mật khẩu bắt buộc (FR-06, M1-R05): change_token một lần → cấp phiên như đăng nhập. */
export async function changePasswordForced(
  ctx: AuthCtx,
  input: { change_token: string; new_password: string },
  meta: ClientMeta,
): Promise<Session> {
  const claims = await verifyChangeToken(ctx.keys, input.change_token);
  if (!claims) throw appError("INVALID_CHANGE_TOKEN");
  const u = await withScope(ctx.db, tenantScope(claims.tid), (tx) =>
    repo.findUserById(tx, claims.tid, claims.sub),
  );
  if (!u || !changeTokenMatches(claims.pwc, u.passwordChangedAt)) {
    throw appError("INVALID_CHANGE_TOKEN");
  }
  if (!canSignIn(u, u.tenant.active)) throw appError("ACCOUNT_LOCKED");
  const hash = await hashSlot(ctx.hashSlots, async () =>
    (await verifyPassword(input.new_password, u.passwordHash))
      ? null
      : hashPassword(input.new_password),
  );
  if (hash === null) throw appError("PASSWORD_UNCHANGED");
  // Đổi xong = đăng nhập thành công: ghi last_login_at (review vòng 1 #2) rồi cấp phiên.
  const s = await writePassword(
    ctx,
    u,
    hash,
    { expectPwc: claims.pwc, keepFamily: null, tempLockAt: ctx.now() },
    async (tx) => {
      await repo.markLoginSuccess(tx, u.tenantId, u.id, ctx.now());
      return issueSession(ctx, tx, u, meta);
    },
  );
  return s as Session;
}

/** Tự đổi (FR-06, M1-R06): sai mật khẩu hiện tại tính vào bộ đếm khoá tạm; giữ phiên hiện tại (`sid`). */
export async function changePasswordSelf(
  ctx: AuthCtx,
  actor: Actor,
  input: { current_password: string; new_password: string },
): Promise<void> {
  const u = await withScope(ctx.db, tenantScope(actor.tenantId), (tx) =>
    repo.findUserById(tx, actor.tenantId, actor.userId),
  );
  if (!u) throw appError("UNAUTHORIZED");
  const now = ctx.now();
  if (isTempLocked(u.lockedUntil, now)) throw tempLocked(u.lockedUntil as Date);
  if (
    !(await hashSlot(ctx.hashSlots, () => verifyPassword(input.current_password, u.passwordHash)))
  ) {
    await recordFailedLogin(ctx, u, now);
    throw appError("INVALID_CURRENT_PASSWORD");
  }
  if (input.new_password === input.current_password) throw appError("PASSWORD_UNCHANGED");
  const hash = await hashSlot(ctx.hashSlots, () => hashPassword(input.new_password));
  await writePassword(ctx, u, hash, { keepFamily: actor.sid, tempLockAt: now }, async () => null);
}

/** GET /auth/me: hồ sơ đọc lại từ DB (middleware đã chặn user không đăng nhập được). */
export async function getMe(ctx: AuthCtx, actor: Actor): Promise<Me> {
  const u = await withScope(ctx.db, tenantScope(actor.tenantId), (tx) =>
    repo.findUserById(tx, actor.tenantId, actor.userId),
  );
  if (!u) throw appError("UNAUTHORIZED");
  return toMe(u);
}

/** PATCH /auth/me: chỉ `locale`, ghi sau thắng (không cần version), vẫn tăng `users.version`. */
export async function updateMyLocale(ctx: AuthCtx, actor: Actor, locale: Locale): Promise<Me> {
  const u = await withScope(ctx.db, tenantScope(actor.tenantId), async (tx) => {
    await repo.updateLocale(tx, actor.tenantId, actor.userId, locale);
    return repo.findUserById(tx, actor.tenantId, actor.userId);
  });
  if (!u) throw appError("UNAUTHORIZED");
  return toMe(u);
}

/** Dùng bởi module tenants/users (không import repo auth): thu hồi phiên trong transaction của bên gọi. */
export function revokeTenantSessions(tx: Tx, tenantId: string, reason: RevokeReason) {
  return repo.revokeTenantTokens(tx, tenantId, reason);
}

export function revokeUserSessions(
  tx: Tx,
  t: { tenantId: string; userId: string; reason: RevokeReason },
) {
  return repo.revokeUserTokens(tx, t);
}
