// HUB-FR-78, HUB-FR-87 · H3b-R01 · PL8 · chặn role không phải quản trị ở API quản trị Hub (`/agent-grants*`): 403
// FORBIDDEN trước mọi parse body/query và trước mọi đọc DB. Đặt SAU `requireAuth` (cần `c.var.user`).
import type { Role } from "@ai/contracts";
import type { MiddlewareHandler } from "hono";
import type { AuthVars } from "./auth.middleware";
import { appError } from "./errors";

const ADMIN_ROLES: ReadonlySet<Role> = new Set<Role>(["tenant_admin", "platform_admin"]);

export const isAdminRole = (role: Role): boolean => ADMIN_ROLES.has(role);

/** `member` (và mọi role ngoài danh sách) ⇒ 403. Vắng user (gắn sai thứ tự middleware) ⇒ 401, fail-closed. */
export function requireAdminRole(): MiddlewareHandler<AuthVars> {
  return async (c, next) => {
    const user = c.var.user as AuthVars["Variables"]["user"] | undefined;
    if (!user) throw appError("AUTH_EXPIRED");
    if (!isAdminRole(user.role)) throw appError("FORBIDDEN");
    await next();
  };
}
