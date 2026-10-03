// ADM-FR-32, ADM-BR-12 · đọc grant (list + một hàng) và map sang contract `Grant` (spec M3 §3). Chỉ đọc, không khoá.
// `entitled` tính lúc đọc từ `feature_entitlements.revoked_at IS NULL` (không có cột "đã tính sẵn", M3-R10).
import {
  BETA_GROUP_KEY,
  CORE_FEATURE_KEY,
  FEATURE_NAME_MAX,
  type FeatureStatus,
  GROUP_NAME_MAX,
  type Grant,
  LocalizedTextSchema,
} from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";

const FeatureName = LocalizedTextSchema(FEATURE_NAME_MAX);
const GroupName = LocalizedTextSchema(GROUP_NAME_MAX);

type Row = {
  id: string;
  tenant_id: string;
  f_id: string;
  f_key: string;
  f_name: unknown;
  f_status: FeatureStatus;
  g_id: string | null;
  g_key: string | null;
  g_name: unknown;
  u_id: string | null;
  u_username: string | null;
  u_display_name: string | null;
  entitled: boolean;
  granted_at: string;
  granted_by: string | null;
  total: number;
};

function subjectOf(r: Row): Grant["subject"] {
  if (r.g_id) {
    const key = r.g_key as string;
    const group = {
      id: r.g_id,
      key,
      name: GroupName.parse(r.g_name),
      is_beta: key === BETA_GROUP_KEY,
    };
    return { type: "group", group };
  }
  const user = {
    id: r.u_id as string,
    username: r.u_username as string,
    display_name: r.u_display_name as string,
  };
  return { type: "user", user };
}

export function toGrant(r: Row): Grant {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    feature: {
      id: r.f_id,
      key: r.f_key,
      name: FeatureName.parse(r.f_name),
      status: r.f_status,
      is_core: r.f_key === CORE_FEATURE_KEY,
    },
    subject: subjectOf(r),
    entitled: r.entitled,
    granted_at: new Date(r.granted_at).toISOString(),
    granted_by: r.granted_by,
  };
}

export type GrantFilter = {
  tenantId: string | null;
  id?: string;
  featureId?: string;
  groupId?: string;
  userId?: string;
  q?: string;
  limit: number;
  offset: number;
};

/** Sắp feature.key, group trước user, rồi group.key/username (spec M3 §3). */
export async function grantRows(tx: Tx, f: GrantFilter): Promise<Row[]> {
  const like = f.q ? likeArg(f.q) : null;
  // `base` MATERIALIZED: chặn planner đẩy LIMIT xuống đi theo features.key (RLS làm nó đoán 224 hàng → lồng 200 × 20k hàng,
  // ~1,1 s). `page`: lọc + sắp + cắt trang chỉ với cột khoá; chi tiết (entitled, granted_by, tên) chỉ tính cho ≤ limit hàng.
  return (await tx.execute(sql`
    with base as materialized (
      select fg.id, fg.tenant_id, fg.feature_id, fg.group_id, fg.user_id, fg.granted_at, fg.granted_by,
        f.key as f_key, g.key as g_key,
        case when fg.user_id is not null then (select a.username from admin.users a where a.id = fg.user_id) end as u_key
      from admin.feature_grants fg
      join admin.features f on f.id = fg.feature_id
      left join admin.groups g on g.id = fg.group_id
      where (${f.tenantId}::uuid is null or fg.tenant_id = ${f.tenantId})
        and (${f.id ?? null}::uuid is null or fg.id = ${f.id ?? null})
        and (${f.featureId ?? null}::uuid is null or fg.feature_id = ${f.featureId ?? null})
        and (${f.groupId ?? null}::uuid is null or fg.group_id = ${f.groupId ?? null})
        and (${f.userId ?? null}::uuid is null or fg.user_id = ${f.userId ?? null})
        and (${like}::text is null or f.key ilike ${like} or f.name->>'vi' ilike ${like}
             or f.name->>'en' ilike ${like})),
    page as (
      select b.*, (select count(*) from base)::int as total from base b
      order by b.f_key, (b.group_id is null), b.g_key, b.u_key, b.id
      limit ${f.limit} offset ${f.offset})
    select p.id, p.tenant_id, f.id as f_id, f.key as f_key, f.name as f_name, f.status as f_status,
      g.id as g_id, g.key as g_key, g.name as g_name, u.id as u_id, u.username as u_username,
      u.display_name as u_display_name, p.granted_at,
      exists (select 1 from admin.feature_entitlements e where e.feature_id = p.feature_id
        and e.tenant_id = p.tenant_id and e.revoked_at is null) as entitled,
      (select a.username from admin.users a where a.id = p.granted_by) as granted_by,
      p.total
    from page p
    join admin.features f on f.id = p.feature_id
    left join admin.groups g on g.id = p.group_id
    left join admin.users u on u.id = p.user_id
    order by p.f_key, (p.group_id is null), p.g_key, p.u_key, p.id`)) as unknown as Row[];
}

export async function grantById(tx: Tx, tenantId: string, id: string): Promise<Grant> {
  const [row] = await grantRows(tx, { tenantId, id, limit: 1, offset: 0 });
  if (!row) throw new Error("grants: không đọc lại được grant");
  return toGrant(row);
}
