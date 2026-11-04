// tool-tenant-purge · phần DB (role owner, bỏ RLS): đọc catalog (pg_class/pg_attribute/pg_constraint) ⇒ kế hoạch, đếm, xoá trong
// MỘT transaction, chặn đụng tenant khác, tắt tạm trigger người dùng (append-only audit, guard read-only…) chỉ trong transaction,
// bump config_version/hub_config_version + NOTIFY (gửi lúc commit) và ghi audit platform.
import type postgres from "postgres";
import {
  assertCovered,
  type Counts,
  type DelAction,
  EXTRA_TABLES,
  type Fk,
  GUARDED_TABLES,
  isFileColumn,
  orderTables,
  type Plan,
  PurgeRefused,
  purgeSet,
  q,
  qRel,
  type Rel,
  type TableInfo,
  TENANTS,
  type TenantRow,
  unknownRefs,
  whereAs,
} from "./tenant-purge.rules";

export type Sql = postgres.Sql | postgres.TransactionSql;
const GUARDED = new Set(GUARDED_TABLES.map((g) => g.rel));
type Row = Record<string, unknown>;
const all = async <T>(sql: Sql, text: string, p: unknown[] = []): Promise<T[]> =>
  (await sql.unsafe(text, p as never[])) as unknown as T[];

const SYS = `n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'`;

export async function readTables(sql: Sql): Promise<TableInfo[]> {
  return all<TableInfo>(
    sql,
    `select n.nspname || '.' || c.relname as rel,
       (select format_type(a.atttypid, null) from pg_attribute a
         where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as "tenantType",
       coalesce((select array_agg(a.attname::text order by a.attname) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           and a.attname ~* 'tenant' and a.attname <> 'tenant_id'), '{}') as "tenantLike"
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relispartition and ${SYS}
     order by 1`,
  );
}

export async function readFks(sql: Sql): Promise<Fk[]> {
  const rows = await all<Fk & { del: DelAction }>(
    sql,
    `select con.conname as name, cn.nspname || '.' || cc.relname as child, pn.nspname || '.' || pc.relname as parent,
       con.confdeltype as del, con.condeferrable as deferrable,
       array(select a.attname::text from unnest(con.conkey) with ordinality k(att, i)
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.att order by k.i) as cols,
       array(select a.attname::text from unnest(con.confkey) with ordinality k(att, i)
         join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.att order by k.i) as pcols,
       not exists (select 1 from unnest(con.conkey) k(att) join pg_attribute a
         on a.attrelid = con.conrelid and a.attnum = k.att where a.attnotnull) as nullable
     from pg_constraint con
     join pg_class cc on cc.oid = con.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
     join pg_class pc on pc.oid = con.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
     where con.contype = 'f' and not cc.relispartition
     order by 1, 2`,
  );
  return rows;
}

export type Catalog = { tables: TableInfo[]; fks: Fk[] };
export const readCatalog = async (sql: Sql): Promise<Catalog> => ({
  tables: await readTables(sql),
  fks: await readFks(sql),
});

/** Kế hoạch đầy đủ + mọi chốt chặn (bảng lạ, bảng tenant_id không có thứ tự). */
export function buildPlan(c: Catalog, extra = EXTRA_TABLES): Plan {
  const where = purgeSet(c.tables, extra);
  const unknown = unknownRefs(c.tables, c.fks, where);
  if (unknown.length)
    throw new PurgeRefused(
      `bảng lạ tham chiếu dữ liệu tenant — thêm vào EXTRA_TABLES/IGNORED_TABLES (tenant-purge.rules.ts) rồi chạy lại:\n  ${unknown.join("\n  ")}`,
    );
  const plan = orderTables(where, c.fks);
  assertCovered(c.tables, plan);
  return plan;
}

export async function readTenants(sql: Sql): Promise<TenantRow[]> {
  return all<TenantRow>(
    sql,
    `select t.id::text as id, t.key, t.name,
       (select count(*)::int from admin.users u where u.tenant_id = t.id and u.role = 'platform_admin') as "platformAdmins"
     from admin.tenants t order by t.created_at, t.id`,
  );
}

/** Đếm hàng theo bảng (một câu `union all`, số câu cố định). */
export async function countRows(sql: Sql, plan: Plan, tenantId: string): Promise<Counts> {
  const parts = plan.order.map(
    (r, i) =>
      `select ${i} as i, count(*)::int as n from ${qRel(r)} t where ${whereAs(plan.where[r] as string, "t")}`,
  );
  const rows = await all<{ i: number; n: number }>(sql, parts.join(" union all "), [tenantId]);
  const out: Counts = {};
  for (const r of rows) out[plan.order[r.i] as Rel] = r.n;
  return out;
}

const join = (f: Fk, c: string, p: string): string =>
  f.cols.map((col, i) => `${c}.${q(col)} = ${p}.${q(f.pcols[i] as string)}`).join(" and ");

/**
 * Chặn đụng tenant khác: hàng (của tenant khác / không thuộc tenant) trong bảng con thuộc tập xoá trỏ vào hàng của tenant này
 * qua FK cascade/no action/restrict ⇒ FAIL. FK ghép có `tenant_id` hai phía ⇒ không thể chéo, bỏ qua (không truy vấn).
 */
export async function crossTenantRefs(sql: Sql, plan: Plan, fks: readonly Fk[], tenantId: string) {
  const hits: string[] = [];
  for (const f of fks) {
    const cw = plan.where[f.child] ?? (GUARDED.has(f.child) ? "false" : undefined);
    const pw = plan.where[f.parent];
    if (!cw || !pw || f.child === TENANTS || f.del === "n" || f.del === "d") continue;
    if (f.cols.includes("tenant_id") && f.pcols.includes("tenant_id")) continue;
    const [r] = await all<{ n: number }>(
      sql,
      `select count(*)::int as n from ${qRel(f.child)} c join ${qRel(f.parent)} p on ${join(f, "c", "p")}
       where ${whereAs(pw, "p")} and not coalesce(${whereAs(cw, "c")}, false)`,
      [tenantId],
    );
    if ((r?.n ?? 0) > 0)
      hits.push(`${f.child} → ${f.parent} (${f.name}): ${r?.n} hàng ngoài tenant`);
  }
  if (hits.length)
    throw new PurgeRefused(`dữ liệu ngoài tenant trỏ vào tenant:\n  ${hits.join("\n  ")}`);
}

type FileCol = { rel: Rel; col: string; kind: "id" | "locator" };
export async function fileColumns(sql: Sql, plan: Plan): Promise<FileCol[]> {
  const rows = await all<{ rel: Rel; col: string; type: string }>(
    sql,
    `select n.nspname || '.' || c.relname as rel, a.attname::text as col, format_type(a.atttypid, null) as type
     from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relispartition and a.attnum > 0 and not a.attisdropped and ${SYS}`,
  );
  return rows.flatMap((r) => {
    const kind = isFileColumn(r.col, r.type);
    return kind && plan.where[r.rel] ? [{ rel: r.rel, col: r.col, kind }] : [];
  });
}

/** Id FileBox mà dữ liệu của tenant đang tham chiếu (đọc TRƯỚC khi xoá). */
export async function tenantFileIds(sql: Sql, plan: Plan, tenantId: string): Promise<string[]> {
  const cols = await fileColumns(sql, plan);
  if (cols.length === 0) return [];
  const parts = cols.map((c) =>
    c.kind === "id"
      ? `select t.${q(c.col)}::text as v from ${qRel(c.rel)} t where ${whereAs(plan.where[c.rel] as string, "t")} and t.${q(c.col)} is not null`
      : `select substr(t.${q(c.col)}, 4) as v from ${qRel(c.rel)} t where ${whereAs(plan.where[c.rel] as string, "t")} and t.${q(c.col)} like 'fb/%'`,
  );
  const rows = await all<{ v: string }>(sql, parts.join(" union "), [tenantId]);
  return rows
    .map((r) => r.v)
    .filter(Boolean)
    .sort();
}

/** Id trong `ids` mà dữ liệu CÒN LẠI (tenant khác) vẫn tham chiếu ⇒ không được xoá ở FileBox. */
export async function stillReferenced(sql: Sql, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await all<{ rel: Rel; col: string; type: string }>(
    sql,
    `select n.nspname || '.' || c.relname as rel, a.attname::text as col, format_type(a.atttypid, null) as type
     from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relispartition and a.attnum > 0 and not a.attisdropped and ${SYS}`,
  );
  const parts = rows.flatMap((r) => {
    const kind = isFileColumn(r.col, r.type);
    if (!kind) return [];
    const v = kind === "id" ? `${q(r.col)}::text` : `substr(${q(r.col)}, 4)`;
    return [`select ${v} as v from ${qRel(r.rel)} where ${v} = any($1::text[])`];
  });
  if (parts.length === 0) return new Set();
  const hit = await all<{ v: string }>(sql, parts.join(" union "), [[...ids]]);
  return new Set(hit.map((h) => h.v));
}

export type { Row };
