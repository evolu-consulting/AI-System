// PK-FR-02 · PK-FR-03 · PK-NFR-04 · PK-AC01 · PK-AC02 · PK-AC03 · plan §3 "Guard": khuôn RLS/FORCE/FK kép/role `<k>_rw` của gói.
// Gói mẫu `pkdemo` (2 bảng cha–con + khung `files`/`index_outbox`). Đường chạy thật: `hub_api` + `set_config('role','pkdemo_rw',true)`
// trong tx (D-06). Dữ liệu dựng bằng owner (bỏ RLS). Chưa có migration gói ⇒ `needPackKit` đỏ ngay.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { setupX2a } from "../X2a/_x2a";
import {
  hubApiSql,
  ID,
  inPack,
  needPackKit,
  PK,
  pgCode,
  type Sql,
  seedFile,
  seedItem,
  T,
} from "./_support/n1";

let sql: Sql;
beforeAll(async () => {
  sql = await setupX2a();
});
afterAll(async () => {
  await sql.end();
});
/** Dữ liệu 2 tenant: acme (A) và beta (B). */
async function seed(): Promise<void> {
  await needPackKit(sql);
  await sql`truncate pkdemo.item_lines, pkdemo.items, pkdemo.files, pkdemo.index_outbox`;
  await seedItem(sql, T.acme, ID.itemA, ID.lineA, "của A");
  await seedItem(sql, T.beta, ID.itemB, ID.lineB, "của B");
}
const n = (r: { n: number }[]): number => r[0]?.n ?? -1;

describe("PK-AC01 · cách ly tenant theo RLS", () => {
  it("PK-AC01 · tenant A ghi 1 hàng; đặt app.tenant_id=B ⇒ SELECT/UPDATE/DELETE hàng của A = 0 hàng (cha và con)", async () => {
    await seed();
    const r = await inPack(T.beta, async (tx) => ({
      selParent: n(
        await tx<
          { n: number }[]
        >`select count(*)::int as n from pkdemo.items where id = ${ID.itemA}`,
      ),
      selChild: n(
        await tx<
          { n: number }[]
        >`select count(*)::int as n from pkdemo.item_lines where id = ${ID.lineA}`,
      ),
      upd: (await tx`update pkdemo.items set title = 'hack' where id = ${ID.itemA}`).count,
      updChild: (await tx`update pkdemo.item_lines set text = 'hack' where id = ${ID.lineA}`).count,
      del: (await tx`delete from pkdemo.item_lines where id = ${ID.lineA}`).count,
      delParent: (await tx`delete from pkdemo.items where id = ${ID.itemA}`).count,
      own: n(await tx<{ n: number }[]>`select count(*)::int as n from pkdemo.items`),
    }));
    expect(r).toEqual({
      selParent: 0,
      selChild: 0,
      upd: 0,
      updChild: 0,
      del: 0,
      delParent: 0,
      own: 1,
    });
    const [a] = await sql<
      { title: string }[]
    >`select title from pkdemo.items where id = ${ID.itemA}`;
    expect(a?.title).toBe("của A"); // không bị sửa/xoá
  });
  it("PK-AC01 · KHÔNG đặt app.tenant_id ⇒ 0 hàng (không lỗi lộ)", async () => {
    await seed();
    const r = await inPack(null, async (tx) => ({
      items: n(await tx<{ n: number }[]>`select count(*)::int as n from pkdemo.items`),
      lines: n(await tx<{ n: number }[]>`select count(*)::int as n from pkdemo.item_lines`),
    }));
    expect(r).toEqual({ items: 0, lines: 0 });
  });
  it("PK-AC01 · app.tenant_id rỗng '' ⇒ 0 hàng (NULLIF), không lỗi cast uuid", async () => {
    await seed();
    const r = await inPack("", async (tx) =>
      n(await tx<{ n: number }[]>`select count(*)::int as n from pkdemo.items`),
    );
    expect(r).toBe(0);
  });
  it("PK-AC01 · WITH CHECK: tenant B không chèn/sửa được hàng mang tenant_id của A (42501)", async () => {
    await seed();
    const ins = await pgCode(() =>
      inPack(
        T.beta,
        (tx) => tx`insert into pkdemo.items (tenant_id, title) values (${T.acme}, 'chèn chéo')`,
      ),
    );
    expect(ins).toBe("42501");
    const mv = await pgCode(() =>
      inPack(
        T.beta,
        (tx) => tx`update pkdemo.items set tenant_id = ${T.acme} where id = ${ID.itemB}`,
      ),
    );
    expect(mv).toBe("42501");
  });
  it("PK-AC01 · tenant đúng thấy đúng hàng của mình (đối chứng, không 0 mọi nơi)", async () => {
    await seed();
    const r = await inPack(T.acme, async (tx) =>
      (await tx<{ title: string }[]>`select title from pkdemo.items`).map((x) => x.title),
    );
    expect(r).toEqual(["của A"]);
  });
});

describe("PK-AC02 · FK kép (x_id, tenant_id)", () => {
  it("PK-AC02 · hàng con tenant B trỏ cha tenant A ⇒ 23503 (qua role gói)", async () => {
    await seed();
    const code = await pgCode(() =>
      inPack(
        T.beta,
        (tx) =>
          tx`insert into pkdemo.item_lines (tenant_id, item_id, text) values (${T.beta}, ${ID.itemA}, 'gắn chéo')`,
      ),
    );
    expect(code).toBe("23503");
  });
  it("PK-AC02 · FK kép chặn cả khi bỏ RLS (owner): con(B) → cha(A) ⇒ 23503", async () => {
    await seed();
    const code = await pgCode(
      () =>
        sql`insert into pkdemo.item_lines (tenant_id, item_id, text) values (${T.beta}, ${ID.itemA}, 'owner')`,
    );
    expect(code).toBe("23503");
  });
  it("PK-AC02 · cha (id, tenant_id) có UNIQUE; con cùng tenant gắn được; xoá cha CASCADE con", async () => {
    await seed();
    const [u] = await sql<{ n: number }[]>`select count(*)::int as n from pg_constraint
      where conrelid = 'pkdemo.items'::regclass and contype = 'u'
        and (select array_agg(attname order by attname) from pg_attribute
             where attrelid = conrelid and attnum = any(conkey)) = array['id','tenant_id']::name[]`;
    expect(u?.n).toBe(1);
    const ok = await inPack(T.acme, async (tx) => {
      await tx`insert into pkdemo.item_lines (tenant_id, item_id, text) values (${T.acme}, ${ID.itemA}, 'cùng tenant')`;
      await tx`delete from pkdemo.items where id = ${ID.itemA}`;
      return n(await tx<{ n: number }[]>`select count(*)::int as n from pkdemo.item_lines`);
    });
    expect(ok).toBe(0);
  });
});

describe("PK-AC03 · role pkdemo_rw", () => {
  it("PK-AC03 · pg_roles: NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOINHERIT, NOLOGIN", async () => {
    await needPackKit(sql);
    const [r] = await sql<
      Record<string, boolean>[]
    >`select rolbypassrls, rolsuper, rolcreaterole, rolcreatedb,
      rolinherit, rolcanlogin, rolreplication from pg_roles where rolname = 'pkdemo_rw'`;
    expect(r).toEqual({
      rolbypassrls: false,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
      rolcanlogin: false,
      rolreplication: false,
    });
  });
  it("PK-AC03 · SELECT hub.process_runs / admin.users bằng role gói ⇒ 42501", async () => {
    await needPackKit(sql);
    const hub = await pgCode(() =>
      inPack(T.acme, (tx) => tx`select 1 from hub.process_runs limit 1`),
    );
    const adm = await pgCode(() => inPack(T.acme, (tx) => tx`select 1 from admin.users limit 1`));
    expect({ hub, adm }).toEqual({ hub: "42501", adm: "42501" });
  });
  it("PK-AC03 · role gói không có USAGE schema hub/admin; hub_api thường (không SET ROLE) không thấy bảng gói", async () => {
    await needPackKit(sql);
    const [p] = await sql<{ hub: boolean; adm: boolean; own: boolean }[]>`select
      has_schema_privilege('pkdemo_rw', 'hub', 'USAGE') as hub,
      has_schema_privilege('pkdemo_rw', 'admin', 'USAGE') as adm,
      has_schema_privilege('pkdemo_rw', 'pkdemo', 'USAGE') as own`;
    expect(p).toEqual({ hub: false, adm: false, own: true });
    const conn = hubApiSql();
    try {
      const code = await pgCode(() => conn`select 1 from pkdemo.items limit 1`);
      expect(code).toBe("42501"); // GRANT … WITH INHERIT FALSE: kết nối thường không thấy bảng gói
    } finally {
      await conn.end({ timeout: 1 });
    }
  });
  it("PK-AC03 · hub_api được SET ROLE pkdemo_rw (GRANT … SET TRUE), không INHERIT", async () => {
    await needPackKit(sql);
    const [m] = await sql<
      { inherit: boolean; set: boolean }[]
    >`select m.inherit_option as inherit, m.set_option as set
      from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles g on g.oid = m.member
      where r.rolname = 'pkdemo_rw' and g.rolname = 'hub_api'`;
    expect(m).toEqual({ inherit: false, set: true });
  });
  it("PK-AC03 · không DDL: role gói không CREATE TABLE trong schema gói (42501)", async () => {
    await needPackKit(sql);
    const code = await pgCode(() => inPack(T.acme, (tx) => tx`create table pkdemo.hack (id int)`));
    expect(code).toBe("42501");
  });
});

describe("PK-NFR-04 · guard khuôn cho MỌI schema trong packs.registry", () => {
  it("PK-FR-02 · mọi bảng: ENABLE + FORCE RLS, ≥ 1 policy FOR ALL TO <k>_rw, cột tenant_id uuid NOT NULL", async () => {
    await needPackKit(sql);
    const rows = await sql<Record<string, unknown>[]>`select r.key as pack, c.relname as tbl,
        c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policies p where p.schemaname = r.key and p.tablename = c.relname
           and p.cmd = 'ALL' and p.roles = array[r.key || '_rw']::name[]) as pol,
        (select a.attnotnull and format_type(a.atttypid, a.atttypmod) = 'uuid' from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tenant_ok
      from packs.registry r join pg_class c on c.relnamespace = r.key::regnamespace and c.relkind = 'r'
      order by 1, 2`;
    expect(rows.length).toBeGreaterThanOrEqual(4); // pkdemo: items, item_lines, files, index_outbox
    const bad = rows.filter(
      (x) => !(x.rls && x.forced && (x.pol as number) >= 1 && x.tenant_ok === true),
    );
    expect(bad).toEqual([]);
  });
  it("PK-FR-02 · policy dùng NULLIF(current_setting('app.tenant_id', true), '')::uuid cho cả USING và WITH CHECK", async () => {
    await needPackKit(sql);
    const rows = await sql<{ tablename: string; qual: string; with_check: string }[]>`
      select tablename, qual, with_check from pg_policies where schemaname = ${PK}`;
    const norm = (s: string) => s.replace(/[\s()]/g, "");
    const want = norm(
      "tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)::uuid",
    );
    expect(
      rows
        .filter((p) => norm(p.qual) !== want || norm(p.with_check) !== want)
        .map((p) => p.tablename),
    ).toEqual([]);
  });
  it("PK-FR-02 · mọi FK nội schema gói chứa tenant_id ở cả hai đầu (FK kép)", async () => {
    await needPackKit(sql);
    const bad = await sql<{ tbl: string; con: string }[]>`
      select c.conrelid::regclass::text as tbl, c.conname as con
      from pg_constraint c join packs.registry r on c.connamespace = r.key::regnamespace
      where c.contype = 'f' and c.confrelid::regclass::text like r.key || '.%'
        and not ((select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'tenant_id') = any(c.conkey)
             and (select a.attnum from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'tenant_id') = any(c.confkey))`;
    expect([...bad]).toEqual([]);
  });
  it("PK-NFR-04 · 2 tenant × mọi bảng khuôn: đọc/sửa chéo 0 hàng (files), ghi chéo bị chặn 42501 (outbox INSERT-only)", async () => {
    await seed();
    await seedFile(sql, T.acme, ID.fileA, "fb-A");
    await seedFile(sql, T.beta, ID.fileB, "fb-B");
    const files = await inPack(T.beta, async (tx) => ({
      sel: n(
        await tx<
          { n: number }[]
        >`select count(*)::int as n from pkdemo.files where id = ${ID.fileA}`,
      ),
      upd: (await tx`update pkdemo.files set name = 'x' where id = ${ID.fileA}`).count,
      own: n(await tx<{ n: number }[]>`select count(*)::int as n from pkdemo.files`),
    }));
    expect(files).toEqual({ sel: 0, upd: 0, own: 1 });
    const outbox = await pgCode(() =>
      inPack(
        T.beta,
        (tx) =>
          tx`insert into pkdemo.index_outbox (tenant_id, entity, entity_id, op) values (${T.acme}, 'item', ${ID.itemA}, 'upsert')`,
      ),
    );
    expect(outbox).toBe("42501");
    const sel = await pgCode(() => inPack(T.acme, (tx) => tx`select * from pkdemo.index_outbox`));
    expect(sel).toBe("42501"); // index_outbox chỉ INSERT
  });
  it("PK-FR-06 · files.org CHECK (org = 't_' || tenant_id): chèn org lệch tenant ⇒ 23514 (rào thứ hai ở DB)", async () => {
    await seed();
    const code = await pgCode(() => seedFile(sql, T.acme, ID.fileA, "fb-X", `t_${T.beta}`));
    expect(code).toBe("23514");
  });
});
