// HUB-FR-01, HUB-FR-88 · H1-R02, H1-R04 · middleware xác thực Bearer của hub-api (plan §4 "Middleware").
// Token hỏng/hết hạn/thiếu, tenant/user không dùng được theo cache cấu hình → 401 AUTH_EXPIRED (contract chat).
// Không đọc DB mỗi request: trạng thái khoá lấy từ ConfigCache (B3), đổi trong ≤ 5 s nhờ LISTEN `config_changed`.
import type { Role } from "@ai/contracts";
import type { Context, MiddlewareHandler } from "hono";
import type { ConfigCache } from "../modules/config/config.service";
import { appError } from "./errors";
import { verifyAccessToken } from "./jwt";
import type { Logger } from "./logger";

export type AuthUser = { userId: string; tenantId: string; role: Role };
/** Biến context middleware cần/gắn (AppVars của app là tập cha). */
export type AuthVars = { Variables: { log: Logger; config?: ConfigCache; user: AuthUser } };

const BEARER_RE = /^Bearer ([A-Za-z0-9._-]+)$/;

/** Bearer hợp lệ + tài khoản dùng được → AuthUser; ngược lại ném 401 AUTH_EXPIRED. */
export async function authenticate(
  c: Context<AuthVars>,
  key: CryptoKey | undefined,
): Promise<AuthUser> {
  const m = BEARER_RE.exec(c.req.header("authorization") ?? "");
  const claims = key && m?.[1] ? await verifyAccessToken(key, m[1]) : null;
  if (!claims) throw appError("AUTH_EXPIRED");
  // Fail-closed: không có cache (app dựng không kèm db) ⇒ không xác minh được trạng thái ⇒ từ chối.
  const usable = await c.var.config?.accountUsable(claims.tid, claims.sub);
  if (usable !== true) throw appError("AUTH_EXPIRED");
  return { userId: claims.sub, tenantId: claims.tid, role: claims.role };
}

/** `key` vắng (test khung) ⇒ mọi request vào route được bảo vệ đều 401. */
export function requireAuth(key: CryptoKey | undefined): MiddlewareHandler<AuthVars> {
  return async (c, next) => {
    const user = await authenticate(c, key);
    c.set("user", user);
    c.set("log", c.var.log.child({ tenant_id: user.tenantId, user_id: user.userId }));
    await next();
  };
}
