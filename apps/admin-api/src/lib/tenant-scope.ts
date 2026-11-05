// CR-112 · ADM-FR-81 · phạm vi workspace công ty `/admin/tenants/:id*` — MỘT chỗ cho mọi route theo tenant.
// Thứ tự kiểm (bảng route ở docs/specs/cr112-tenant-scope/tasks.md): đăng nhập (401) → vai quản trị (member/đối tác ⇒ 403)
// → tenant_admin chỉ tenant mình (tenant khác ⇒ 404, không lộ tồn tại) → route chỉ-platform kiểm tiếp bằng requireRole (403).
import type { Role } from "@ai/contracts/common";
import type { Context, MiddlewareHandler } from "hono";
import { type AppVars, type AuthDeps, requireAuth } from "./auth-middleware";
import { appError } from "./errors";

/** Luật thuần: platform_admin mọi tenant; vai khác chỉ tenant của mình. */
export function canAddressTenant(actor: { role: Role; tenantId: string }, tid: string): boolean {
  return actor.role === "platform_admin" || actor.tenantId === tid;
}

/** Tenant ngoài phạm vi actor ⇒ 404 NOT_FOUND (cùng body với id không tồn tại). */
export function requireTenantScope(c: Context<AppVars>, tid: string): void {
  if (!canAddressTenant(c.get("actor"), tid)) throw appError("NOT_FOUND");
}

const ADMIN_ROLES: readonly Role[] = ["platform_admin", "tenant_admin"];

/** Cổng chung gắn ở `/admin/tenants/:id/*` (app.ts) TRƯỚC mọi router `/admin/tenants`. */
export function tenantWorkspaceGate(d: AuthDeps): MiddlewareHandler<AppVars>[] {
  return [
    requireAuth(d),
    async (c, next) => {
      if (!ADMIN_ROLES.includes(c.get("actor").role)) throw appError("FORBIDDEN");
      requireTenantScope(c, c.req.param("id") ?? "");
      await next();
    },
  ];
}
