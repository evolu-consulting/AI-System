// ADM-FR-24 (phần tenant, CR-013), ADM-BR-10, ADM-BR-12 · tab "Ai dùng được" (spec M2 §3, M2-R23): tenant có ≥ 1 feature
// của command đang hiệu lực (`on|beta`, và `core` hoặc entitlement chưa thu hồi). Một câu cho cả trang (json_agg,
// count(*) over()). M3-R14: thêm cặp group–feature + visible_user_count qua access.service (cùng luật SQL tham chiếu).
import {
  CORE_FEATURE_KEY,
  type CommandAccessResponse,
  FEATURE_NAME_MAX,
  LocalizedTextSchema,
} from "@ai/contracts";
import { type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { appError } from "../../lib/errors";
import { likeArg } from "../../lib/sql";
import { commandTenantExtras, type TenantExtras } from "../access/access.service";
import * as repo from "./commands.repo";
import type { Call } from "./commands.service";

const NameSchema = LocalizedTextSchema(FEATURE_NAME_MAX);

type Row = {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
  tenant_active: boolean;
  features: { id: string; key: string; name: unknown }[];
  active_user_count: number;
  total: number;
};

async function accessRows(
  tx: Tx,
  commandId: string,
  q: { q?: string; limit: number; offset: number },
): Promise<Row[]> {
  const like = q.q ? likeArg(q.q) : null;
  const rows = await tx.execute(sql`
    select t.id as tenant_id, t.key as tenant_key, t.name as tenant_name, t.active as tenant_active,
      json_agg(json_build_object('id', f.id, 'key', f.key, 'name', f.name)
        order by (f.key <> ${CORE_FEATURE_KEY}), f.key) as features,
      (select count(*)::int from admin.users u
        where u.tenant_id = t.id and u.active and not u.locked_by_tenant) as active_user_count,
      count(*) over()::int as total
    from admin.feature_commands fc
    join admin.features f on f.id = fc.feature_id and f.status in ('on', 'beta')
    join admin.tenants t on f.key = ${CORE_FEATURE_KEY} or exists (
      select 1 from admin.feature_entitlements e
      where e.feature_id = f.id and e.tenant_id = t.id and e.revoked_at is null)
    where fc.command_id = ${commandId}
      and (${like}::text is null or t.key ilike ${like} or t.name ilike ${like})
    group by t.id
    order by t.key
    limit ${q.limit} offset ${q.offset}`);
  return rows as unknown as Row[];
}

export function commandAccess(
  c: Call,
  commandId: string,
  q: { q?: string; limit: number; offset: number },
): Promise<CommandAccessResponse> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const cmd = await repo.findCommand(tx, commandId);
    if (!cmd) throw appError("NOT_FOUND");
    const rows = await accessRows(tx, commandId, q);
    const extras = await commandTenantExtras(
      tx,
      commandId,
      rows.map((r) => r.tenant_id),
    );
    return {
      items: rows.map(({ total: _t, features, ...r }) => ({
        ...r,
        features: features.map((f) => ({ id: f.id, key: f.key, name: NameSchema.parse(f.name) })),
        ...(extras.get(r.tenant_id) as TenantExtras),
      })),
      total: rows[0]?.total ?? 0,
      command_active: cmd.enabled && cmd.workflowEnabled,
    };
  });
}
