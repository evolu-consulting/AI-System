// TK1 · bộ test cách ly tenant/RLS theo hợp đồng cho gói (PK-NFR-04, PK-AC01/03). Gói khai bảng -> kit sinh ca:
//   đọc chéo = 0 hàng · ghi chéo (UPDATE/DELETE = 0 hàng, INSERT mang tenant lạ = 42501) · thăm dò tồn tại không lộ
//   · role NOINHERIT/NOBYPASSRLS/… · ENABLE+FORCE RLS + có policy trên mọi bảng · phát hiện bảng quên khai.
// Chạy qua `hub_api` + `set_config('role', <k>_rw)` như đường chạy thật. Mọi ca ghi chạy trong tx hoàn tác ⇒ seed một lần.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asRole, pgCode, type Sql } from "./db";

export type RlsTable = {
  name: string;
  /** Mặc định `tenant_id`. */
  tenantColumn?: string;
  /** Mặc định `id`. */
  pk?: string;
  /** Role gói không có SELECT (vd `index_outbox` chỉ INSERT): bỏ ca đọc, vẫn kiểm chèn chéo + FORCE RLS. */
  writeOnly?: boolean;
  /** Dựng 1 hàng cho `tenant` bằng owner (bỏ RLS), trả giá trị khoá chính. Bảng cha khai TRƯỚC bảng con. */
  seed: (owner: Sql, tenant: string) => Promise<string>;
  /** Chèn 1 hàng hợp lệ mang `tenant` qua role gói; `pk` (nếu có) là khoá chính phải dùng. Ném khi bị chặn. */
  insert: (tx: Sql, tenant: string, pk?: string) => Promise<unknown>;
};

export type RlsPackSpec = {
  /** Khoá gói; schema = khoá, role = `<khoá>_rw` (đổi bằng `schema`/`role`). */
  key: string;
  schema?: string;
  role?: string;
  tables: readonly RlsTable[];
  tenants: { a: string; b: string };
  /** Kết nối owner (mở/đóng bởi bên gọi qua `open`/`close`). */
  open: () => Promise<Sql>;
  close: (owner: Sql) => Promise<void>;
  /** Dọn các bảng trước khi seed (owner). */
  reset: (owner: Sql) => Promise<void>;
  /** Bảng có trong schema nhưng cố ý không khai (vd bảng khung `files`). */
  ignoreTables?: readonly string[];
};

const FLAGS = [
  "rolbypassrls",
  "rolsuper",
  "rolcreaterole",
  "rolcreatedb",
  "rolinherit",
  "rolcanlogin",
] as const;
const NIL = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const q = (id: string): string => `"${id.replaceAll('"', '""')}"`;

type Ctx = { owner: Sql; pk: Map<string, { a: string; b: string }> };

/** Sinh bộ ca cho một gói. Gọi ở cấp file test: `defineRlsSuite(spec)`. */
export function defineRlsSuite(spec: RlsPackSpec): void {
  const schema = spec.schema ?? spec.key;
  const role = spec.role ?? `${spec.key}_rw`;
  const { a, b } = spec.tenants;
  const ctx = {} as Ctx;
  const as = <R>(tenant: string | null, fn: (tx: Sql) => Promise<R>) =>
    asRole(role, tenant, fn, { rollback: true });
  const rel = (t: RlsTable): string => `${q(schema)}.${q(t.name)}`;
  const pkOf = (t: RlsTable): string => t.pk ?? "id";
  const tcol = (t: RlsTable): string => t.tenantColumn ?? "tenant_id";
  const count = async (tx: Sql, sql: string, ...p: string[]): Promise<number> => {
    const r = (await tx.unsafe(sql, p)) as unknown as { n: number }[];
    return r[0]?.n ?? -1;
  };

  const upd = (t: RlsTable): string =>
    `update ${rel(t)} set ${q(tcol(t))} = ${q(tcol(t))} where ${q(pkOf(t))}::text = $1`;
  const del = (t: RlsTable): string => `delete from ${rel(t)} where ${q(pkOf(t))}::text = $1`;
  /** Số hàng bị tác động (chuỗi) hoặc SQLSTATE nếu bị chặn quyền; mỗi lệnh một tx hoàn tác. */
  const write = async (tenant: string, sql: string, id: string): Promise<string> => {
    try {
      return String(await as(tenant, async (tx) => (await tx.unsafe(sql, [id])).count));
    } catch (e) {
      return (e as { code?: string }).code ?? "no-code";
    }
  };

  describe(`RLS gói ${spec.key} · hợp đồng cách ly tenant`, () => {
    beforeAll(async () => {
      ctx.owner = await spec.open();
      await spec.reset(ctx.owner);
      ctx.pk = new Map();
      for (const t of spec.tables)
        ctx.pk.set(t.name, { a: await t.seed(ctx.owner, a), b: await t.seed(ctx.owner, b) });
    });
    afterAll(async () => {
      if (ctx.owner) await spec.close(ctx.owner);
    });

    for (const t of spec.tables) {
      const where = `${q(pkOf(t))}::text = $1`; // ::text: khoá uuid hoặc bigint đều dùng được
      describe(`bảng ${schema}.${t.name}`, () => {
        it.skipIf(t.writeOnly === true)("đối chứng: tenant đúng thấy hàng của mình", async () => {
          const n = await as(a, (tx) =>
            count(
              tx,
              `select count(*)::int as n from ${rel(t)} where ${where}`,
              ctx.pk.get(t.name)?.a as string,
            ),
          );
          expect(n).toBe(1);
        });
        it.skipIf(t.writeOnly === true)(
          "đọc chéo: tenant B thấy 0 hàng của A; thiếu/rỗng app.tenant_id thấy 0 hàng",
          async () => {
            const idA = ctx.pk.get(t.name)?.a as string;
            const r = {
              cross: await as(b, (tx) =>
                count(tx, `select count(*)::int as n from ${rel(t)} where ${where}`, idA),
              ),
              noTenant: await as(null, (tx) =>
                count(tx, `select count(*)::int as n from ${rel(t)}`),
              ),
              empty: await as("", (tx) => count(tx, `select count(*)::int as n from ${rel(t)}`)),
            };
            expect(r).toEqual({ cross: 0, noTenant: 0, empty: 0 });
          },
        );
        it("ghi chéo: B UPDATE/DELETE hàng của A không tác động (0 hàng hoặc bị REVOKE 42501); INSERT mang tenant A = 42501", async () => {
          const idA = ctx.pk.get(t.name)?.a as string;
          expect({ upd: await write(b, upd(t), idA), del: await write(b, del(t), idA) }).toEqual({
            upd: expect.stringMatching(/^(0|42501)$/),
            del: expect.stringMatching(/^(0|42501)$/),
          });
          expect(await pgCode(() => as(b, (tx) => t.insert(tx, a)))).toBe("42501");
          if (t.writeOnly) return;
          const own = await as(a, (tx) =>
            count(tx, `select count(*)::int as n from ${rel(t)} where ${where}`, idA),
          );
          expect(own).toBe(1); // hàng của A còn nguyên
        });
        it("thăm dò tồn tại: id của A ≡ id không tồn tại dưới B (đọc và ghi)", async () => {
          const idA = ctx.pk.get(t.name)?.a as string;
          const probe = async (id: string) => ({
            sel: t.writeOnly
              ? -1
              : await as(b, (tx) =>
                  count(tx, `select count(*)::int as n from ${rel(t)} where ${where}`, id),
                ),
            upd: await write(b, upd(t), id),
            del: await write(b, del(t), id),
            ins: await pgCode(() => as(b, (x) => t.insert(x, a, id))),
          });
          expect(await probe(idA)).toEqual(await probe(NIL));
        });
      });
    }

    describe(`role ${role}`, () => {
      it("NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOINHERIT, NOLOGIN", async () => {
        const [r] = await ctx.owner<Record<(typeof FLAGS)[number], boolean>[]>`
          select rolbypassrls, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin from pg_roles where rolname = ${role}`;
        expect(r).toEqual({
          rolbypassrls: false,
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolinherit: false,
          rolcanlogin: false,
        });
      });
    });

    describe(`schema ${schema}`, () => {
      it("ENABLE + FORCE ROW LEVEL SECURITY và có policy trên mọi bảng khai", async () => {
        const rows = await ctx.owner<
          { relname: string; on: boolean; force: boolean; pol: number }[]
        >`
          select c.relname, c.relrowsecurity as on, c.relforcerowsecurity as force,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as pol
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = ${schema} and c.relname = any(${ctx.owner.array(spec.tables.map((t) => t.name))}::text[])`;
        const got = Object.fromEntries(
          rows.map((r) => [r.relname, { on: r.on, force: r.force, policies: r.pol > 0 }]),
        );
        const want = Object.fromEntries(
          spec.tables.map((t) => [t.name, { on: true, force: true, policies: true }]),
        );
        expect(got).toEqual(want);
      });
      it("không có bảng quên khai (mọi bảng của schema đều khai hoặc nằm trong ignoreTables)", async () => {
        const all = await ctx.owner<{ relname: string }[]>`
          select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = ${schema} and c.relkind in ('r', 'p') and not c.relispartition order by 1`;
        const known = new Set([...spec.tables.map((t) => t.name), ...(spec.ignoreTables ?? [])]);
        expect(all.map((r) => r.relname).filter((n) => !known.has(n))).toEqual([]);
      });
    });
  });
}
