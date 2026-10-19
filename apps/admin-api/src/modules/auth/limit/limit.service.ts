// L1 (TECH-DEBT #224) · ADM-FR-07 · giới hạn đăng nhập: IP (429), tài khoản (423 TEMP_LOCKED như M1, cả tài khoản không
// tồn tại), trần CPU băm mật khẩu (semaphore ⇒ 503). Redis lỗi ⇒ 503 AUTH_UNAVAILABLE (đóng an toàn, khuyến nghị
// của security N5/N5b L1). Khoá mới của tài khoản CÓ THẬT ghi audit (`summary.op = login_lockout`, actor = hệ thống).
import { AUTH_LIMIT_ERRORS, type AuthLimitErrorCode } from "@ai/contracts";
import { type Db, type Tx, withScope } from "@ai/db";
import { auditOf, recordAudit } from "../../../lib/audit/audit.write";
import { AppError, isAppError } from "../../../lib/errors";
import { logger } from "../../../lib/logger";
import { type Semaphore, SemaphoreFullError } from "../../../lib/semaphore";
import { tempLocked } from "../auth.errors";
import type { LoginLimiter } from "./limit.redis";
import { accountId, ipId, retryAfterS } from "./limit.rules";

const MESSAGES: Record<AuthLimitErrorCode, string> = {
  RATE_LIMITED: "Too many sign-in attempts; try again later",
  AUTH_UNAVAILABLE: "Sign-in is temporarily unavailable; try again shortly",
};

function limitError(code: AuthLimitErrorCode, retryS: number, details?: unknown): AppError {
  return new AppError(code, AUTH_LIMIT_ERRORS[code], MESSAGES[code], details, {
    "Retry-After": String(retryS),
  });
}

export const rateLimited = (retryS: number) =>
  limitError("RATE_LIMITED", retryS, { retry_after_s: retryS });
export const authUnavailable = () => limitError("AUTH_UNAVAILABLE", 5);

/** Lời gọi Redis: lỗi bất kỳ (mất kết nối, timeout) ⇒ 503; lỗi nghiệp vụ (AppError) đi qua nguyên. */
async function store<T>(op: string, p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (isAppError(err)) throw err;
    logger.warn("auth-limit-store", { op, error: err instanceof Error ? err.message : "?" });
    throw authUnavailable();
  }
}

/** Trước login: IP +1 (429 khi vượt) rồi khoá tài khoản (423 `{until}`) — trước mọi phép băm. */
export async function checkLogin(
  l: LoginLimiter,
  ip: string | null,
  account: string,
  now: Date,
): Promise<void> {
  const r = await store("pre", l.pre(ipId(ip), account, now.getTime()));
  if (r.kind === "ip_limited") throw rateLimited(retryAfterS(r.resetAt, now.getTime()));
  if (r.kind === "locked") throw tempLocked(new Date(r.until));
}

/** Endpoint kiểm mật khẩu/OTP khác (TOTP, đổi mật khẩu): chỉ IP. */
export async function checkIp(l: LoginLimiter, ip: string | null, now: Date): Promise<void> {
  const r = await store("pre", l.pre(ipId(ip), null, now.getTime()));
  if (r.kind === "ip_limited") throw rateLimited(retryAfterS(r.resetAt, now.getTime()));
}

export type LockedUser = { id: string; tenantId: string; username: string };

/** Một lần sai: khoá mới + tài khoản có thật ⇒ audit (tx riêng, actor hệ thống). */
export async function recordLoginFail(
  x: { db: Db; limiter: LoginLimiter },
  account: string,
  u: LockedUser | null,
  now: Date,
): Promise<void> {
  const until = await store("fail", x.limiter.fail(account, now.getTime()));
  if (until === null || !u) return;
  await withScope(x.db, { kind: "tenant", tenantId: u.tenantId }, (tx) =>
    recordAudit(tx, {
      ...auditOf("update", "user", {
        entityId: u.id,
        entityName: u.username,
        tenantId: u.tenantId,
        before: null,
        after: null,
        summary: { op: "login_lockout", until: new Date(until).toISOString() },
      }),
      actorId: null,
    }),
  );
}

export const recordLoginSuccess = (l: LoginLimiter, account: string) =>
  store("success", l.success(account));

/** Admin gỡ khoá: xoá bộ đếm Redis của (tenant_key, username); true khi đang khoá. Không limiter ⇒ false; Redis lỗi ⇒ 503. */
export function clearAccountLock(
  l: LoginLimiter | undefined,
  u: { tenantKey: string; username: string },
  now: Date,
): Promise<boolean> {
  if (!l) return Promise.resolve(false);
  return store("clear", l.clear(accountId(u.tenantKey, u.username), now.getTime()));
}

/** Gỡ khoá tạm bởi admin (DB và/hoặc Redis) ⇒ audit `unlock` `summary.op = login_lockout_clear` (L1, thay Q6 M1). */
export async function auditLockClear(tx: Tx, u: LockedUser, actorId: string): Promise<void> {
  await recordAudit(tx, {
    ...auditOf("unlock", "user", {
      entityId: u.id,
      entityName: u.username,
      tenantId: u.tenantId,
      before: null,
      after: null,
      summary: { op: "login_lockout_clear" },
    }),
    actorId,
  });
}

/** Phép băm/verify mật khẩu qua semaphore; hàng đợi đầy ⇒ 503 AUTH_UNAVAILABLE (Retry-After 1). */
export async function hashSlot<T>(s: Semaphore | undefined, fn: () => Promise<T>): Promise<T> {
  if (!s) return fn();
  try {
    return await s.run(fn);
  } catch (err) {
    if (err instanceof SemaphoreFullError) throw limitError("AUTH_UNAVAILABLE", 1);
    throw err;
  }
}
