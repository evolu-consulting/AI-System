// CR-118 · UW-FR-04 · UW-FR-16..19 · route read-model năng lực. JWT + tường lửa đối tác ở gốc (`/pack`, `/hub-admin` trong
// `PROTECTED_PREFIXES`). `GET /pack/me`: mọi user đăng nhập (đối tác chỉ thấy gói mở cho đối tác). `GET /hub-admin/tenants/
// :id/capabilities`: platform_admin mọi tenant; tenant_admin chỉ tenant mình (chỉ đọc); member ⇒ 403 trước mọi đọc; đối tác
// bị tường lửa chặn 403. ETag/If-None-Match ⇒ 304; Cache-Control private, no-cache.
import { UuidSchema } from "@ai/contracts/common";
import { type Context, Hono } from "hono";
import { requireAdminRole } from "../../lib/admin-role.middleware";
import type { AuthVars } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { etagMatches } from "./capabilities.rules";
import type { CapabilitiesService, Tagged } from "./capabilities.service";

function tagged(c: Context<AuthVars>, t: Tagged): Response {
  const headers = { ETag: t.etag, "Cache-Control": "private, no-cache", Vary: "Authorization" };
  if (etagMatches(c.req.header("if-none-match"), t.etag))
    return new Response(null, { status: 304, headers });
  return new Response(t.body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json; charset=UTF-8" },
  });
}

/** Mount dưới `/pack` (TRƯỚC hay SAU `/:pack_key/me` đều được: `/me` một đoạn không trùng). */
export function shellMeRoutes(svc: CapabilitiesService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/me", async (c) => tagged(c, await svc.shellMe(c.var.user)));
  return r;
}

/** Mount dưới `/hub-admin`. */
export function capabilitiesAdminRoutes(svc: CapabilitiesService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use("/tenants/*", requireAdminRole());
  r.get("/tenants/:id/capabilities", async (c) => {
    const u = c.var.user;
    const id = UuidSchema.safeParse(c.req.param("id"));
    if (!id.success) throw appError("NOT_FOUND");
    if (u.role !== "platform_admin" && id.data !== u.tenantId) throw appError("FORBIDDEN");
    const t = await svc.tenantCapabilities(id.data);
    if (!t) throw appError("NOT_FOUND");
    return tagged(c, t);
  });
  return r;
}
