// ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-07, ADM-NFR-01 · đăng nhập, refresh xoay vòng, đăng xuất (plan M1 §5).
// Không biết HTTP: route quyết định cookie/body. Mỗi bước có DB = một withScope.
import type { Locale, LoginRequest, Me, PasswordChangeRequired } from "@ai/contracts";
import { hashPassword, NIL_SCOPE, setScope, type Tx, verifyPassword, withScope } from "@ai/db";
import { appError } from "../../lib/errors";
import { signChangeToken, verifyChangeToken } from "../../lib/jwt";
import { tempLocked } from "./auth.errors";
import type { AuthUser } from "./auth.repo";
import * as repo from "./auth.repo";
import {
  afterFailedLogin,
  CHANGE_TOKEN_TTL_S,
  canSignIn,
  changeTokenMatches,
  classifyRefresh,
  clearExpiredLock,
  isTempLocked,
  normalizeLoginId,
  outcomeAfterPasswordOk,
  type RevokeReason,
} from "./auth.rules";
import {
  type AuthCtx,
  type ClientMeta,
  issueSession,
  type Session,
  sha256,
  toMe,
} from "./auth.session";

export type { AuthCtx, ClientMeta, Session } from "./auth.session";
export type LoginResult =
  | ({ kind: "session" } & Session)
  | { kind: "change"; body: PasswordChangeRequired };

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

/** Ghi một lần sai dưới FOR UPDATE; đang khoá (request khác vừa khoá) thì không đụng. */
export async function recordFailedLogin(ctx: AuthCtx, u: AuthUser, now: Date): Promise<void> {
  await withScope(ctx.db, tenantScope(u.tenantId), async (tx) => {
    const row = await repo.lockCounter(tx, u.tenantId, u.id);
    if (!row || isTempLocked(row.lockedUntil, now)) return;
    const next = afterFailedLogin(clearExpiredLock(row, now).failedLogins, now);
    await repo.setCounter(tx, u.tenantId, u.id, next);
  });
}

/**
 * Mật khẩu đúng: trong transaction khoá hàng user (FOR UPDATE) và kiểm lại khoá tạm — ảnh chụp đọc trước verify có
 * thể đã cũ vì request sai song song vừa khoá tài khoản (review vòng 1 #3). Đang khoá → 423; không thì đếm về 0.
 */
async function confirmNotTempLocked<T>(
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

const resetCounter = (tx: Tx, u: AuthUser) =>
  repo.setCounter(tx, u.tenantId, u.id, { failedLogins: 0, lockedUntil: null });

export async function login(
  ctx: AuthCtx,
  input: LoginRequest,
  meta: ClientMeta,
): Promise<LoginResult> {
  const u = await findLoginUser(
    ctx,
    normalizeLoginId(input.tenant_key),
    normalizeLoginId(input.username),
  );
  if (!u) {
    await verifyPassword(input.password, ctx.dummyHash);
    throw appError("INVALID_CREDENTIALS");
  }
  const now = ctx.now();
  if (isTempLocked(u.lockedUntil, now)) throw tempLocked(u.lockedUntil as Date);
  await ctx.beforeVerify?.();
  if (!(await verifyPassword(input.password, u.passwordHash))) {
    await recordFailedLogin(ctx, u, now);
    throw appError("INVALID_CREDENTIALS");
  }
  const outcome = outcomeAfterPasswordOk(u, u.tenant.active);
  if (outcome !== "authenticated") {
    await confirmNotTempLocked(ctx, u, now, (tx) => resetCounter(tx, u));
    if (outcome === "account_locked") throw appError("ACCOUNT_LOCKED");
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
  const session = await confirmNotTempLocked(ctx, u, now, async (tx) => {
    await repo.markLoginSuccess(tx, u.tenantId, u.id, now);
    return issueSession(ctx, tx, u, meta);
  });
  return { kind: "session", ...session };
}

type FoundRefresh = { tid: string; token: repo.RefreshRow; user: AuthUser | null };

async function findRefreshToken(ctx: AuthCtx, hash: Buffer): Promise<FoundRefresh | null> {
  return withScope(ctx.db, NIL_SCOPE, async (tx) => {
    const tid = await repo.tenantIdByRefreshHash(tx, hash);
    if (!tid) return null;
    await setScope(tx, tenantScope(tid));
    const token = await repo.findRefresh(tx, tid, hash);
    if (!token) return null;
    return { tid, token, user: await repo.findUserById(tx, tid, token.userId) };
  });
}

async function rotate(
  ctx: AuthCtx,
  f: FoundRefresh,
  u: AuthUser,
  meta: ClientMeta,
): Promise<Session> {
  return withScope(ctx.db, tenantScope(f.tid), async (tx: Tx) => {
    await repo.lockUserShared(tx, f.tid, u.id);
    // Đọc lại dưới khoá: user có thể vừa bị khoá/tenant khoá trước khi ta giữ được hàng.
    const fresh = await repo.findUserById(tx, f.tid, u.id);
    if (!fresh || !canSignIn(fresh, fresh.tenant.active)) throw appError("INVALID_REFRESH_TOKEN");
    const id = Bun.randomUUIDv7();
    // Request song song thua race: UPDATE chờ khoá hàng rồi thấy revoked_at đã đặt → 0 hàng.
    if (!(await repo.rotateRefresh(tx, f.tid, f.token.id, id)))
      throw appError("REFRESH_SUPERSEDED");
    const family = { id: f.token.familyId, expiresAt: f.token.expiresAt };
    return issueSession(ctx, tx, fresh, { ...meta, id, family });
  });
}

/** Refresh (FR-02): valid → xoay; rotated ≤ 10 s → SUPERSEDED; thu hồi khác → thu hồi cả chuỗi. */
export async function refresh(
  ctx: AuthCtx,
  token: string | undefined,
  meta: ClientMeta,
): Promise<Session> {
  if (!token) throw appError("INVALID_REFRESH_TOKEN");
  const f = await findRefreshToken(ctx, sha256(token));
  if (!f) throw appError("INVALID_REFRESH_TOKEN");
  const verdict = classifyRefresh(f.token, f.token.dbNow);
  if (verdict === "superseded") throw appError("REFRESH_SUPERSEDED");
  if (verdict === "reuse") {
    await withScope(ctx.db, tenantScope(f.tid), (tx) =>
      repo.revokeFamily(tx, f.tid, f.token.familyId, "reuse"),
    );
    throw appError("INVALID_REFRESH_TOKEN");
  }
  const u = f.user;
  if (verdict === "expired" || !u || !canSignIn(u, u.tenant.active)) {
    throw appError("INVALID_REFRESH_TOKEN");
  }
  return rotate(ctx, f, u, meta);
}

/** Logout (FR-03): idempotent, token lạ/đã thu hồi vẫn thành công. */
export async function logout(ctx: AuthCtx, token: string | undefined): Promise<void> {
  if (!token) return;
  const f = await findRefreshToken(ctx, sha256(token));
  if (!f || f.token.revokedAt !== null) return;
  await withScope(ctx.db, tenantScope(f.tid), (tx) =>
    repo.revokeRefresh(tx, f.tid, f.token.id, "logout"),
  );
}

export type Actor = { userId: string; tenantId: string; sid: string | null };

/** Ghi mật khẩu mới dưới FOR UPDATE; `expectPwc` (bắt buộc) chặn dùng lại change_token khi song song. */
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
  if (await verifyPassword(input.new_password, u.passwordHash))
    throw appError("PASSWORD_UNCHANGED");
  const hash = await hashPassword(input.new_password);
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
  if (!(await verifyPassword(input.current_password, u.passwordHash))) {
    await recordFailedLogin(ctx, u, now);
    throw appError("INVALID_CURRENT_PASSWORD");
  }
  if (input.new_password === input.current_password) throw appError("PASSWORD_UNCHANGED");
  const hash = await hashPassword(input.new_password);
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
