// ADM-NFR-06, ADM-FR-62, ADM-FR-32, ADM-FR-53 · schema quyền M3: migration, ràng buộc, chỉ mục, trigger beta-testers
// (test-plan D1; M3-AC01 phần DB). Chỉ dùng owner + resetTestDb + runMigrations: KHÔNG seed, KHÔNG app, KHÔNG
// import _fixtures (để xanh ngay ở T2). Mỗi `it` tự dựng dữ liệu bằng `clean()`; không `it` nào đọc kết quả của `it` khác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";

const URL = process.env.TEST_DATABASE_URL;
if (!URL)
  throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev` rồi `bun run test:int`");
const sql = postgres(URL, { max: 1, onnotice: () => {} });
const ROOT = join(import.meta.dir, "../../..");

const T1 = "01900000-0000-7000-8000-000000000001";
const T2 = "01900000-0000-7000-8000-000000000002";
const U1 = "01900000-0000-7000-8000-000000000011";
const U2 = "01900000-0000-7000-8000-000000000012";
const UT2 = "01900000-0000-7000-8000-000000000021";
const G1 = "01900000-0000-7000-8000-000000000301";
const G2 = "01900000-0000-7000-8000-000000000302";
const GT2 = "01900000-0000-7000-8000-000000000303";
const F1 = "01900000-0000-7000-8000-000000000311";
const F2 = "01900000-0000-7000-8000-000000000312";

let firstRun: { main: number; dev: number };
let secondRun: { main: number; dev: number };

type PgFail = { code: string | null; constraint: string | null };
async function fail(q: PromiseLike<unknown>): Promise<PgFail | null> {
  try {
    await q;
    return null;
  } catch (e) {
    const err = e as { code?: string; constraint_name?: string };
    return { code: err.code ?? null, constraint: err.constraint_name ?? null };
  }
}
const code = async (q: PromiseLike<unknown>) => (await fail(q))?.code ?? null;

const names = async (schemas: string[]) =>
  (
    await sql<{ t: string }[]>`select table_schema || '.' || table_name as t
      from information_schema.tables
      where table_schema in ${sql(schemas)} and table_type = 'BASE TABLE' order by (table_schema || '.' || table_name) collate "C"`
  ).map((r) => r.t);

const ADMIN19 = [
  "admin.audit_log",
  "admin.command_names",
  "admin.commands",
  "admin.config_meta",
  "admin.feature_commands",
  "admin.feature_entitlements",
  "admin.feature_grants",
  "admin.features",
  "admin.group_members",
  "admin.groups",
  "admin.quota_alerts",
  "admin.refresh_tokens",
  "admin.secrets",
  "admin.tenant_quotas",
  "admin.tenants",
  "admin.user_backup_codes",
  "admin.user_totp",
  "admin.users",
  "admin.workflows",
];
const HUB3 = ["hub.agent_grants", "hub.agent_workflows", "hub.usage_logs"];

const clean = () =>
  sql`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features cascade`;
/** Hai tenant (trigger tự tạo beta-testers), mỗi tenant 1 user, 2 feature, 2 group acme, 1 group globex. */
async function base(): Promise<void> {
  await clean();
  await sql`insert into admin.tenants (id, key, name) values (${T1}, 'acme', 'Acme'), (${T2}, 'globex', 'Globex')`;
  await sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role) values
    (${U1}, ${T1}, 'an', 'h', 'An', 'member'), (${U2}, ${T1}, 'binh', 'h', 'Binh', 'member'),
    (${UT2}, ${T2}, 'hoa', 'h', 'Hoa', 'member')`;
  await sql`insert into admin.features (id, key, name, status) values
    (${F1}, 'ke-toan', '{"vi":"Kế toán"}'::jsonb, 'on'), (${F2}, 'dich-thuat', '{"vi":"Dịch"}'::jsonb, 'on')`;
  await sql`insert into admin.groups (id, tenant_id, key, name) values
    (${G1}, ${T1}, 'ke-toan', '{"vi":"Kế toán"}'::jsonb), (${G2}, ${T1}, 'kinh-doanh', '{"vi":"KD"}'::jsonb),
    (${GT2}, ${T2}, 'ke-toan', '{"vi":"Kế toán"}'::jsonb)`;
}

beforeAll(async () => {
  await resetTestDb(URL);
  firstRun = await runMigrations({ url: URL, appEnv: "development" });
  secondRun = await runMigrations({ url: URL, appEnv: "development" });
});
afterAll(async () => {
  await sql.end();
});

describe("ADM-NFR-06 · migration M3", () => {
  it("ADM-NFR-06 · spec M3 §4 · development: {main: 11, dev:3}; lần 2 {0,0}; 11 hàng __drizzle_migrations", async () => {
    expect(firstRun).toEqual({ main: 11, dev: 3 });
    expect(secondRun).toEqual({ main: 0, dev: 0 });
    const [n] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(n?.n).toBe(11);
  });

  it("ADM-NFR-06 · spec M3 §4 · đúng 19 bảng admin.* (M4) + 3 bảng hub.* (M4 Q2a K3)", async () => {
    expect(await names(["admin", "hub"])).toEqual([...ADMIN19, ...HUB3]);
  });

  it("ADM-NFR-06 · CONVENTIONS §8 · migration 0000–0004 và hub-stub bất biến (băm ở HEAD khi viết test); journal có 0005_admin_permissions và 0006_permissions_rls", () => {
    const hash = (rel: string) =>
      createHash("sha256")
        .update(readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n"))
        .digest("hex");
    const want: Record<string, string> = {
      "packages/db/migrations/0000_init_schemas.sql":
        "bb508c7e8c9777bd3e9bddcb6c04fb005239c119435fb7473d73d4ad97fc98ec",
      "packages/db/migrations/0001_admin_identity.sql":
        "0629976f54062831cc6572c318d105420fd5757b7d2d2fd54de966c7d3677ed4",
      "packages/db/migrations/0002_admin_rls.sql":
        "2dca86ca779589faf2a031ea6d70b66d3f0d42bd2e88252f1dd2f5df65044a64",
      "packages/db/migrations/0003_admin_catalog.sql":
        "7e8926b6efa9dabbf31ad7572ae17b69b912bb5a578ce0b13ecefe88ce366904",
      "packages/db/migrations/0004_catalog_rls.sql":
        "0ceb13502f2c2ab33176da8ddb85ddfc09b22535078438fbc985dfe914bf7cec",
      "packages/db/migrations-dev/0000_hub_stub.sql":
        "6338cb221326a11c9d44d22e686a01455ef58f20a61af686e083c7f64cdfa132",
    };
    for (const [rel, h] of Object.entries(want)) expect([rel, hash(rel)]).toEqual([rel, h]);
    const journal = readFileSync(join(ROOT, "packages/db/migrations/meta/_journal.json"), "utf8");
    expect(journal).toContain("0005_admin_permissions");
    expect(journal).toContain("0006_permissions_rls");
  });
});

describe("ADM-FR-62 · ràng buộc groups (M3-R01)", () => {
  it("ADM-FR-62 · M3-R01 · groups_tenant_key_uq: trùng key trong tenant → 23505; cùng key khác tenant ok; groups_tenant_id_uq tồn tại", async () => {
    await base();
    const dup = await fail(
      sql`insert into admin.groups (tenant_id, key, name) values (${T1}, 'ke-toan', '{"vi":"x"}'::jsonb)`,
    );
    expect(dup).toEqual({ code: "23505", constraint: "groups_tenant_key_uq" });
    const [idx] = await sql`select 1 as one from pg_indexes
      where schemaname = 'admin' and indexname = 'groups_tenant_id_uq'`;
    expect(idx?.one).toBe(1);
    const ok = await sql`select count(*)::int as n from admin.groups where key = 'ke-toan'`;
    expect(ok[0]?.n).toBe(2);
  });

  it("ADM-FR-62 · M3-R01 · CHECK key: A, a, a_b, 33 ký tự → 23514; ab và 32 ký tự ok", async () => {
    await base();
    const ins = (key: string) =>
      sql`insert into admin.groups (tenant_id, key, name) values (${T2}, ${key}, '{"vi":"x"}'::jsonb)`;
    for (const key of ["A", "a", "a_b", "k".repeat(33)]) expect(await code(ins(key))).toBe("23514");
    expect(await fail(ins("ab"))).toBeNull();
    expect(await fail(ins("k".repeat(32)))).toBeNull();
  });

  it("ADM-FR-62 · M3-R01 · CHECK name: thiếu khoá vi / không phải object → 23514; description 401 ký tự → 23514, 400 ok", async () => {
    await base();
    let n = 0;
    const ins = (name: string, desc: string | null = null) =>
      sql`insert into admin.groups (tenant_id, key, name, description)
        values (${T2}, ${`gr${++n}`}, ${sql.json(JSON.parse(name))}, ${desc})`;
    expect(await code(ins('{"en":"x"}'))).toBe("23514");
    expect(await code(ins('"chuoi"'))).toBe("23514");
    expect(await code(ins('{"vi":"x"}', "d".repeat(401)))).toBe("23514");
    expect(await fail(ins('{"vi":"x"}', "d".repeat(400)))).toBeNull();
  });

  it("ADM-FR-55 · M3-R01 · mặc định version 1; updated_by FK ON DELETE SET NULL (xoá user → null, group còn)", async () => {
    await base();
    await sql`update admin.groups set updated_by = ${U1} where id = ${G1}`;
    const [g] = await sql`select version, updated_by from admin.groups where id = ${G1}`;
    expect(g?.version).toBe(1);
    expect(g?.updated_by).toBe(U1);
    await sql`delete from admin.users where id = ${U1}`;
    const [after] = await sql`select updated_by from admin.groups where id = ${G1}`;
    expect(after?.updated_by).toBeNull();
  });
});

describe("ADM-FR-62 · ràng buộc group_members (M3-R03)", () => {
  it("ADM-FR-62 · M3-R03 · PK (group_id, user_id): trùng → 23505; user_idx tồn tại", async () => {
    await base();
    await sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T1}, ${G1}, ${U1})`;
    const dup = await fail(
      sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T1}, ${G1}, ${U1})`,
    );
    expect(dup).toEqual({ code: "23505", constraint: "group_members_pkey" });
    const [idx] = await sql`select 1 as one from pg_indexes
      where schemaname = 'admin' and indexname = 'group_members_user_idx'`;
    expect(idx?.one).toBe(1);
  });

  it("ADM-FR-62 · M3-R03 · FK kép chặn user/group khác tenant → 23503 (owner, không bị RLS che)", async () => {
    await base();
    const ins = (t: string, g: string, u: string) =>
      sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${t}, ${g}, ${u})`;
    expect(await code(ins(T1, G1, UT2))).toBe("23503");
    expect(await code(ins(T1, GT2, U1))).toBe("23503");
    expect(await code(ins(T2, G1, UT2))).toBe("23503");
    expect(await fail(ins(T1, G1, U2))).toBeNull();
  });

  it("ADM-FR-62 · M3-R04 · xoá group hoặc user → CASCADE xoá hàng thành viên", async () => {
    await base();
    await sql`insert into admin.group_members (tenant_id, group_id, user_id) values
      (${T1}, ${G1}, ${U1}), (${T1}, ${G2}, ${U2}), (${T1}, ${G2}, ${U1})`;
    await sql`delete from admin.groups where id = ${G1}`;
    expect((await sql`select count(*)::int as n from admin.group_members`)[0]?.n).toBe(2);
    await sql`delete from admin.users where id = ${U1}`;
    expect((await sql`select count(*)::int as n from admin.group_members`)[0]?.n).toBe(1);
  });
});

describe("ADM-FR-32 · ràng buộc feature_grants (M3-R07, R10)", () => {
  const grant = (t: string, f: string, g: string | null, u: string | null) =>
    sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id)
      values (${t}, ${f}, ${g}, ${u})`;

  it("ADM-FR-32 · M3-R07 · feature_grants_subject_check: cả hai null / cả hai có → 23514", async () => {
    await base();
    expect(await fail(grant(T1, F1, null, null))).toEqual({
      code: "23514",
      constraint: "feature_grants_subject_check",
    });
    expect(await code(grant(T1, F1, G1, U1))).toBe("23514");
    expect(await fail(grant(T1, F1, G1, null))).toBeNull();
  });

  it("ADM-FR-32 · M3-R07 · unique từng phần: trùng (feature, group) → 23505 feature_grants_group_uq; trùng (feature, user) → feature_grants_user_uq; khác subject ok", async () => {
    await base();
    await grant(T1, F1, G1, null);
    expect(await fail(grant(T1, F1, G1, null))).toEqual({
      code: "23505",
      constraint: "feature_grants_group_uq",
    });
    await grant(T1, F1, null, U1);
    expect(await fail(grant(T1, F1, null, U1))).toEqual({
      code: "23505",
      constraint: "feature_grants_user_uq",
    });
    expect(await fail(grant(T1, F1, G2, null))).toBeNull();
    expect(await fail(grant(T1, F2, G1, null))).toBeNull();
  });

  it("ADM-FR-32 · M3-R07 · FK kép: group/user của tenant khác với tenant_id của grant → 23503", async () => {
    await base();
    expect(await code(grant(T1, F1, GT2, null))).toBe("23503");
    expect(await code(grant(T1, F1, null, UT2))).toBe("23503");
    expect(await code(grant(T2, F1, G1, null))).toBe("23503");
    expect(await fail(grant(T2, F1, GT2, null))).toBeNull();
  });

  it("ADM-FR-32 · M3-R04/R10 · xoá feature, group, user hoặc tenant → CASCADE xoá grant; granted_by FK SET NULL", async () => {
    await base();
    await grant(T1, F1, G1, null);
    await grant(T1, F2, G2, null);
    await grant(T1, F1, null, U1);
    await sql`update admin.feature_grants set granted_by = ${U2}`;
    await sql`delete from admin.users where id = ${U2}`;
    expect(
      (await sql`select count(*)::int as n from admin.feature_grants where granted_by is null`)[0]
        ?.n,
    ).toBe(3);
    const n = async () => (await sql`select count(*)::int as n from admin.feature_grants`)[0]?.n;
    await sql`delete from admin.features where id = ${F2}`;
    expect(await n()).toBe(2);
    await sql`delete from admin.groups where id = ${G1}`;
    expect(await n()).toBe(1);
    await sql`delete from admin.users where id = ${U1}`;
    expect(await n()).toBe(0);
    await grant(T2, F1, GT2, null);
    // users.tenant_id → tenants là RESTRICT (M1, CR-006: không xoá tenant ở app): dọn user của T2 trước (TC-2).
    await sql`delete from admin.users where tenant_id = ${T2}`;
    await sql`delete from admin.tenants where id = ${T2}`;
    expect(await n()).toBe(0);
    expect(
      (await sql`select count(*)::int as n from admin.groups where tenant_id = ${T2}`)[0]?.n,
    ).toBe(0);
  });

  it("ADM-FR-32 · spec M3 §4 · chỉ mục tồn tại; users_tenant_id_uq trên (tenant_id, id) là đích của FK kép", async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`select indexname, indexdef
      from pg_indexes where schemaname = 'admin'`;
    const have = rows.map((r) => r.indexname);
    for (const n of [
      "users_tenant_id_uq",
      "groups_tenant_id_uq",
      "groups_tenant_key_uq",
      "group_members_pkey",
      "group_members_user_idx",
      "feature_grants_group_uq",
      "feature_grants_user_uq",
      "feature_grants_tenant_feature_idx",
      "feature_grants_group_idx",
      "feature_grants_user_idx",
      "config_meta_pkey",
      "feature_entitlements_tenant_active_idx",
    ]) {
      expect(have).toContain(n);
    }
    const uq = rows.find((r) => r.indexname === "users_tenant_id_uq");
    expect(uq?.indexdef).toMatch(/UNIQUE.*\(tenant_id, id\)/);
    expect(rows.find((r) => r.indexname === "feature_grants_group_uq")?.indexdef).toMatch(
      /WHERE \(group_id IS NOT NULL\)/,
    );
    expect(rows.find((r) => r.indexname === "feature_grants_user_uq")?.indexdef).toMatch(
      /WHERE \(user_id IS NOT NULL\)/,
    );
  });
});

describe("ADM-FR-53 · config_meta (M3-R15)", () => {
  it("ADM-FR-53 · M3-R15 · sau migrate có đúng một hàng (id=1, config_version=0); id=2 và config_version<0 → 23514; updated_at mặc định ≈ now", async () => {
    const rows = await sql`select id, config_version, updated_at from admin.config_meta`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(1);
    expect(rows[0]?.config_version).toBe(0);
    expect(await code(sql`insert into admin.config_meta (id, config_version) values (2, 0)`)).toBe(
      "23514",
    );
    expect(await code(sql`update admin.config_meta set config_version = -1`)).toBe("23514");
    expect(Math.abs(Date.now() - new Date(rows[0]?.updated_at as string).getTime())).toBeLessThan(
      7 * 24 * 3600 * 1000,
    );
  });
});

describe("ADM-FR-62 · trigger beta-testers (M3-R02)", () => {
  it("ADM-FR-62 · M3-R02 · tenants_beta_group tồn tại (AFTER INSERT FOR EACH ROW); admin.create_beta_group SECURITY INVOKER, có search_path cố định; PUBLIC không EXECUTE", async () => {
    const [t] = await sql`select tgname, tgtype, tgenabled from pg_trigger
      where tgname = 'tenants_beta_group' and tgrelid = 'admin.tenants'::regclass`;
    expect(t?.tgname).toBe("tenants_beta_group");
    // bit 0 = ROW, bit 2 = INSERT, bit 1 = BEFORE (0 = AFTER)
    expect((t?.tgtype as number) & 1).toBe(1);
    expect((t?.tgtype as number) & 4).toBe(4);
    expect((t?.tgtype as number) & 2).toBe(0);
    const [f] = await sql`select prosecdef, proconfig from pg_proc
      where proname = 'create_beta_group' and pronamespace = 'admin'::regnamespace`;
    expect(f?.prosecdef).toBe(false);
    expect((f?.proconfig as string[] | null)?.some((c) => c.startsWith("search_path="))).toBe(true);
    const [p] =
      await sql`select has_function_privilege('public', 'admin.create_beta_group()', 'EXECUTE') as ok`;
    expect(p?.ok).toBe(false);
  });

  it("ADM-FR-62 · M3-R02 · owner INSERT tenant → đúng MỘT beta-testers (name vi/en 'Beta testers', mô tả 'Thấy các feature đang Beta'); hai tenant một câu → mỗi tenant một", async () => {
    await clean();
    await sql`insert into admin.tenants (id, key, name) values (${T1}, 'acme', 'Acme'), (${T2}, 'globex', 'Globex')`;
    const rows =
      await sql`select tenant_id, key, name, description, version from admin.groups order by tenant_id`;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.key).toBe("beta-testers");
      expect(r.name).toEqual({ vi: "Beta testers", en: "Beta testers" });
      expect(r.description).toBe("Thấy các feature đang Beta");
      expect(r.version).toBe(1);
    }
    expect(rows.map((r) => r.tenant_id)).toEqual([T1, T2]);
  });

  it("ADM-FR-62 · M3-R02 · ON CONFLICT DO NOTHING: chèn lại beta-testers cùng tenant bằng tay → 23505 (đã có), không nhân đôi", async () => {
    await clean();
    await sql`insert into admin.tenants (id, key, name) values (${T1}, 'acme', 'Acme')`;
    const dup = await fail(
      sql`insert into admin.groups (tenant_id, key, name) values (${T1}, 'beta-testers', '{"vi":"x"}'::jsonb)`,
    );
    expect(dup?.code).toBe("23505");
    expect(
      (await sql`select count(*)::int as n from admin.groups where tenant_id = ${T1}`)[0]?.n,
    ).toBe(1);
  });

  it("ADM-FR-62 · M3-R02 · backfill của 0006 (đọc file migration làm artifact): xoá beta-testers của một tenant rồi chạy lại câu INSERT…SELECT → có lại đúng một, tenant khác không bị nhân đôi", async () => {
    await clean();
    await sql`insert into admin.tenants (id, key, name) values (${T1}, 'acme', 'Acme'), (${T2}, 'globex', 'Globex')`;
    const file = readFileSync(
      join(ROOT, "packages/db/migrations/0006_permissions_rls.sql"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const stmts = file.split("--> statement-breakpoint").map((s) => s.trim());
    const backfill = stmts.find(
      (s) => /INSERT INTO admin\.groups/i.test(s) && /FROM admin\.tenants/i.test(s),
    );
    expect(backfill).toBeDefined();
    await sql`delete from admin.groups where tenant_id = ${T1}`;
    await sql.unsafe((backfill as string).replace(/--[^\n]*\n/g, "\n"));
    const rows =
      await sql`select tenant_id, key, name, description from admin.groups order by tenant_id`;
    expect(rows.map((r) => [r.tenant_id, r.key])).toEqual([
      [T1, "beta-testers"],
      [T2, "beta-testers"],
    ]);
    expect(rows[0]?.name).toEqual({ vi: "Beta testers", en: "Beta testers" });
    expect(rows[0]?.description).toBe("Thấy các feature đang Beta");
  });
});

describe("ADM-NFR-06 · bất biến M1/M2 còn nguyên", () => {
  it("ADM-NFR-06 · M1/M2 · users không có cột groups/group_ids; secrets không có cột value; hub.agent_workflows còn agent_id/workflow_id", async () => {
    const cols = async (schema: string, table: string) =>
      (
        await sql<{ c: string }[]>`select column_name as c from information_schema.columns
          where table_schema = ${schema} and table_name = ${table}`
      ).map((r) => r.c);
    const users = await cols("admin", "users");
    expect(users).not.toContain("groups");
    expect(users).not.toContain("group_ids");
    expect(await cols("admin", "secrets")).not.toContain("value");
    const aw = await cols("hub", "agent_workflows");
    expect(aw).toContain("agent_id");
    expect(aw).toContain("workflow_id");
  });

  it("ADM-NFR-07 · M2 · admin_rw vẫn không đọc được secrets.ciphertext/iv; feature_entitlements còn chỉ mục từng phần revoked_at IS NULL", async () => {
    const [c] =
      await sql`select has_column_privilege('admin_rw', 'admin.secrets', 'ciphertext', 'SELECT') as ct,
      has_column_privilege('admin_rw', 'admin.secrets', 'iv', 'SELECT') as iv,
      has_column_privilege('admin_rw', 'admin.secrets', 'name', 'SELECT') as nm`;
    expect([c?.ct, c?.iv, c?.nm]).toEqual([false, false, true]);
    const [i] = await sql`select indexdef from pg_indexes
      where schemaname = 'admin' and indexname = 'feature_entitlements_tenant_active_idx'`;
    expect(i?.indexdef).toMatch(/WHERE \(revoked_at IS NULL\)/);
  });
});

describe("ADM-NFR-06 · migration production M3", () => {
  beforeAll(async () => {
    await resetTestDb(URL);
  });
  afterAll(async () => {
    await resetTestDb(URL);
    await runMigrations({ url: URL, appEnv: "development" });
  });

  it("ADM-NFR-06 · spec M3 §4 · production: {main: 11, dev:0}; 19 bảng admin.* (M4), 0 bảng hub.*", async () => {
    const r = await runMigrations({ url: URL, appEnv: "production" });
    expect(r).toEqual({ main: 11, dev: 0 });
    expect(await names(["admin", "hub"])).toEqual(ADMIN19);
  });
});
