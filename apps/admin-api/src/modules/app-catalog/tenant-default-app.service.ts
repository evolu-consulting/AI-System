// tenant-default-app · platform_admin xem/đặt app mặc định của công ty BẤT KỲ (`/admin/tenants/:id/default-app`).
// Cùng luật kiểm tra với `PUT /me/tenant-default-app` (khoá app phải có trong catalog); khác: không cần "mở được với người gọi"
// vì platform_admin đặt hộ công ty khác. Ghi audit `update`/`tenant` (summary.op = default_app.set), không bump config_version.
import type { DefaultAppRequest, TenantDefaultAppResponse } from "@ai/contracts";
import { type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf, recordAudit } from "../../lib/audit/audit.write";
import { type Actor, scopeOf } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import * as repo from "./app-catalog.repo";
import type { AppCatalogCtx } from "./app-catalog.service";

type Row = { id: string; key: string; v: string | null };

async function lockTenant(tx: Tx, id: string): Promise<Row> {
  const rows = (await tx.execute(
    sql`SELECT id, key, default_app AS v FROM admin.tenants WHERE id = ${id} FOR UPDATE`,
  )) as unknown as Row[];
  const row = rows[0];
  if (!row) throw appError("NOT_FOUND");
  return row;
}

export function getTenantDefaultApp(
  ctx: AppCatalogCtx,
  actor: Actor,
  tenantId: string,
): Promise<TenantDefaultAppResponse> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => ({
    app: (await lockTenant(tx, tenantId)).v,
  }));
}

export function setTenantDefaultAppFor(
  ctx: AppCatalogCtx,
  actor: Actor,
  tenantId: string,
  b: DefaultAppRequest,
): Promise<TenantDefaultAppResponse> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => {
    const t = await lockTenant(tx, tenantId);
    if (b.app !== null && !(await repo.findOne(tx, b.app))) throw appError("INVALID_REFERENCE");
    if (t.v === b.app) return { app: b.app };
    await tx.execute(sql`UPDATE admin.tenants SET default_app = ${b.app} WHERE id = ${t.id}`);
    await recordAudit(tx, {
      ...auditOf("update", "tenant", {
        entityId: t.id,
        entityName: t.key,
        tenantId: t.id,
        before: null,
        after: null,
        summary: { op: "default_app.set", from: t.v, to: b.app },
      }),
      actorId: actor.userId,
    });
    return { app: b.app };
  });
}
