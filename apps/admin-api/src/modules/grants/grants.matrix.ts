// ADM-FR-35, ADM-BR-12 · `GET /admin/grants/matrix` (spec M3 §3, M3-R09; plan §5.5). Chỉ đọc. Hàng = MỌI feature catalog
// (core đầu rồi key) kèm `state`; cột = group của tenant (beta đầu rồi key, ≤ 200, hoặc đúng `?group_id`). 3 câu.
import {
  CORE_FEATURE_KEY,
  FEATURE_NAME_MAX,
  type FeatureStatus,
  type GrantMatrix,
  type GrantMatrixQuery,
  LocalizedTextSchema,
  MATRIX_COMMAND_NAMES_MAX,
} from "@ai/contracts";
import { type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { appError } from "../../lib/errors";
import { likeArg, pgArray } from "../../lib/sql";
import { groupRefsOf, mustTenant } from "../groups/groups.service";
import { resolveTenantScope } from "../users/users.rules";
import { matrixRowState } from "./grants.rules";
import type { Call } from "./grants.service";

const FeatureName = LocalizedTextSchema(FEATURE_NAME_MAX);

type GroupCol = { id: string; key: string; name: unknown; member_count: number; total: number };
type FeatureRow = {
  id: string;
  key: string;
  name: unknown;
  status: FeatureStatus;
  entitled: boolean;
  revoked: boolean;
  grant_count: number;
  command_names: string[];
  command_count: number;
  granted: string[];
};

async function groupCols(tx: Tx, tenantId: string, q: GrantMatrixQuery): Promise<GroupCol[]> {
  const like = q.q ? likeArg(q.q) : null;
  return (await tx.execute(sql`
    select g.id, g.key, g.name, (select count(*)::int from admin.group_members m where m.group_id = g.id) as member_count,
      count(*) over()::int as total
    from admin.groups g
    where g.tenant_id = ${tenantId} and (${q.group_id ?? null}::uuid is null or g.id = ${q.group_id ?? null})
      and (${like}::text is null or g.key ilike ${like} or g.name->>'vi' ilike ${like} or g.name->>'en' ilike ${like})
    order by (g.key <> 'beta-testers'), g.key
    limit ${q.limit} offset ${q.offset}`)) as unknown as GroupCol[];
}

async function featureRows(tx: Tx, tenantId: string, groupIds: string[]): Promise<FeatureRow[]> {
  return (await tx.execute(sql`
    select f.id, f.key, f.name, f.status,
      coalesce(e.revoked_at is null and e.feature_id is not null, false) as entitled,
      coalesce(e.revoked_at is not null, false) as revoked,
      (select count(*)::int from admin.feature_grants fg where fg.feature_id = f.id and fg.tenant_id = ${tenantId})
        as grant_count,
      array(select c.name from admin.feature_commands fc join admin.commands c on c.id = fc.command_id
        where fc.feature_id = f.id order by c.name limit ${MATRIX_COMMAND_NAMES_MAX}) as command_names,
      (select count(*)::int from admin.feature_commands fc where fc.feature_id = f.id) as command_count,
      array(select fg.group_id::text from admin.feature_grants fg where fg.feature_id = f.id
        and fg.tenant_id = ${tenantId} and fg.group_id = any(${pgArray(groupIds, "uuid")}) order by fg.group_id) as granted
    from admin.features f
    left join admin.feature_entitlements e on e.feature_id = f.id and e.tenant_id = ${tenantId}
    order by (f.key <> ${CORE_FEATURE_KEY}), f.key`)) as unknown as FeatureRow[];
}

export function grantMatrix(c: Call, q: GrantMatrixQuery): Promise<GrantMatrix> {
  const r = resolveTenantScope(c.actor, q.tenant_id, "write");
  if ("code" in r) throw appError(r.code);
  const tenantId = r.tenantId as string;
  return withScope(c.ctx.db, c.scope, async (tx) => {
    await mustTenant(tx, tenantId);
    const cols = await groupCols(tx, tenantId, q);
    if (q.group_id && cols.length === 0) throw appError("NOT_FOUND");
    const refs = groupRefsOf(cols.map(({ id, key, name }) => ({ id, key, name })));
    const rows = await featureRows(
      tx,
      tenantId,
      refs.map((g) => g.id),
    );
    return {
      tenant_id: tenantId,
      groups: refs.map((g, i) => ({ ...g, member_count: cols[i]?.member_count ?? 0 })),
      group_total: cols[0]?.total ?? 0,
      features: rows.map((f) => ({
        feature: {
          id: f.id,
          key: f.key,
          name: FeatureName.parse(f.name),
          status: f.status,
          is_core: f.key === CORE_FEATURE_KEY,
        },
        state: matrixRowState({
          key: f.key,
          entitled: f.entitled,
          revoked: f.revoked,
          grantCount: f.grant_count,
        }),
        command_names: f.command_names,
        command_count: f.command_count,
        granted_group_ids: f.granted,
      })),
    };
  });
}
