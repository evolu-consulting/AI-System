// TK1 · builder dữ liệu THEO TẬP (Luật 4c): mỗi hàm = số câu SQL cố định (không phụ thuộc n), `INSERT … SELECT` từ
// `generate_series` / `jsonb_to_recordset`. Chạy bằng kết nối owner (bỏ RLS). Id tất định, trùng `uuidOf(ns, n)` của env.ts.
import type { Sql } from "./db";
import { uuidOf } from "./env";

const NS_TENANT = 0xa1;
const NS_USER = 0xa2;
const NS_CONTRACT = 0xa3;
export const tenantId = (n: number): string => uuidOf(NS_TENANT, n);
export const userId = (n: number): string => uuidOf(NS_USER, n);
export const contractId = (n: number): string => uuidOf(NS_CONTRACT, n);

/** Biểu thức SQL cho `uuidOf(ns, <expr>)`; `ns` là hằng nguyên (an toàn khi ghép chuỗi). */
const uuidSql = (ns: number, expr: string): string =>
  `('7e5d${ns.toString(16).padStart(4, "0")}-0000-4000-8000-' || lpad(to_hex(${expr}), 12, '0'))::uuid`;

/** `n` tenant: key `t<i>`, id `tenantId(i)`, i = from … from+n-1. 1 câu. */
export async function tenants(sql: Sql, n: number, from = 1): Promise<string[]> {
  await sql.unsafe(
    `insert into admin.tenants (id, key, name)
     select ${uuidSql(NS_TENANT, "i")}, 't' || i, 'Tenant ' || i from generate_series($1::int, $2::int) i`,
    [from, from + n - 1],
  );
  return Array.from({ length: n }, (_, k) => tenantId(from + k));
}

export type UsersOpts = { from?: number; hash?: string; role?: "member" | "tenant_admin" };
/**
 * `n` user thuộc `tenant`: username `u<i>`, id `userId(i)`; `i` liên tục theo `from` (đặt `from` khác nhau khi dựng nhiều tenant).
 * 1 câu. `hash` mặc định là chuỗi giữ chỗ — dùng `makeHashes` của M1 nếu cần đăng nhập thật.
 */
export async function users(
  sql: Sql,
  tenant: string,
  n: number,
  o: UsersOpts = {},
): Promise<string[]> {
  const from = o.from ?? 1;
  const role = o.role ?? "member";
  await sql.unsafe(
    `insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role)
     select ${uuidSql(NS_USER, "i")}, $1::uuid, 'u' || i, 'u' || i || '@kit.test', $2, 'User ' || i, $3
     from generate_series($4::int, $5::int) i`,
    [tenant, o.hash ?? "kit-placeholder-hash", role, from, from + n - 1],
  );
  return Array.from({ length: n }, (_, k) => userId(from + k));
}

/** Group theo khoá cho `tenant`; trùng khoá bỏ qua. 1 câu. Trả `key -> id`. */
export async function groups(
  sql: Sql,
  tenant: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const rows = await sql<{ key: string; id: string }[]>`
    insert into admin.groups (tenant_id, key, name)
    select ${tenant}::uuid, k, jsonb_build_object('vi', k) from unnest(${sql.array([...keys])}::text[]) k
    on conflict (tenant_id, key) do update set key = excluded.key
    returning key, id`;
  return new Map(rows.map((r) => [r.key, r.id]));
}

/** Thêm user vào group (nhiều-nhiều theo tập). 1 câu. Trùng bỏ qua. */
export async function members(
  sql: Sql,
  tenant: string,
  groupId: string,
  userIds: readonly string[],
): Promise<void> {
  await sql`insert into admin.group_members (tenant_id, group_id, user_id)
    select ${tenant}::uuid, ${groupId}::uuid, u from unnest(${sql.array([...userIds])}::uuid[]) u
    on conflict do nothing`;
}

export const PACK_ROLES = ["owner", "editor", "viewer"] as const;
export type PackRole = (typeof PACK_ROLES)[number];
const ROLE_ACTIONS: Record<PackRole, readonly string[]> = {
  owner: ["read", "write", "admin"],
  editor: ["read", "write"],
  viewer: ["read"],
};
const fk = (k: string): string => k.replaceAll("_", "-");

/**
 * Bật gói `key` cho các tenant bằng SQL (tương đương `PUT /admin/tenants/:id/packs/:key`): entitlement 3 feature, 3 Group vai,
 * 6 grant. Số câu = 3, không phụ thuộc số tenant. Trả `tenant -> role -> group_id`.
 */
export async function enablePack(
  sql: Sql,
  tenantIds: readonly string[],
  key: string,
): Promise<Map<string, Record<PackRole, string>>> {
  const feats = ["read", "write", "admin"].map((a) => `${fk(key)}-${a}`);
  const tids = sql.array([...tenantIds]);
  await sql`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t from admin.features f, unnest(${tids}::uuid[]) t where f.key = any(${sql.array(feats)}::text[])
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  const groupRows = await sql<{ tenant_id: string; key: string; id: string }[]>`
    insert into admin.groups (tenant_id, key, name)
    select t, ${fk(key)} || '-' || r, jsonb_build_object('vi', ${key} || ' · ' || r)
    from unnest(${tids}::uuid[]) t, unnest(${sql.array([...PACK_ROLES])}::text[]) r
    on conflict (tenant_id, key) do update set key = excluded.key
    returning tenant_id, key, id`;
  const pairs = PACK_ROLES.flatMap((r) =>
    ROLE_ACTIONS[r].map((a) => ({ grp: `${fk(key)}-${r}`, feat: `${fk(key)}-${a}` })),
  );
  await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id)
    select g.tenant_id, f.id, g.id
    from admin.groups g
    join jsonb_to_recordset(${sql.json(pairs)}) as p(grp text, feat text) on g.key = p.grp
    join admin.features f on f.key = p.feat
    where g.tenant_id = any(${tids}::uuid[])
    on conflict (tenant_id, feature_id, group_id) where group_id is not null do nothing`;
  const out = new Map<string, Record<PackRole, string>>();
  for (const g of groupRows) {
    const role = PACK_ROLES.find((r) => g.key === `${fk(key)}-${r}`);
    if (!role) continue;
    const rec = out.get(g.tenant_id) ?? ({} as Record<PackRole, string>);
    rec[role] = g.id;
    out.set(g.tenant_id, rec);
  }
  return out;
}

export type ContractsOpts = {
  from?: number;
  createdBy: string;
  status?: string;
  /** Người phụ trách (`owner_user_id`); mặc định null (chưa giao). */
  owner?: string | null;
};
/** `n` hợp đồng mẫu của `tenant` (`contracts.contracts`): id `contractId(i)`, title `HD i`. 1 câu. */
export async function contracts(
  sql: Sql,
  tenant: string,
  n: number,
  o: ContractsOpts,
): Promise<string[]> {
  const from = o.from ?? 1;
  await sql.unsafe(
    `insert into contracts.contracts (id, tenant_id, title, status, created_by, owner_user_id)
     select ${uuidSql(NS_CONTRACT, "i")}, $1::uuid, 'HD ' || i, $2, $3::uuid, $6::uuid
     from generate_series($4::int, $5::int) i`,
    [tenant, o.status ?? "active", o.createdBy, from, from + n - 1, o.owner ?? null],
  );
  return Array.from({ length: n }, (_, k) => contractId(from + k));
}

/** M1D · gán quản lý `[user, manager]` (theo tập, 1 câu; trigger duy trì closure + chặn vòng). Trùng user ⇒ đổi quản lý. */
export async function managers(
  sql: Sql,
  tenant: string,
  pairs: readonly (readonly [string, string])[],
): Promise<void> {
  await sql`insert into admin.user_managers (tenant_id, user_id, manager_id)
    select ${tenant}::uuid, p.u, p.m
    from jsonb_to_recordset(${sql.json(pairs.map(([u, m]) => ({ u, m })))}) as p(u uuid, m uuid)
    on conflict (user_id) do update set manager_id = excluded.manager_id`;
}

/** M1D · phòng ban = Group `key` + hàng `admin.departments` (trưởng phòng) + thành viên. 3 câu. Trả group id.
 *  `[head, memberIds]` gom thành tuple (≤ 4 tham số, CONVENTIONS §4) — lời gọi vị trí giữ nguyên. */
export async function department(
  sql: Sql,
  tenant: string,
  key: string,
  ...[head, memberIds]: [head: string | null, memberIds: readonly string[]]
): Promise<string> {
  const g = (await groups(sql, tenant, [key])).get(key) as string;
  await sql`insert into admin.departments (tenant_id, group_id, head_user_id)
    values (${tenant}::uuid, ${g}::uuid, ${head}::uuid)
    on conflict (group_id) do update set head_user_id = excluded.head_user_id`;
  if (memberIds.length) await members(sql, tenant, g, memberIds);
  return g;
}

/** M1D-FR-04 · chế độ thấy của gói contracts cho các tenant (`tenant` = cả tenant, `org` = luật mgmt-app). 1 câu. */
export async function visibility(
  sql: Sql,
  tenantIds: readonly string[],
  mode: "tenant" | "org",
): Promise<void> {
  await sql`insert into contracts.visibility_settings (tenant_id, mode)
    select t, ${mode} from unnest(${sql.array([...tenantIds])}::uuid[]) t
    on conflict (tenant_id) do update set mode = excluded.mode, updated_at = now()`;
}
