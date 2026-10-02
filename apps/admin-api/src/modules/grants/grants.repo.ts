// ADM-FR-32, ADM-FR-35, ADM-NFR-07 · truy vấn feature_grants + khoá tham chiếu (luôn trong configWrite/withScope → RLS,
// và lọc tenant_id tường minh). Thứ tự khoá (plan M3 §6): groups SHARE (3) → features SHARE (8) → entitlements SHARE (10)
// → hàng grant NKU sắp (feature_id, subject_id) (11) → config_meta (14, configWrite). Mọi tập khoá đều sắp tăng.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";
import type { PairKey } from "./grants.rules";

type Rows<T> = T[];
const run = async <T>(tx: Tx, q: SQL): Promise<Rows<T>> => (await tx.execute(q)) as unknown as T[];
const sorted = (ids: readonly string[]) => [...new Set(ids)].sort();

/** Group của tenant, `FOR SHARE`, id tăng (chặn xoá group song song; chèn grant lấy KEY SHARE qua FK). */
export async function shareGroups(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await run<{ id: string }>(
    tx,
    sql`select id from admin.groups
    where tenant_id = ${tenantId} and id = any(${pgArray(sorted(ids), "uuid")}) order by id for share`,
  );
  return new Set(rows.map((r) => r.id));
}

/** User cùng tenant — không khoá (app không xoá user; FK KEY SHARE không xung đột — ngoại lệ E2). */
export async function userInTenant(tx: Tx, tenantId: string, id: string): Promise<boolean> {
  const rows = await run(
    tx,
    sql`select 1 from admin.users where tenant_id = ${tenantId} and id = ${id}`,
  );
  return rows.length === 1;
}

/** Feature `FOR SHARE`, id tăng (chặn xoá/sửa feature song song). */
export async function shareFeatures(
  tx: Tx,
  ids: readonly string[],
): Promise<{ id: string; key: string }[]> {
  if (ids.length === 0) return [];
  return run(
    tx,
    sql`select id, key from admin.features
    where id = any(${pgArray(sorted(ids), "uuid")}) order by id for share`,
  );
}

/** Entitlement CHƯA thu hồi của tenant, `FOR SHARE`, feature_id tăng (thu hồi song song phải chờ, L3a/L3b). */
export async function shareEntitled(
  tx: Tx,
  tenantId: string,
  featureIds: readonly string[],
): Promise<Set<string>> {
  if (featureIds.length === 0) return new Set();
  const rows = await run<{ feature_id: string }>(
    tx,
    sql`select feature_id from admin.feature_entitlements
    where tenant_id = ${tenantId} and feature_id = any(${pgArray(sorted(featureIds), "uuid")})
      and revoked_at is null order by feature_id for share`,
  );
  return new Set(rows.map((r) => r.feature_id));
}

const pairsTable = (pairs: readonly PairKey[]) => sql`(select f, g from unnest(
  ${pgArray(
    pairs.map((p) => p.featureId),
    "uuid",
  )}, ${pgArray(
    pairs.map((p) => p.groupId),
    "uuid",
  )}) as x(f, g))`;

/** Lock pass: mọi hàng grant group đang có trong `pairs` (thêm ∪ bớt), `FOR NO KEY UPDATE` sắp (feature_id, group_id). */
export async function lockGroupGrants(
  tx: Tx,
  tenantId: string,
  pairs: readonly PairKey[],
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const rows = await run<{ f: string; g: string }>(
    tx,
    sql`select feature_id as f, group_id as g
    from admin.feature_grants where tenant_id = ${tenantId} and group_id is not null
      and (feature_id, group_id) in ${pairsTable(pairs)}
    order by feature_id, group_id for no key update`,
  );
  return new Set(rows.map((r) => `${r.f}:${r.g}`));
}

/** Xoá theo TOÀN BỘ `pairs` (không theo snapshot lock pass, readiness #8); khoá bằng subselect có thứ tự. Trả số hàng. */
export async function deleteGroupGrants(
  tx: Tx,
  tenantId: string,
  pairs: readonly PairKey[],
): Promise<number> {
  if (pairs.length === 0) return 0;
  const rows = await run(
    tx,
    sql`delete from admin.feature_grants where id in (
      select id from admin.feature_grants where tenant_id = ${tenantId} and group_id is not null
        and (feature_id, group_id) in ${pairsTable(pairs)}
      order by feature_id, group_id for no key update)
    returning id`,
  );
  return rows.length;
}

/** Chèn theo đúng thứ tự `pairs` (đã sắp), `ON CONFLICT DO NOTHING`; trả số hàng thật sự chèn. */
export async function insertGroupGrants(
  tx: Tx,
  g: { tenantId: string; actorId: string },
  pairs: readonly PairKey[],
): Promise<number> {
  if (pairs.length === 0) return 0;
  const rows = await run(
    tx,
    sql`insert into admin.feature_grants (id, tenant_id, feature_id, group_id, granted_by)
    select gen_random_uuid(), ${g.tenantId}, x.f, x.g, ${g.actorId}::uuid
    from unnest(${pgArray(
      pairs.map((p) => p.featureId),
      "uuid",
    )}, ${pgArray(
      pairs.map((p) => p.groupId),
      "uuid",
    )})
      with ordinality as x(f, g, n)
    order by x.n
    on conflict (tenant_id, feature_id, group_id) where group_id is not null do nothing
    returning id`,
  );
  return rows.length;
}

export type Subject = { kind: "group" | "user"; id: string };
const subjectCol = (s: Subject) => sql.raw(s.kind === "group" ? "group_id" : "user_id");

/** Hàng grant (feature, subject) `FOR NO KEY UPDATE`; trả id hoặc null. */
export async function lockGrant(
  tx: Tx,
  t: { tenantId: string; featureId: string; subject: Subject },
): Promise<string | null> {
  const rows = await run<{ id: string }>(
    tx,
    sql`select id from admin.feature_grants
    where tenant_id = ${t.tenantId} and feature_id = ${t.featureId} and ${subjectCol(t.subject)} = ${t.subject.id}
    for no key update`,
  );
  return rows[0]?.id ?? null;
}

/** `ON CONFLICT DO NOTHING`; trả id mới hoặc null (đã có — đua). */
export async function insertGrant(
  tx: Tx,
  t: { tenantId: string; featureId: string; subject: Subject; actorId: string },
): Promise<string | null> {
  const col = subjectCol(t.subject);
  const rows = await run<{ id: string }>(
    tx,
    sql`insert into admin.feature_grants
      (id, tenant_id, feature_id, ${col}, granted_by)
    values (${Bun.randomUUIDv7()}, ${t.tenantId}, ${t.featureId}, ${t.subject.id}, ${t.actorId})
    on conflict (tenant_id, feature_id, ${col}) where ${col} is not null do nothing
    returning id`,
  );
  return rows[0]?.id ?? null;
}

export async function deleteGrant(
  tx: Tx,
  t: { tenantId: string; featureId: string; subject: Subject },
): Promise<number> {
  const rows = await run(
    tx,
    sql`delete from admin.feature_grants
    where tenant_id = ${t.tenantId} and feature_id = ${t.featureId} and ${subjectCol(t.subject)} = ${t.subject.id}
    returning id`,
  );
  return rows.length;
}
