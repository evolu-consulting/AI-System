// portal-home · `GET /me/portal`, `PUT /me/default-app`, `PUT /me/tenant-default-app`. RLS lo cô lập tenant; ở đây chỉ ghi dòng của chính
// người gọi (users.id = actor) và tenant của chính họ (tenants.id = actor.tenantId) — không nhận id từ client.
import type { DefaultAppRequest, PortalResponse } from "@ai/contracts";
import { type Tx, withConfigWrite, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { type Actor, scopeOf } from "../../lib/auth-middleware";
import { publishConfigChanged } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { type AppCatalogCtx, openableIn, portalAppsIn } from "./app-catalog.service";
import { canSetTenantDefault, effectiveDefaultApp } from "./portal.rules";

type One = { v: string | null };
type Cnt = { n: number };

export function getPortal(ctx: AppCatalogCtx, actor: Actor): Promise<PortalResponse> {
  return withScope(ctx.db, scopeOf(actor), async (tx) => {
    const u = (await tx.execute(
      sql`SELECT default_app AS v FROM admin.users WHERE id = ${actor.userId}`,
    )) as unknown as One[];
    const t = (await tx.execute(
      sql`SELECT default_app AS v FROM admin.tenants WHERE id = ${actor.tenantId}`,
    )) as unknown as One[];
    const view = await portalAppsIn(tx, actor);
    const keys = view.apps.map((r) => r.key);
    const user = u[0]?.v ?? null;
    const tenant = t[0]?.v ?? null;
    let admin: PortalResponse["admin"] = null;
    if (canSetTenantDefault(actor.role)) {
      const c = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM admin.users
            WHERE tenant_id = ${actor.tenantId} AND created_at > now() - interval '7 days'`,
      )) as unknown as Cnt[];
      // Góp ý chưa xử lý: RLS của feedback cần `app.fb_all` (admin xem hết trong phạm vi tenant; platform thấy hết).
      await tx.execute(sql`SELECT set_config('app.fb_all', '1', true)`);
      const f = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM admin.feedback WHERE status = 'new'`,
      )) as unknown as Cnt[];
      admin = { new_users_7d: c[0]?.n ?? 0, pending_feedback: f[0]?.n ?? 0 };
    }
    return {
      default_app: { user, tenant, effective: effectiveDefaultApp(user, tenant, keys, view.chat) },
      admin,
      chat: view.chat,
    };
  });
}

async function assertOpenable(
  ctx: AppCatalogCtx,
  actor: Actor,
  b: DefaultAppRequest,
): Promise<void> {
  if (b.app === null) return;
  const keys = await withScope(ctx.db, scopeOf(actor), async (tx) =>
    (await openableIn(tx, actor)).map((r) => r.key),
  );
  if (!keys.includes(b.app)) throw appError("INVALID_REFERENCE");
}

export async function setMyDefaultApp(
  ctx: AppCatalogCtx,
  actor: Actor,
  b: DefaultAppRequest,
): Promise<PortalResponse> {
  await assertOpenable(ctx, actor, b);
  await writeDefaultApp(ctx, actor, "user", (tx) =>
    tx.execute(sql`UPDATE admin.users SET default_app = ${b.app}
      WHERE id = ${actor.userId} AND default_app IS DISTINCT FROM ${b.app} RETURNING id`),
  );
  return getPortal(ctx, actor);
}

/**
 * CR-118 · default_app là cấu hình Hub đọc (home của `/pack/me`): đổi hàng ⇒ bump `config_version` CÙNG transaction + NOTIFY
 * `config_changed` kèm tenant_id sau commit. Không đổi (cùng giá trị) ⇒ không bump.
 */
export async function writeDefaultApp(
  ctx: AppCatalogCtx,
  actor: Actor,
  entity: "user" | "tenant",
  write: (tx: Tx) => Promise<unknown>,
  tenantId: string = actor.tenantId,
): Promise<void> {
  const r = await withConfigWrite(ctx.db, scopeOf(actor), async (tx, ch) => {
    const rows = (await write(tx)) as unknown as unknown[];
    if (rows.length > 0) ch.changed({ entity, tenantId });
  });
  if (r.version !== null) await publishConfigChanged(ctx.db, r.version, r.events);
}

export async function setTenantDefaultApp(
  ctx: AppCatalogCtx,
  actor: Actor,
  b: DefaultAppRequest,
): Promise<PortalResponse> {
  if (!canSetTenantDefault(actor.role)) throw appError("FORBIDDEN");
  await assertOpenable(ctx, actor, b);
  await writeDefaultApp(ctx, actor, "tenant", (tx) =>
    tx.execute(sql`UPDATE admin.tenants SET default_app = ${b.app}
      WHERE id = ${actor.tenantId} AND default_app IS DISTINCT FROM ${b.app} RETURNING id`),
  );
  return getPortal(ctx, actor);
}
