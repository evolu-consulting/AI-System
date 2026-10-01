// ADM-FR-62, ADM-FR-32, ADM-FR-36, ADM-FR-53 · dữ liệu fixture M3 (test-plan §3). Dùng chung cho test int (bun) và
// e2e/support (Node/Playwright): chỉ phụ thuộc `postgres`, KHÔNG import bun:test.
import type postgres from "postgres";
import { TENANT_ID, USER_ID } from "../M1/_data";
import { ID, LEAK_1, LEAK_2, leakForms } from "../M2/_data";

type Sql = postgres.Sql;

const pad2 = (n: number): string => String(n).padStart(2, "0");
/** uuid cố định `01900000-0000-7000-8000-0000000003nn` (nn thập phân 00–99). */
export const id3 = (n: number): string => `01900000-0000-7000-8000-0000000003${pad2(n)}`;

export const ID3 = {
  group: { acmeKeToan: id3(1), acmeKinhDoanh: id3(2), globexKeToan: id3(3) },
  feature: { phapChe: id3(11) },
  grant: { g1: id3(21), g2: id3(22), g3: id3(23), g4: id3(24) },
  /** uuid hợp lệ nhưng không có trong DB. */
  unknown: id3(99),
} as const;

export { ID, LEAK_1, LEAK_2, leakForms, TENANT_ID, USER_ID };

/** Đọc trường chưa có trong contract ở thời điểm viết (vd `User.groups` trước T4) — giữ `typecheck` xanh ở Q2–T3. */
export function newField<T>(obj: unknown, key: string): T {
  return (obj as Record<string, unknown>)[key] as T;
}

/** Chạy một câu SQL trả cột `n` và trả số (đếm hàng, đọc version…). */
export async function num(sql: Sql, text: string): Promise<number> {
  const [r] = await sql.unsafe(text);
  return Number((r as unknown as { n: number | string }).n);
}

export type PermParts = {
  phapChe?: boolean;
  groups?: boolean;
  members?: boolean;
  grants?: boolean;
};
export const ALL_PERMISSIONS: PermParts = {
  phapChe: true,
  groups: true,
  members: true,
  grants: true,
};

export async function betaId(sql: Sql, tenantKey: string): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select g.id from admin.groups g
    join admin.tenants t on t.id = g.tenant_id where t.key = ${tenantKey} and g.key = 'beta-testers'`;
  if (!r) throw new Error(`chưa có beta-testers của tenant ${tenantKey} (trigger 0006?)`);
  return r.id;
}

const GROUPS: Array<[string, string, string, string, string | null]> = [
  [ID3.group.acmeKeToan, TENANT_ID.acme, "ke-toan", "Kế toán", "Phòng kế toán"],
  [ID3.group.acmeKinhDoanh, TENANT_ID.acme, "kinh-doanh", "Kinh doanh", null],
  [ID3.group.globexKeToan, TENANT_ID.globex, "ke-toan", "Kế toán", null],
];

/** Chèn dữ liệu quyền M3 bằng owner (sau `seedCatalog`). `beta-testers` đã do trigger tạo. */
export async function seedPermissions(sql: Sql, parts: PermParts = ALL_PERMISSIONS): Promise<void> {
  if (parts.phapChe) {
    await sql`insert into admin.features (id, key, name, description, icon, status)
      values (${ID3.feature.phapChe}, 'phap-che', ${sql.json({ vi: "Pháp chế", en: "Legal" })},
        ${sql.json({})}, 'package', 'on')`;
  }
  if (parts.groups) {
    for (const [id, tenant, key, vi, desc] of GROUPS) {
      await sql`insert into admin.groups (id, tenant_id, key, name, description)
        values (${id}, ${tenant}, ${key}, ${sql.json({ vi, ...(key === "ke-toan" && tenant === TENANT_ID.acme ? { en: "Accounting" } : {}) })}, ${desc})`;
    }
  }
  if (parts.members) {
    const beta = await betaId(sql, "acme");
    const rows: Array<[string, string, string]> = [
      [TENANT_ID.acme, ID3.group.acmeKeToan, USER_ID.lan],
      [TENANT_ID.acme, ID3.group.acmeKeToan, USER_ID.thu],
      [TENANT_ID.acme, ID3.group.acmeKeToan, USER_ID.em],
      [TENANT_ID.acme, beta, USER_ID.thu],
      [TENANT_ID.globex, ID3.group.globexKeToan, USER_ID.khang],
    ];
    for (const [t, g, u] of rows) {
      await sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${t}, ${g}, ${u})`;
    }
  }
  if (parts.grants) {
    const beta = await betaId(sql, "acme");
    await sql`insert into admin.feature_grants (id, tenant_id, feature_id, group_id) values
      (${ID3.grant.g1}, ${TENANT_ID.acme}, ${ID.feature.keToan}, ${ID3.group.acmeKeToan}),
      (${ID3.grant.g2}, ${TENANT_ID.acme}, ${ID.feature.baoCao}, ${beta}),
      (${ID3.grant.g4}, ${TENANT_ID.globex}, ${ID.feature.keToan}, ${ID3.group.globexKeToan})`;
    await sql`insert into admin.feature_grants (id, tenant_id, feature_id, user_id)
      values (${ID3.grant.g3}, ${TENANT_ID.acme}, ${ID.feature.dichThuat}, ${USER_ID.an})`;
  }
}

/** SQL tham chiếu hiệu lực (plan §3.2, BR-11): command thấy được của user `$1`. Chạy được bằng `hub_ro`. */
export const HUB_VISIBLE_SQL = `
select distinct c.id, c.name
from admin.users u
join admin.tenants t on t.id = u.tenant_id and t.active
cross join admin.feature_commands fc
join admin.commands c on c.id = fc.command_id and c.enabled
join admin.workflows w on w.id = c.workflow_id and w.enabled
join admin.features f on f.id = fc.feature_id
where u.id = $1 and u.active and not u.locked_by_tenant
  and (f.status = 'on' or (f.status = 'beta' and exists (
        select 1 from admin.group_members m join admin.groups g on g.id = m.group_id
        where m.user_id = u.id and g.tenant_id = u.tenant_id and g.key = 'beta-testers')))
  and (f.key = 'core' or (
        exists (select 1 from admin.feature_entitlements e
                where e.feature_id = f.id and e.tenant_id = u.tenant_id and e.revoked_at is null)
        and exists (select 1 from admin.feature_grants fg
                where fg.feature_id = f.id and fg.tenant_id = u.tenant_id
                  and (fg.user_id = u.id or fg.group_id in (
                       select m.group_id from admin.group_members m where m.user_id = u.id)))))`;

/** Tên command user thấy được theo `hub_ro` (SQL tham chiếu), sắp tăng. */
export async function hubVisible(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql.begin(async (tx) => {
    await tx.unsafe("set local role hub_ro");
    return tx.unsafe(HUB_VISIBLE_SQL, [userId]);
  });
  return rows.map((r) => String(r.name)).sort();
}

/** `visible_user_count` theo SQL tham chiếu: số user thấy `commandId`, theo tenant_key. */
export async function hubVisibleCounts(
  sql: Sql,
  commandId: string,
): Promise<Record<string, number>> {
  const users = await sql<{ id: string; key: string }[]>`select u.id, t.key from admin.users u
    join admin.tenants t on t.id = u.tenant_id`;
  const [cmd] = await sql<
    { name: string }[]
  >`select name from admin.commands where id = ${commandId}`;
  const out: Record<string, number> = {};
  for (const u of users) {
    const seen = await hubVisible(sql, u.id);
    if (cmd && seen.includes(cmd.name)) out[u.key] = (out[u.key] ?? 0) + 1;
  }
  return out;
}
