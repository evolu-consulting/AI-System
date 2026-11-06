// CR-122 · N1 · FLOW2-FR-25 · `GET /process-palette?app=&tenant_id=` — bảng node cho trình sửa: node lõi + node của app có tính
// năng đang bật cho công ty (tenant_admin luôn công ty mình; platform_admin `?tenant_id` = công ty đó, vắng = sửa Thư viện ⇒ mọi
// node). Không logic: role admin (403) → parse → `paletteOf`.
import { UuidSchema } from "@ai/contracts/common";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminRole } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseAdminQuery } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { paletteOf } from "../defs/node-features";

const QuerySchema = z.strictObject({
  app: z
    .string()
    .regex(/^[a-z0-9-]{2,32}$/)
    .optional(),
  tenant_id: UuidSchema.optional(),
});

export function paletteRoutes(d: ProcessDeps): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use("/process-palette", requireAdminRole());
  r.get("/process-palette", async (c) => {
    const q = parseAdminQuery(c, QuerySchema);
    const u = c.var.user;
    const tenantId = u.role === "platform_admin" ? (q.tenant_id ?? null) : u.tenantId;
    const items = await paletteOf(d.config, tenantId, q.app);
    return c.json({ items });
  });
  return r;
}
