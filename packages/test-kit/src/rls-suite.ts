// TK1 · bộ test cách ly tenant/RLS theo hợp đồng cho gói (PK-NFR-04, PK-AC01/03). Gói khai bảng -> kit sinh ca:
//   đọc chéo = 0 hàng · ghi chéo (UPDATE/DELETE = 0 hàng, INSERT mang tenant lạ = 42501) · thăm dò tồn tại không lộ
//   · role NOINHERIT/NOBYPASSRLS/… · ENABLE+FORCE RLS + có policy trên mọi bảng · phát hiện bảng quên khai.
// Chạy qua `hub_api` + role `<k>_rw` đặt trong tx như đường chạy thật. Mọi ca ghi chạy trong tx hoàn tác ⇒ seed một lần.
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

type Pks = Map<string, { a: string; b: string }>;
type Ops = {
  schema: string;
  role: string;
  a: string;
  b: string;
  as: <R>(tenant: string | null, fn: (tx: Sql) => Promise<R>) => Promise<R>;
  rel: (t: RlsTable) => string;
  where: (t: RlsTable) => string;
  countOf: (t: RlsTable, tenant: string | null, id?: string) => Promise<number>;
  write: (t: RlsTable, kind: "upd" | "del", tenant: string, id: string) => Promise<string>;
  /** Đổi cột tenant của hàng `id` sang `to` dưới `tenant`: số hàng (chuỗi) hoặc SQLSTATE. */
  move: (t: RlsTable, tenant: string, id: string, to: string) => Promise<string>;
};

function makeOps(spec: RlsPackSpec): Ops {
  const schema = spec.schema ?? spec.key;
  const role = spec.role ?? `${spec.key}_rw`;
  const as: Ops["as"] = (tenant, fn) => asRole(role, tenant, fn, { rollback: true });
  const rel = (t: RlsTable): string => `${q(schema)}.${q(t.name)}`;
  const pk = (t: RlsTable): string => t.pk ?? "id";
  const tcol = (t: RlsTable): string => t.tenantColumn ?? "tenant_id";
  const where = (t: RlsTable): string => `${q(pk(t))}::text = $1`; // ::text: khoá uuid hoặc bigint đều dùng được
  const countOf: Ops["countOf"] = (t, tenant, id) =>
    as(tenant, async (tx) => {
      const sql = `select count(*)::int as n from ${rel(t)}${id === undefined ? "" : ` where ${where(t)}`}`;
      const r = (await tx.unsafe(sql, id === undefined ? [] : [id])) as unknown as { n: number }[];
      return r[0]?.n ?? -1;
    });
  /** Số hàng bị tác động (chuỗi) hoặc SQLSTATE nếu bị chặn quyền; mỗi lệnh một tx hoàn tác. */
  const write: Ops["write"] = async (t, kind, tenant, id) => {
    const sql =
      kind === "upd"
        ? `update ${rel(t)} set ${q(tcol(t))} = ${q(tcol(t))} where ${where(t)}`
        : `delete from ${rel(t)} where ${where(t)}`;
    try {
      return String(await as(tenant, async (tx) => (await tx.unsafe(sql, [id])).count));
    } catch (e) {
      return (e as { code?: string }).code ?? "no-code";
    }
  };
  const move: Ops["move"] = async (t, tenant, id, to) => {
    const sql = `update ${rel(t)} set ${q(tcol(t))} = $2 where ${where(t)}`;
    try {
      return String(await as(tenant, async (tx) => (await tx.unsafe(sql, [id, to])).count));
    } catch (e) {
      return (e as { code?: string }).code ?? "no-code";
    }
  };
  return {
    schema,
    role,
    a: spec.tenants.a,
    b: spec.tenants.b,
    as,
    rel,
    where,
    countOf,
    write,
    move,
  };
}

function tableCases(t: RlsTable, o: Ops, pks: () => Pks): void {
  const idA = (): string => pks().get(t.name)?.a as string;
  it.skipIf(t.writeOnly === true)("đối chứng: tenant đúng thấy hàng của mình", async () => {
    expect(await o.countOf(t, o.a, idA())).toBe(1);
  });
  it.skipIf(t.writeOnly === true)(
    "đọc chéo: tenant B thấy 0 hàng của A; thiếu/rỗng app.tenant_id thấy 0 hàng",
    async () => {
      const r = {
        cross: await o.countOf(t, o.b, idA()),
        noTenant: await o.countOf(t, null),
        empty: await o.countOf(t, ""),
      };
      expect(r).toEqual({ cross: 0, noTenant: 0, empty: 0 });
    },
  );
  it("ghi chéo: B UPDATE/DELETE hàng của A không tác động (0 hàng hoặc bị REVOKE 42501); INSERT mang tenant A = 42501", async () => {
    expect({
      upd: await o.write(t, "upd", o.b, idA()),
      del: await o.write(t, "del", o.b, idA()),
    }).toEqual({
      upd: expect.stringMatching(/^(0|42501)$/),
      del: expect.stringMatching(/^(0|42501)$/),
    });
    expect(await pgCode(() => o.as(o.b, (tx) => t.insert(tx, o.a)))).toBe("42501");
    if (!t.writeOnly) expect(await o.countOf(t, o.a, idA())).toBe(1); // hàng của A còn nguyên
  });
  it("chuyển hàng sang tenant khác (UPDATE cột tenant) bị chặn: A chuyển hàng của mình sang B = 42501; B chuyển hàng của A = 0 hàng/42501", async () => {
    expect(await o.move(t, o.a, idA(), o.b)).toBe("42501");
    expect(await o.move(t, o.b, idA(), o.b)).toMatch(/^(0|42501)$/);
    if (!t.writeOnly) {
      expect(await o.countOf(t, o.a, idA())).toBe(1);
      expect(await o.countOf(t, o.b, idA())).toBe(0);
    }
  });
  it("thăm dò tồn tại: id của A ≡ id không tồn tại dưới B (đọc và ghi)", async () => {
    const probe = async (id: string) => ({
      sel: t.writeOnly ? -1 : await o.countOf(t, o.b, id),
      upd: await o.write(t, "upd", o.b, id),
      del: await o.write(t, "del", o.b, id),
      ins: await pgCode(() => o.as(o.b, (x) => t.insert(x, o.a, id))),
    });
    expect(await probe(idA())).toEqual(await probe(NIL));
  });
}

function roleCases(o: Ops, owner: () => Sql): void {
  it("NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOINHERIT, NOLOGIN", async () => {
    const [r] = await owner()<Record<(typeof FLAGS)[number], boolean>[]>`
      select rolbypassrls, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin from pg_roles where rolname = ${o.role}`;
    expect(r).toEqual({
      rolbypassrls: false,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
      rolcanlogin: false,
    });
  });
}

function schemaCases(spec: RlsPackSpec, o: Ops, owner: () => Sql): void {
  it("ENABLE + FORCE ROW LEVEL SECURITY và có policy trên mọi bảng khai", async () => {
    const rows = await owner()<{ relname: string; on: boolean; force: boolean; pol: number }[]>`
      select c.relname, c.relrowsecurity as on, c.relforcerowsecurity as force,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as pol
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${o.schema} and c.relname = any(${owner().array(spec.tables.map((t) => t.name))}::text[])`;
    const got = Object.fromEntries(
      rows.map((r) => [r.relname, { on: r.on, force: r.force, policies: r.pol > 0 }]),
    );
    const want = Object.fromEntries(
      spec.tables.map((t) => [t.name, { on: true, force: true, policies: true }]),
    );
    expect(got).toEqual(want);
  });
  it("không có bảng quên khai (mọi bảng của schema đều khai hoặc nằm trong ignoreTables)", async () => {
    const all = await owner()<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${o.schema} and c.relkind in ('r', 'p') and not c.relispartition order by 1`;
    const known = new Set([...spec.tables.map((t) => t.name), ...(spec.ignoreTables ?? [])]);
    expect(all.map((r) => r.relname).filter((n) => !known.has(n))).toEqual([]);
  });
}

/** Sinh bộ ca cho một gói. Gọi ở cấp file test: `defineRlsSuite(spec)`. */
export function defineRlsSuite(spec: RlsPackSpec): void {
  const o = makeOps(spec);
  let owner: Sql | undefined;
  let pks: Pks = new Map();
  const getOwner = (): Sql => owner as Sql;
  describe(`RLS gói ${spec.key} · hợp đồng cách ly tenant`, () => {
    beforeAll(async () => {
      owner = await spec.open();
      await spec.reset(owner);
      pks = new Map();
      for (const t of spec.tables)
        pks.set(t.name, { a: await t.seed(owner, o.a), b: await t.seed(owner, o.b) });
    });
    afterAll(async () => {
      if (owner) await spec.close(owner);
    });
    for (const t of spec.tables)
      describe(`bảng ${o.schema}.${t.name}`, () => tableCases(t, o, () => pks));
    describe(`role ${o.role}`, () => roleCases(o, getOwner));
    describe(`schema ${o.schema}`, () => schemaCases(spec, o, getOwner));
  });
}
