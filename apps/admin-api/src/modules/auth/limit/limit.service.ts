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
import { accountId } from "./limit.keys";
import type { LoginLimiter } from "./limit.redis";
import { ipId, retryAfterS } from "./limit.rules";

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

/** Một lượt login đã giữ chỗ (A-3): kết thúc bằng đúng một trong fail/ok; `release` (finally) nhả chỗ nếu chưa kết thúc. */
export type LoginSlot = {
  fail(u: LockedUser | null): Promise<void>;
  ok(): Promise<void>;
  release(): Promise<void>;
};

/**
 * Trước login: IP +1 (429 khi vượt), khoá tài khoản (423 `{until}`), rồi giữ chỗ lượt verify — đủ chỗ (lần sai đã ghi +
 * lượt đang chạy = trần) ⇒ 429 `retry_after_s: 1`. Tất cả trước mọi phép băm, cùng cách cho tài khoản lạ.
 */
export async function openLoginSlot(
  x: { db: Db; limiter: LoginLimiter },
  ip: string | null,
  account: string,
  now: Date,
): Promise<LoginSlot> {
  const l = x.limiter;
  const token = Bun.randomUUIDv7();
  const r = await store("pre", l.pre(ipId(ip), account, now.getTime(), token));
  if (r.kind === "ip_limited") throw rateLimited(retryAfterS(r.resetAt, now.getTime()));
  if (r.kind === "locked") throw tempLocked(new Date(r.until));
  if (r.kind === "busy") throw rateLimited(1);
  let open = true;
  const settle = async (p: Promise<unknown>, op: string) => {
    open = false;
    await store(op, p);
  };
  return {
    fail: async (u) => {
      open = false;
      await recordLoginFail(x, { account, token, now }, u);
    },
    ok: () => settle(l.success(account, token), "success"),
    release: async () => {
      if (!open) return;
      open = false;
      // Không che lỗi gốc của lượt; chỗ giữ tự hết hạn sau RESERVE_MS nếu Redis lỗi.
      await l.release(account, token).catch((err: unknown) => {
        logger.warn("auth-limit-store", {
          op: "release",
          error: err instanceof Error ? err.message : "?",
        });
      });
    },
  };
}

/** Endpoint kiểm mật khẩu/OTP khác (TOTP, đổi mật khẩu): chỉ IP. */
export async function checkIp(l: LoginLimiter, ip: string | null, now: Date): Promise<void> {
  const r = await store("pre", l.pre(ipId(ip), null, now.getTime()));
  if (r.kind === "ip_limited") throw rateLimited(retryAfterS(r.resetAt, now.getTime()));
}

export type LockedUser = { id: string; tenantId: string; username: string };

/** Một lần sai: khoá mới + tài khoản có thật ⇒ audit (tx riêng, actor hệ thống). */
async function recordLoginFail(
  x: { db: Db; limiter: LoginLimiter },
  t: { account: string; token: string; now: Date },
  u: LockedUser | null,
): Promise<void> {
  const until = await store("fail", x.limiter.fail(t.account, t.now.getTime(), t.token));
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
