// CR-102a · com-c2-ext-deny: tường lửa user ngoài (đối tác) của hub-api — đặt NGAY SAU `requireAuth` trên mọi gốc route cần
// JWT. Đối tác gọi ngoài `externalPathAllowed` ⇒ 403 `FORBIDDEN` (từ chối mặc định: route mới thêm sau này cũng bị chặn mà
// không cần nhớ). Nội bộ đi tiếp không đổi (0 SQL, 0 I/O). Các lớp sau (packGuard, chat-gate, quyền agent, danh bạ, RLS
// `contracts`) vẫn tự chặn đối tác — đây chỉ là lớp ngoài cùng.
import type { MiddlewareHandler } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError } from "../../../../lib/errors";
import { isExternal } from "../application/ext-org.ports";
import { externalPathAllowed } from "../domain/external-access.rules";

export function externalFirewall(): MiddlewareHandler<{ Variables: { user: AuthUser } }> {
  return async (c, next) => {
    const u = c.get("user");
    if (u && isExternal(u) && !externalPathAllowed(c.req.path))
      throw new AppError("FORBIDDEN", 403, "Forbidden");
    await next();
  };
}
