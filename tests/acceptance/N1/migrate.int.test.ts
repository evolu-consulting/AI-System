// PK-FR-04 · PK-FR-01 · PK-AC04 · plan §3 "Runner": migration gói idempotent, chạy dưới khoá advisory cụm, `pkdemo` chỉ ngoài
// production, `packs.install` / `packs.secure_table` kiểm đầu vào. Dùng DB nháp RIÊNG (clone mẫu Admin+Hub KHÔNG có gói) để
// kiểm "lần đầu áp" — DB chính của test:int:par đã có gói từ mẫu.
import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cloneMigratedTestDb, withDatabase } from "@ai/db/test-db";
import postgres from "postgres";
import { runMigrations } from "../../../packages/db/src/migrate";
import { runHubMigrations } from "../../../packages/db/src/migrate-hub";
import { loadMigratePacks, noFeature, ROOT } from "./_support/load";
import { OWNER_URL, pgCode, type Sql } from "./_support/n1";

/** `ai_system_<slot>_h1_test` → `ai_system_<slot>_h1_n1m_test` (hậu tố `_test` bắt buộc). */
const SCRATCH = withDatabase(
  OWNER_URL,
  `${decodeURIComponent(new URL(OWNER_URL).pathname.slice(1)).replace(/_test$/, "")}_n1m_test`,
);
const bare = async (url: string) => {
  await runMigrations({ url, appEnv: "test" });
  await runHubMigrations({ url, appEnv: "test" });
};
const freshBare = () => cloneMigratedTestDb(SCRATCH, { key: "n1bare", migrate: bare });
type Run = { kit: number; packs: Record<string, number> };
const run = async (appEnv: string, url = SCRATCH): Promise<Run> => {
  const m = await loadMigratePacks();
  return (await m.runPackMigrations({ url, appEnv })) as Run;
};
const open = (): Sql => postgres(SCRATCH, { max: 2, onnotice: () => {} });
/** Ảnh schema (cột + policy + bảng) để so "không đổi schema". */
async function shape(sql: Sql): Promise<string> {
  const cols = await sql`select table_schema, table_name, column_name, data_type, is_nullable
    from information_schema.columns where table_schema in ('packs','pkdemo') order by 1, 2, 3`;
  const pol = await sql`select schemaname, tablename, policyname, qual, with_check from pg_policies
    where schemaname in ('packs','pkdemo') order by 1, 2, 3`;
  const reg = await sql`select key from packs.registry order by 1`;
  return JSON.stringify({ cols, pol, reg });
}
let sql: Sql;
/** DB nháp mới (drop + clone từ mẫu) ⇒ kết nối cũ chết, mở lại. */
const fresh = async (): Promise<void> => {
  await sql?.end({ timeout: 1 });
  await freshBare();
  sql = open();
};
afterAll(async () => {
  await sql?.end({ timeout: 1 });
});

describe("PK-AC04 · db:migrate gói idempotent", () => {
  it("PK-AC04 · runPackMigrations lần 1 áp khung + pkdemo; lần 2 ⇒ 0 migration mới, không lỗi, schema không đổi", async () => {
    await loadMigratePacks();
    await fresh();
    const first = await run("test");
    expect(first.kit).toBeGreaterThanOrEqual(1);
    expect(first.packs.pkdemo).toBeGreaterThanOrEqual(1);
    const before = await shape(sql);
    const second = await run("test");
    expect({
      kit: second.kit,
      packs: Object.values(second.packs).reduce((a, b) => a + b, 0),
    }).toEqual({
      kit: 0,
      packs: 0,
    });
    expect(await shape(sql)).toBe(before);
  });
  it("PK-FR-04 · migrate gói đánh số từ 0001 và có thư mục riêng: migrations-packs/0001_*.sql, migrations-pack-pkdemo/0001_*.sql", async () => {
    const { readdirSync, existsSync } = await import("node:fs");
    const dir = (d: string) =>
      existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".sql")) : [];
    expect({
      kit: dir("packages/db/migrations-packs").some((f) => f.startsWith("0001")),
      pkdemo: dir("packages/db/migrations-pack-pkdemo").some((f) => f.startsWith("0001")),
    }).toEqual({ kit: true, pkdemo: true });
  });
  it("PK-FR-04 · khoá cụm: runner dùng withMigrateLock (CREATE ROLE là đối tượng cụm)", async () => {
    await loadMigratePacks();
    const src = readFileSync(join(ROOT, "packages/db/src/migrate-packs.ts"), "utf8");
    expect(/withMigrateLock/.test(src)).toBe(true);
  });
  it("PK-FR-04 · hai runner song song trên DB mới: không lỗi (XX000), mỗi migration áp đúng 1 lần (tổng = một lần chạy)", async () => {
    await loadMigratePacks();
    await fresh();
    const one = await run("test");
    await fresh();
    const [a, b] = await Promise.all([run("test"), run("test")]);
    expect({ kit: a.kit + b.kit, pkdemo: (a.packs.pkdemo ?? 0) + (b.packs.pkdemo ?? 0) }).toEqual({
      kit: one.kit,
      pkdemo: one.packs.pkdemo as number,
    });
  });
  it("PK-FR-04 · appEnv=production: áp khung nhưng KHÔNG cài pkdemo (gói kiểm thử chỉ ngoài production)", async () => {
    await loadMigratePacks();
    await fresh();
    const r = await run("production");
    expect(r.kit).toBeGreaterThanOrEqual(1);
    expect(r.packs.pkdemo ?? 0).toBe(0);
    const [s] = await sql<{ ns: string | null }[]>`select to_regnamespace('pkdemo')::text as ns`;
    expect(s?.ns).toBeNull();
    const reg = await sql<{ key: string }[]>`select key from packs.registry`;
    expect(reg.map((x) => x.key)).not.toContain("pkdemo");
  });
  it("PK-FR-04 · DB mẫu của test:int:par đã có schema gói (test-db-template gọi runPackMigrations)", async () => {
    const src = readFileSync(join(ROOT, "packages/db/src/test-db-template.ts"), "utf8");
    expect(/runPackMigrations/.test(src)).toBe(true);
  });
});

describe("PK-FR-01 · packs.install / packs.secure_table kiểm đầu vào", () => {
  it("PK-FR-01 · packs.install từ chối khoá sai: hoa, quá ngắn/dài, ký tự lạ, tên cấm, tiền tố pg_", async () => {
    await loadMigratePacks();
    await fresh();
    await run("test");
    const bad = [
      "Bad",
      "a",
      `a${"b".repeat(21)}`,
      "a-b",
      "1ab",
      "public",
      "admin",
      "hub",
      "drizzle",
      "packs",
      "information_schema",
      "pg_x",
    ];
    const codes: Record<string, string | null> = {};
    for (const k of bad) codes[k] = await pgCode(() => sql`select packs.install(${k})`);
    expect(Object.entries(codes).filter(([, c]) => c === null)).toEqual([]); // mọi khoá sai đều RAISE
  });
  it("PK-FR-01 · packs.install('n1tmp') tạo schema, role NOBYPASSRLS, 3 feature n1tmp-read|write|admin, registry; gọi lại idempotent", async () => {
    await loadMigratePacks();
    await fresh();
    await run("test");
    await sql`select packs.install('n1tmp')`;
    await sql`select packs.install('n1tmp')`; // idempotent
    const [r] = await sql<Record<string, unknown>[]>`select
      (select rolbypassrls from pg_roles where rolname = 'n1tmp_rw') as bypass,
      to_regnamespace('n1tmp') is not null as schema,
      (select array_agg(key order by key) from admin.features where key like 'n1tmp-%') as features,
      (select count(*)::int from packs.registry where key = 'n1tmp') as reg`;
    expect(r).toEqual({
      bypass: false,
      schema: true,
      features: ["n1tmp-admin", "n1tmp-read", "n1tmp-write"],
      reg: 1,
    });
    expect(await pgCode(() => sql`select 1 from n1tmp.files limit 1`)).toBeNull(); // bảng khung có
  });
  it("PK-FR-02 · packs.secure_table: thiếu tenant_id uuid NOT NULL ⇒ RAISE; đủ ⇒ ENABLE+FORCE RLS + policy; gọi lại không lỗi", async () => {
    await loadMigratePacks();
    await fresh();
    await run("test");
    await sql`select packs.install('n1tmp')`;
    await sql`create table n1tmp.no_tenant (id uuid primary key)`;
    await sql`create table n1tmp.nullable_t (id uuid primary key, tenant_id uuid)`;
    await sql`create table n1tmp.good (id uuid primary key, tenant_id uuid not null)`;
    expect(await pgCode(() => sql`select packs.secure_table('n1tmp', 'no_tenant')`)).not.toBeNull();
    expect(
      await pgCode(() => sql`select packs.secure_table('n1tmp', 'nullable_t')`),
    ).not.toBeNull();
    await sql`select packs.secure_table('n1tmp', 'good')`;
    await sql`select packs.secure_table('n1tmp', 'good')`;
    const [g] = await sql<
      { rls: boolean; forced: boolean; pol: number }[]
    >`select c.relrowsecurity as rls,
      c.relforcerowsecurity as forced,
      (select count(*)::int from pg_policies where schemaname = 'n1tmp' and tablename = 'good') as pol
      from pg_class c where c.oid = 'n1tmp.good'::regclass`;
    expect(g).toEqual({ rls: true, forced: true, pol: 1 });
  });
  it("PK-FR-01 · khoá gói chưa cài ⇒ không có gì rò sang schema khác: packs.registry chỉ chứa khoá đã install", async () => {
    await loadMigratePacks();
    await fresh();
    await run("test");
    const reg = await sql<{ key: string }[]>`select key from packs.registry order by key`;
    expect(reg.map((x) => x.key)).toEqual(["pkdemo"]);
    if (reg.length === 0) noFeature("packs.registry", "T5a");
  });
});
