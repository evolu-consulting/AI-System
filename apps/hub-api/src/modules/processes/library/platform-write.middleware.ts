// CR-127 · E8 · BR-10/11 · quy trình công ty do QUẢN TRỊ NỀN TẢNG soạn; quản trị công ty chỉ xem. Chặn mọi route GHI (không phải
// GET/HEAD) của tenant_admin: 403 `FORBIDDEN_TENANT_ADMIN_WRITE` TRƯỚC parse body/đọc DB (không lộ công ty có tồn tại hay không).
// CHỈ chặn vai `tenant_admin`; KHÔNG tự kiểm vai khác ⇒ phải đặt SAU `requireAdminRole()` (member 403 `FORBIDDEN` ở đó). Lưới thứ hai ở
// service (`assertPlatformWrite` / `DefsService`): mọi vai ≠ `platform_admin` ghi ⇒ 403 `FORBIDDEN_TENANT_ADMIN_WRITE`.
import type { MiddlewareHandler } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { claimError } from "../core/errors";

export function tenantAdminReadOnly(): MiddlewareHandler<AuthVars> {
  return async (c, next) => {
    const m = c.req.method;
    if (m !== "GET" && m !== "HEAD" && c.get("user").role === "tenant_admin")
      throw claimError("FORBIDDEN_TENANT_ADMIN_WRITE");
    await next();
  };
}
