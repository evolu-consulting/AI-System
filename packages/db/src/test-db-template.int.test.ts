// ADM-NFR-06 · cloneMigratedTestDb (int): bản sao giống hệt migrate mới (bảng, số dòng, journal Drizzle); đường nhanh (đặt lại
// tại chỗ) ra đúng trạng thái vừa clone kể cả sequence; test đổi schema → clone lại (DB cũ thành rác, không DROP); dựng lại
// template khi hash lệch; từ chối tên không `_test`. DB riêng suy từ TEST_DATABASE_URL (chạy song song được theo worker).
import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { resetTestDb, withDatabase } from "./test-db";
import {
  cloneMigratedTestDb,
  dbNameOf,
  migrateFullTest,
  migrationsHash,
  templateDbName,
} from "./test-db-template";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const stem = dbNameOf(BASE).slice(0, -"_test".length);
const CLONE = withDatabase(BASE, `${stem}_clchk_test`);
const FRESH = withDatabase(BASE, `${stem}_clfresh_test`);
const SPY = withDatabase(BASE, `${stem}_clspy_test`);
const maint = postgres(withDatabase(BASE, "postgres"), { max: 1, onnotice: () => {} });
const FULL = { key: "chk_full", migrate: migrateFullTest };
// TS1 #208: key riêng mỗi lượt chạy ⇒ không có template cùng key của ô khác làm "donor" (ensureTemplate chép thay vì migrate),
// để ca bên dưới vẫn kiểm đúng việc dựng lại bằng `migrate` khi hash lệch.
const SPY_KEY = `chk_spy_${Math.random().toString(36).slice(2, 10)}`;

const dbs = [CLONE, FRESH, SPY].map(dbNameOf);
const tpls = [templateDbName(dbs[0] ?? "", "chk_full"), templateDbName(dbs[2] ?? "", SPY_KEY)];
afterAll(async () => {
  const side = await maint<{ n: string }[]>`select datname as n from pg_database
    where datname like ${`${stem.replaceAll("_", "\\_")}\\_cl%`}`;
  for (const n of new Set([...dbs, ...tpls, ...side.map((r) => r.n)]))
    await maint.unsafe(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`);
  await maint.end();
});

const oidOf = async (name: string) =>
  (await maint<{ o: number }[]>`select oid::int as o from pg_database where datname = ${name}`)[0]
    ?.o;
const nameOf = async (oid: number | undefined) =>
  (await maint<{ n: string }[]>`select datname as n from pg_database where oid = ${oid ?? 0}`)[0]
    ?.n;

async function ensureDb(name: string): Promise<void> {
  const [r] = await maint`select 1 as one from pg_database where datname = ${name}`;
  if (!r) await maint.unsafe(`CREATE DATABASE "${name}"`);
}

async function withSql<T>(url: string, f: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await f(sql);
  } finally {
    await sql.end();
  }
}

/** Bảng (admin/hub/drizzle) + số dòng mỗi bảng + journal Drizzle — so với migrate mới (giờ `now()` khác nên không so hàng). */
const shape = (url: string) =>
  withSql(url, async (sql) => {
    const tables = await sql<{ s: string; t: string }[]>`select table_schema as s, table_name as t
      from information_schema.tables where table_schema in ('admin', 'hub', 'drizzle') order by 1, 2`;
    const counts: Record<string, number> = {};
    for (const { s, t } of tables) {
      const [r] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from "${s}"."${t}"`);
      counts[`${s}.${t}`] = r?.n ?? -1;
    }
    const journal: Record<string, unknown> = {};
    for (const { t } of tables.filter((x) => x.s === "drizzle"))
      journal[t] = await sql.unsafe(`select hash, created_at from drizzle."${t}" order by id`);
    return { counts, journal };
  });

/** Toàn bộ dữ liệu: mọi hàng mọi bảng (sắp theo text) + giá trị mọi sequence. */
const dump = (url: string) =>
  withSql(url, async (sql) => {
    const rels = await sql<
      { r: string; k: string }[]
    >`select format('%I.%I', n.nspname, c.relname) as r,
      c.relkind::text as k from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('admin', 'hub', 'drizzle', 'public') and c.relkind in ('r', 'S') order by 1`;
    const out: Record<string, unknown> = {};
    for (const { r, k } of rels)
      out[r] = (
        await sql.unsafe(
          k === "S"
            ? `select last_value::text as v, is_called as c from ${r}`
            : `select coalesce(json_agg(t::text order by t::text), '[]') as j from ${r} t`,
        )
      )[0];
    return out;
  });

describe("ADM-NFR-06 · cloneMigratedTestDb (int)", () => {
  test("bản sao = migrate mới: cùng bảng, cùng số dòng, cùng journal Drizzle; COMMENT template = key:hash", async () => {
    await ensureDb(dbNameOf(FRESH));
    await resetTestDb(FRESH);
    await migrateFullTest(FRESH);
    await cloneMigratedTestDb(CLONE, FULL);
    const [a, b] = [await shape(FRESH), await shape(CLONE)];
    expect(Object.keys(b.counts).length).toBeGreaterThan(40);
    expect(b).toEqual(a);
    const [c] = await maint<{ c: string }[]>`select shobj_description(oid, 'pg_database') as c
      from pg_database where datname = ${tpls[0] ?? ""}`;
    expect(c?.c).toBe(`chk_full:${migrationsHash()}`);
  }, 60_000);
});

describe("ADM-NFR-06 · cloneMigratedTestDb · đặt lại tại chỗ (int)", () => {
  test("đường nhanh: ghi dữ liệu + nextval rồi gọi lại ⇒ cùng DB (không tạo DB mới), dữ liệu/sequence y như vừa clone", async () => {
    await cloneMigratedTestDb(CLONE, FULL);
    const oid = await oidOf(dbNameOf(CLONE));
    const before = await dump(CLONE);
    await withSql(CLONE, async (sql) => {
      await sql`update admin.config_meta set config_version = config_version + 5`;
      await sql`insert into admin.tenants (id, key, name, active)
        values ('c1000000-0000-4000-8000-000000000001', 'clchk', 'Clone check', true)`;
      const [s] = await sql<
        { r: string }[]
      >`select format('%I.%I', n.nspname, c.relname) as r from pg_class c
        join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' and n.nspname in ('admin', 'hub') limit 1`;
      if (s) await sql.unsafe(`select nextval('${s.r}'), nextval('${s.r}')`);
    });
    expect(await dump(CLONE)).not.toEqual(before);
    const t0 = performance.now();
    await cloneMigratedTestDb(CLONE, FULL);
    const ms = performance.now() - t0;
    expect(await oidOf(dbNameOf(CLONE))).toBe(oid as number);
    expect(await dump(CLONE)).toEqual(before);
    console.log(`đường nhanh: ${ms.toFixed(0)} ms`);
  }, 60_000);

  test("test đổi schema/quyền ⇒ clone lại: DB cũ đổi tên thành rác (không DROP), bảng lạ biến mất, dữ liệu như vừa clone", async () => {
    await cloneMigratedTestDb(CLONE, FULL);
    const old = await oidOf(dbNameOf(CLONE));
    const before = await dump(CLONE);
    await withSql(CLONE, async (sql) => {
      await sql`create table public.stray (v int)`;
      await sql`revoke select on admin.tenants from admin_rw`;
    });
    await cloneMigratedTestDb(CLONE, FULL);
    expect(await oidOf(dbNameOf(CLONE))).not.toBe(old as number);
    expect(await nameOf(old)).toMatch(/_trash_[0-9a-z]+_test$/);
    expect(await dump(CLONE)).toEqual(before);
    const [p] = await withSql(
      CLONE,
      (sql) => sql<{ ok: boolean }[]>`
      select has_table_privilege('admin_rw', 'admin.tenants', 'SELECT') as ok`,
    );
    expect(p?.ok).toBe(true);
  }, 60_000);
});

describe("ADM-NFR-06 · cloneMigratedTestDb · template, tên DB (int)", () => {
  test("template còn đúng hash → không migrate lại; ghi vào bản sao không lọt về template; hash lệch → dựng lại", async () => {
    let calls = 0;
    const migrate = async (url: string) => {
      calls++;
      await withSql(url, async (s) => {
        await s`create table public.marker (v int)`;
        await s`insert into public.marker values (${calls})`;
      });
    };
    const marker = () =>
      withSql(SPY, async (s) =>
        (await s<{ v: number }[]>`select v from public.marker order by v`).map((r) => r.v),
      );
    await maint.unsafe(`DROP DATABASE IF EXISTS "${tpls[1]}" WITH (FORCE)`);
    await cloneMigratedTestDb(SPY, { key: SPY_KEY, migrate });
    expect(calls).toBe(1);
    await withSql(SPY, (s) => s`insert into public.marker values (99)`);
    await cloneMigratedTestDb(SPY, { key: SPY_KEY, migrate });
    expect(calls).toBe(1);
    expect(await marker()).toEqual([1]);
    await maint.unsafe(`COMMENT ON DATABASE "${tpls[1]}" IS '${SPY_KEY}:stale'`);
    await cloneMigratedTestDb(SPY, { key: SPY_KEY, migrate });
    expect(calls).toBe(2);
    expect(await marker()).toEqual([2]);
  }, 60_000);

  test("tên DB không kết thúc _test hoặc URL trống → ném, không đụng DB", async () => {
    const migrate = async () => {
      throw new Error("không được gọi");
    };
    await expect(
      cloneMigratedTestDb(withDatabase(BASE, "ai_system"), { key: "x", migrate }),
    ).rejects.toThrow(/_test/);
    await expect(cloneMigratedTestDb(undefined, { key: "x", migrate })).rejects.toThrow(
      "TEST_DATABASE_URL chưa đặt",
    );
  });
});
