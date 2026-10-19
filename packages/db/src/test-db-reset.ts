// ADM-NFR-06 · đưa DB test về đúng trạng thái vừa clone từ template mà KHÔNG tạo/xoá database (Windows: mỗi DB mới ~1.000
// file, mỗi DROP DATABASE ép checkpoint toàn cụm 0,25–5 s). Chỉ khi "vân tay" schema (bảng, cột, ACL, policy, hàm, trigger,
// ràng buộc, index, default ACL, extension, cấu hình DB) trùng ảnh chụp lúc clone; lệch (test có DDL/GRANT) → bên gọi clone lại.
// Dữ liệu: xoá mọi bảng (session_replication_role = replica: bỏ qua FK/trigger), chèn lại đúng các hàng của ảnh chụp, đặt
// lại sequence. Số câu SQL cố định theo số bảng có dữ liệu ban đầu, không theo số hàng.
import type postgres from "postgres";

type Sql = postgres.Sql;
const NS = "n.nspname !~ '^pg_' and n.nspname <> 'information_schema'";

const FP_SQL = `select md5(coalesce(string_agg(x, E'\\n' order by x), '')) as fp from (
  select 'n:' || n.nspname || ':' || n.nspowner::regrole || ':' || coalesce(n.nspacl::text, '') as x
    from pg_namespace n where ${NS}
  union all select 'c:' || c.oid::regclass || ':' || c.relkind::text || ':' || c.relowner::regrole || ':' ||
      coalesce(c.relacl::text, '') || ':' || c.relrowsecurity || c.relforcerowsecurity || ':' ||
      coalesce(c.reloptions::text, '') || ':' || c.relpersistence::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${NS}
  union all select 'a:' || c.oid::regclass || ':' || a.attnum || ':' || a.attname || ':' || a.atttypid::regtype || ':' ||
      a.atttypmod || ':' || a.attnotnull || ':' || a.attidentity::text || ':' || a.attgenerated::text || ':' ||
      coalesce(a.attacl::text, '') || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where ${NS} and a.attnum > 0 and not a.attisdropped
  union all select 'p:' || p.polrelid::regclass || ':' || p.polname || ':' || p.polcmd::text || ':' || p.polpermissive || ':' ||
      p.polroles::regrole[]::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' ||
      coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
    from pg_policy p
  union all select 'f:' || p.oid::regprocedure || ':' || p.proowner::regrole || ':' || md5(coalesce(p.prosrc, '')) || ':' ||
      p.prosecdef || ':' || coalesce(p.proconfig::text, '') || ':' || coalesce(p.proacl::text, '') || ':' || p.provolatile::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${NS}
  union all select 't:' || t.tgrelid::regclass || ':' || t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid)
    from pg_trigger t where not t.tgisinternal
  union all select 'k:' || k.conrelid::regclass || ':' || k.conname || ':' || k.convalidated || ':' ||
      pg_get_constraintdef(k.oid)
    from pg_constraint k join pg_namespace n on n.oid = k.connamespace where ${NS}
  union all select 'i:' || i.indexrelid::regclass || ':' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where ${NS}
  union all select 'v:' || c.oid::regclass || ':' || md5(pg_get_viewdef(c.oid))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${NS} and c.relkind in ('v', 'm')
  union all select 'q:' || s.seqrelid::regclass || ':' || s.seqtypid::regtype || ':' || s.seqincrement || ':' ||
      s.seqmin || ':' || s.seqmax || ':' || s.seqcycle
    from pg_sequence s
  union all select 'd:' || d.defaclrole::regrole || ':' || coalesce(n.nspname, '') || ':' || d.defaclobjtype::text || ':' ||
      d.defaclacl::text
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  union all select 'e:' || e.extname || ':' || e.extversion from pg_extension e
  union all select 'r:' || r.rulename || ':' || md5(pg_get_ruledef(r.oid))
    from pg_rewrite r join pg_class c on c.oid = r.ev_class join pg_namespace n on n.oid = c.relnamespace
    where ${NS} and r.rulename <> '_RETURN'
  union all select 's:' || coalesce(s.setrole::regrole::text, '') || ':' || array_to_string(s.setconfig, ',')
    from pg_db_role_setting s join pg_database db on db.oid = s.setdatabase where db.datname = current_database()
) s`;

const TABLES_SQL = `select format('%I.%I', n.nspname, c.relname) as name,
    array(select quote_ident(a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0
      and not a.attisdropped and a.attgenerated = '' order by a.attnum) as cols
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where ${NS} and c.relkind = 'r' order by 1`;

const SEQS_SQL = `select format('%I.%I', n.nspname, c.relname) as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${NS} and c.relkind = 'S' order by 1`;

type Table = { name: string; cols: string[]; rows: unknown[] };
export type Snapshot = {
  fp: string;
  all: string[];
  tables: Table[];
  seqs: { n: string; v: string; c: boolean }[];
};

export async function fingerprint(sql: Sql): Promise<string> {
  const [r] = await sql.unsafe<{ fp: string }[]>(FP_SQL);
  return r?.fp ?? "";
}

/** Ảnh chụp ngay sau clone: vân tay + hàng của mọi bảng có dữ liệu + giá trị mọi sequence. */
export async function snapshot(sql: Sql): Promise<Snapshot> {
  const fp = await fingerprint(sql);
  const tabs = await sql.unsafe<{ name: string; cols: string[] }[]>(TABLES_SQL);
  const tables: Table[] = [];
  for (const t of tabs) {
    if (!t.cols.length) continue;
    const [r] = await sql.unsafe<{ j: unknown[] }[]>(
      `select coalesce(json_agg(t), '[]'::json) as j from (select ${t.cols.join(", ")} from only ${t.name} order by ctid) t`,
    );
    if (r?.j.length) tables.push({ ...t, rows: r.j });
  }
  const seqNames = (await sql.unsafe<{ name: string }[]>(SEQS_SQL)).map((r) => r.name);
  const seqs: Snapshot["seqs"] = [];
  for (const n of seqNames) {
    const [s] = await sql.unsafe<{ v: string; c: boolean }[]>(
      `select last_value::text as v, is_called as c from ${n}`,
    );
    if (s) seqs.push({ n, v: s.v, c: s.c });
  }
  return { fp, all: tabs.map((t) => t.name), tables, seqs };
}

/**
 * TS1 · xoá sạch dữ liệu `roots` và mọi bảng tham chiếu chúng qua FK (đúng tập của `TRUNCATE … CASCADE`) bằng DELETE trong một
 * transaction `session_replication_role = replica` (bỏ qua FK/trigger như `resetToSnapshot`). Windows: TRUNCATE tạo lại file
 * (bảng + index + toast) của ~30 bảng mỗi lần, đo 190 ms/lần idle và > 1 s khi 6 worker chạy cùng lúc; DELETE bảng nhỏ
 * ~15 ms. Không đặt lại sequence (TRUNCATE mặc định cũng không). `roots` là hằng trong mã test (`schema.bảng`).
 */
export async function deleteCascade(sql: Sql, roots: readonly string[]): Promise<void> {
  const list = roots.map((r) => `'${r.replaceAll("'", "''")}'::regclass::oid`).join(", ");
  const rows = await sql.unsafe<{ name: string }[]>(
    `with recursive t(oid) as (
       select x from unnest(array[${list}]::oid[]) x
       union select k.conrelid from pg_constraint k join t on k.confrelid = t.oid where k.contype = 'f'
     ) select format('%I.%I', n.nspname, c.relname) as name
       from t join pg_class c on c.oid = t.oid join pg_namespace n on n.oid = c.relnamespace`,
  );
  await sql.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx.unsafe(rows.map((r) => `delete from only ${r.name};`).join("\n"));
  });
}

/** Về đúng ảnh chụp nếu vân tay còn trùng; trả false (không đổi gì) khi lệch. */
export async function resetToSnapshot(sql: Sql, s: Snapshot): Promise<boolean> {
  if ((await fingerprint(sql)) !== s.fp) return false;
  await sql.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    if (s.all.length) await tx.unsafe(s.all.map((n) => `delete from only ${n};`).join("\n"));
    for (const t of s.tables) {
      const cols = t.cols.join(", ");
      await tx.unsafe(
        `insert into ${t.name} (${cols}) overriding system value
         select ${cols} from json_populate_recordset(null::${t.name}, $1::text::json)`,
        [JSON.stringify(t.rows)],
      );
    }
    if (s.seqs.length)
      await tx.unsafe(
        "select setval(x.n::regclass, x.v::bigint, x.c) from json_to_recordset($1::text::json) as x(n text, v text, c boolean)",
        [JSON.stringify(s.seqs)],
      );
  });
  return true;
}
