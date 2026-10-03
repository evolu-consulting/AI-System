// ADM-NFR-06, ADM-FR-10, ADM-FR-20, ADM-FR-30, ADM-FR-31, ADM-FR-50, ADM-BR-01, ADM-BR-02, ADM-BR-10 ·
// schema danh mục M2: migration, ràng buộc, chỉ mục (test-plan D1). Chỉ dùng owner + resetTestDb +
// runMigrations: KHÔNG seed, KHÔNG app, KHÔNG import _fixtures (để xanh ngay ở T2).
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

const id = (n: number) => `01900000-0000-7000-8000-0000000002${String(n).padStart(2, "0")}`;
const S1 = id(1);
const S2 = id(2);
const W1 = id(11);
const W2 = id(12);
const C1 = id(21);
const C2 = id(22);
const F1 = id(31);
const F2 = id(32);
const T1 = "01900000-0000-7000-8000-000000000001";
const T2 = "01900000-0000-7000-8000-000000000002";
const U1 = "01900000-0000-7000-8000-000000000011";
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
    await sql<
      { t: string }[]
    >`select table_schema || '.' || table_name as t from information_schema.tables
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

const j = (text: string) => sql.json(JSON.parse(text));
const clean = () =>
  sql`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features,
    admin.secrets, admin.workflows, admin.commands cascade`;

const secret = (
  sid: string,
  name: string,
  over: { ct?: Buffer; iv?: Buffer; last4?: string; note?: string; kv?: number } = {},
) =>
  sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4, note)
    values (${sid}, ${name}, ${over.ct ?? Buffer.alloc(32, 1)}, ${over.iv ?? Buffer.alloc(12, 2)},
      ${over.kv ?? 1}, ${over.last4 ?? "abcd"}, ${over.note ?? null})`;

type WfOver = {
  key?: string;
  name?: string;
  desc?: string;
  app?: string;
  url?: string;
  schema?: string;
  out?: string | null;
  secret?: string;
};
const workflow = (wid: string, o: WfOver = {}) =>
  sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, input_schema, output_field)
    values (${wid}, ${o.key ?? "translate"}, ${o.name ?? "Translate"}, ${o.desc ?? "d".repeat(30)},
      ${o.app ?? "workflow"}, ${o.url ?? "https://dify.example.com/v1"}, ${o.secret ?? S1},
      ${j(o.schema ?? "[]")}, ${o.out === undefined ? null : o.out})`;

type CmdOver = {
  name?: string;
  aliases?: string[];
  desc?: string;
  mode?: string;
  timeout?: number;
  args?: string;
  map?: string;
  wf?: string;
};
const command = (cid: string, o: CmdOver = {}) =>
  sql`insert into admin.commands (id, name, aliases, description, workflow_id, args, input_map, output, mode, timeout_s)
    values (${cid}, ${o.name ?? "dich"}, ${o.aliases ?? []}, ${j(o.desc ?? '{"vi":"Dịch"}')}, ${o.wf ?? W1},
      ${j(o.args ?? "[]")}, ${j(o.map ?? "{}")}, '{"field":"text","render":"markdown"}'::jsonb,
      ${o.mode ?? "sync"}, ${o.timeout ?? 30})`;

const feature = (fid: string, key: string) =>
  sql`insert into admin.features (id, key, name, status) values (${fid}, ${key}, '{"vi":"x"}'::jsonb, 'on')`;
const tenant = (tid: string, key: string) =>
  sql`insert into admin.tenants (id, key, name) values (${tid}, ${key}, 'N')`;

async function base() {
  await clean();
  await secret(S1, "DIFY_TRANSLATE_KEY");
  await workflow(W1);
}

beforeAll(async () => {
  await resetTestDb(URL);
  firstRun = await runMigrations({ url: URL, appEnv: "development" });
  secondRun = await runMigrations({ url: URL, appEnv: "development" });
});
afterAll(async () => {
  await sql.end();
});

describe("ADM-NFR-06 · migration M2", () => {
  it("ADM-NFR-06 · spec M2 §4 · development: {main:9, dev:3}; lần 2 {0,0}", () => {
    expect(firstRun).toEqual({ main: 9, dev: 3 });
    expect(secondRun).toEqual({ main: 0, dev: 0 });
  });

  it("ADM-NFR-06 · spec M2 §4 · đúng 19 bảng admin.* (M4) + 3 bảng hub.* (M4 Q2a K3)", async () => {
    expect(await names(["admin", "hub"])).toEqual([...ADMIN19, ...HUB3]);
  });

  it("ADM-NFR-06 · CONVENTIONS §8 · migration 0000–0002 và hub-stub bất biến (băm ở HEAD khi viết test); có đúng 0003_admin_catalog và 0004_catalog_rls", () => {
    const hash = (rel: string) =>
      createHash("sha256")
        .update(readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n"))
        .digest("hex");
    expect(hash("packages/db/migrations/0000_init_schemas.sql")).toBe(
      "bb508c7e8c9777bd3e9bddcb6c04fb005239c119435fb7473d73d4ad97fc98ec",
    );
    expect(hash("packages/db/migrations/0001_admin_identity.sql")).toBe(
      "0629976f54062831cc6572c318d105420fd5757b7d2d2fd54de966c7d3677ed4",
    );
    expect(hash("packages/db/migrations/0002_admin_rls.sql")).toBe(
      "2dca86ca779589faf2a031ea6d70b66d3f0d42bd2e88252f1dd2f5df65044a64",
    );
    expect(hash("packages/db/migrations-dev/0000_hub_stub.sql")).toBe(
      "6338cb221326a11c9d44d22e686a01455ef58f20a61af686e083c7f64cdfa132",
    );
    const files = readFileSync(join(ROOT, "packages/db/migrations/meta/_journal.json"), "utf8");
    expect(files).toContain("0003_admin_catalog");
    expect(files).toContain("0004_catalog_rls");
  });

  it("ADM-NFR-06 · spec M2 §4 · chỉ mục tồn tại; feature_entitlements_tenant_active_idx là chỉ mục từng phần WHERE revoked_at IS NULL", async () => {
    const rows = await sql<
      { indexname: string; indexdef: string }[]
    >`select indexname, indexdef from pg_indexes where schemaname = 'admin'`;
    const have = rows.map((r) => r.indexname);
    for (const n of [
      "secrets_name_uq",
      "workflows_key_uq",
      "workflows_secret_idx",
      "commands_name_uq",
      "commands_workflow_idx",
      "command_names_command_idx",
      "feature_commands_command_idx",
      "feature_entitlements_tenant_active_idx",
    ]) {
      expect(have).toContain(n);
    }
    const partial = rows.find((r) => r.indexname === "feature_entitlements_tenant_active_idx");
    expect(partial?.indexdef).toMatch(/WHERE \(?revoked_at IS NULL\)?/);
  });

  it("ADM-NFR-06 · spec M2 §4 · kiểu cột: bytea/text/text[]/jsonb; secrets không có cột value/version", async () => {
    const cols = await sql<{ t: string; c: string; ty: string }[]>`
      select table_name as t, column_name as c, data_type as ty
      from information_schema.columns where table_schema = 'admin'
        and table_name in ('secrets', 'commands', 'workflows', 'feature_entitlements')`;
    const type = (t: string, c: string) => cols.find((x) => x.t === t && x.c === c)?.ty;
    expect(type("secrets", "ciphertext")).toBe("bytea");
    expect(type("secrets", "iv")).toBe("bytea");
    expect(type("secrets", "last4")).toBe("text");
    expect(type("secrets", "value")).toBeUndefined();
    expect(type("secrets", "version")).toBeUndefined();
    expect(type("commands", "aliases")).toBe("ARRAY");
    for (const c of ["description", "args", "input_map", "output"]) {
      expect(type("commands", c)).toBe("jsonb");
    }
    expect(type("workflows", "input_schema")).toBe("jsonb");
    expect(type("feature_entitlements", "revoked_at")).toBe("timestamp with time zone");
  });
});

describe("ADM-FR-50 · ràng buộc secrets", () => {
  it("ADM-FR-50 · spec M2 §4 · secrets_name_uq (23505); CHECK name (dify_x, A, 65 ký tự → 23514)", async () => {
    await clean();
    await secret(S1, "DIFY_KEY");
    expect(await fail(secret(S2, "DIFY_KEY"))).toEqual({
      code: "23505",
      constraint: "secrets_name_uq",
    });
    for (const bad of ["dify_x", "A", "A".repeat(65), "DIFY-KEY"]) {
      expect(await code(secret(S2, bad))).toBe("23514");
    }
    expect(await code(secret(S2, "A".repeat(64)))).toBeNull();
  });

  it("ADM-FR-50 · spec M2 §4 · iv 11 byte và ciphertext 23 / 6161 byte → 23514; 24 và 6160 ok", async () => {
    await clean();
    expect(await code(secret(S1, "S_IV", { iv: Buffer.alloc(11) }))).toBe("23514");
    expect(await code(secret(S1, "S_CT1", { ct: Buffer.alloc(23) }))).toBe("23514");
    expect(await code(secret(S1, "S_CT2", { ct: Buffer.alloc(6161) }))).toBe("23514");
    expect(await code(secret(S1, "S_CT3", { ct: Buffer.alloc(24) }))).toBeNull();
    expect(await code(secret(S2, "S_CT4", { ct: Buffer.alloc(6160) }))).toBeNull();
  });

  it("ADM-FR-50 · spec M2 §4 · last4 3 ký tự, note 201 ký tự, key_version 0 → 23514; emoji 4 code point ok; mặc định key_version = 1", async () => {
    await clean();
    expect(await code(secret(S1, "S_L3", { last4: "abc" }))).toBe("23514");
    expect(await code(secret(S1, "S_N201", { note: "n".repeat(201) }))).toBe("23514");
    expect(await code(secret(S1, "S_KV0", { kv: 0 }))).toBe("23514");
    expect(await code(secret(S1, "S_EMOJI", { last4: "😀😀😀😀" }))).toBeNull();
    await sql`insert into admin.secrets (id, name, ciphertext, iv, last4)
      values (${S2}, 'S_DEFAULT', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`;
    const [row] = await sql`select key_version from admin.secrets where id = ${S2}`;
    expect(row?.key_version).toBe(1);
  });
});

describe("ADM-FR-10 · ràng buộc workflows", () => {
  it("ADM-FR-10 · spec M2 §4 · workflows_key_uq; CHECK key; name rỗng/129; output_field rỗng/129", async () => {
    await base();
    expect(await fail(workflow(W2))).toEqual({ code: "23505", constraint: "workflows_key_uq" });
    for (const key of ["A", "a", "a_b", "x".repeat(33)]) {
      expect(await code(workflow(W2, { key }))).toBe("23514");
    }
    expect(await code(workflow(W2, { key: "ab", name: "" }))).toBe("23514");
    expect(await code(workflow(W2, { key: "ab", name: "n".repeat(129) }))).toBe("23514");
    expect(await code(workflow(W2, { key: "ab", out: "" }))).toBe("23514");
    expect(await code(workflow(W2, { key: "ab", out: "o".repeat(129) }))).toBe("23514");
    expect(await code(workflow(W2, { key: "ab", out: "text" }))).toBeNull();
  });

  it("ADM-FR-10 · M2-AC07 · mô tả 19 / 401 ký tự → 23514; 20 và 400 ok", async () => {
    await base();
    expect(await code(workflow(W2, { key: "d19", desc: "d".repeat(19) }))).toBe("23514");
    expect(await code(workflow(W2, { key: "d401", desc: "d".repeat(401) }))).toBe("23514");
    expect(await code(workflow(W2, { key: "d20", desc: "d".repeat(20) }))).toBeNull();
    expect(await code(workflow(id(13), { key: "d400", desc: "d".repeat(400) }))).toBeNull();
  });

  it("ADM-FR-10 · spec M2 §4 · app_type lạ, base_url ftp://, input_schema không phải mảng → 23514", async () => {
    await base();
    expect(await code(workflow(W2, { key: "bad1", app: "bot" }))).toBe("23514");
    expect(await code(workflow(W2, { key: "bad2", url: "ftp://x.com" }))).toBe("23514");
    expect(await code(workflow(W2, { key: "bad3", schema: "{}" }))).toBe("23514");
  });

  it("ADM-FR-10 · spec M2 §4 · FK secret_id RESTRICT: xoá secret đang dùng → 23503; mặc định enabled true, input_schema '[]', version 1", async () => {
    await base();
    expect(await code(sql`delete from admin.secrets where id = ${S1}`)).toBe("23503");
    await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
      values (${W2}, 'dflt', 'D', ${"d".repeat(25)}, 'chat', 'http://x.com', ${S1})`;
    const [w] =
      await sql`select enabled, input_schema, version from admin.workflows where id = ${W2}`;
    expect(w).toMatchObject({ enabled: true, input_schema: [], version: 1 });
  });
});

describe("ADM-FR-20 · ràng buộc commands", () => {
  it("ADM-BR-01 · spec M2 §4 · commands_name_uq; CHECK name; cardinality(aliases) 6 → 23514, 5 ok", async () => {
    await base();
    await command(C1);
    expect(await fail(command(C2))).toEqual({ code: "23505", constraint: "commands_name_uq" });
    for (const name of ["D", "a_b", "x".repeat(33)]) {
      expect(await code(command(C2, { name }))).toBe("23514");
    }
    const six = ["a1", "a2", "a3", "a4", "a5", "a6"];
    expect(await code(command(C2, { name: "ok6", aliases: six }))).toBe("23514");
    expect(await code(command(C2, { name: "ok5", aliases: six.slice(0, 5) }))).toBeNull();
  });

  it("ADM-FR-20 · spec M2 §4 · description thiếu khoá vi, mode lạ, timeout 0/601, args không phải mảng, input_map không phải object → 23514", async () => {
    await base();
    expect(await code(command(C1, { name: "c1", desc: '{"en":"x"}' }))).toBe("23514");
    expect(await code(command(C1, { name: "c2", mode: "batch" }))).toBe("23514");
    expect(await code(command(C1, { name: "c3", timeout: 0 }))).toBe("23514");
    expect(await code(command(C1, { name: "c4", timeout: 601 }))).toBe("23514");
    expect(await code(command(C1, { name: "c5", args: "{}" }))).toBe("23514");
    expect(await code(command(C1, { name: "c6", map: "[]" }))).toBe("23514");
    expect(await code(command(C1, { name: "c7", timeout: 600 }))).toBeNull();
  });

  it("ADM-BR-02 · spec M2 §4 · FK workflow_id RESTRICT: xoá workflow có command → 23503; mặc định mode sync, timeout 30, aliases '{}', enabled true", async () => {
    await base();
    await sql`insert into admin.commands (id, name, description, workflow_id, output)
      values (${C1}, 'dflt', '{"vi":"x"}'::jsonb, ${W1}, '{"field":"t","render":"text"}'::jsonb)`;
    expect(await code(sql`delete from admin.workflows where id = ${W1}`)).toBe("23503");
    const [c] =
      await sql`select mode, timeout_s, aliases, enabled, version from admin.commands where id = ${C1}`;
    expect(c).toMatchObject({
      mode: "sync",
      timeout_s: 30,
      aliases: [],
      enabled: true,
      version: 1,
    });
  });
});

describe("ADM-BR-01 · command_names, feature_commands, feature_entitlements", () => {
  it("ADM-BR-01 · M2-R13 · command_names: PK trùng 23505 (tên ↔ alias của command khác); CHECK regex; xoá command → CASCADE", async () => {
    await base();
    await command(C1);
    await command(C2, { name: "tr-nhanh" });
    await sql`insert into admin.command_names (name, command_id) values ('dich', ${C1}), ('tr', ${C1})`;
    expect(
      await code(sql`insert into admin.command_names (name, command_id) values ('tr', ${C2})`),
    ).toBe("23505");
    expect(
      await code(
        sql`insert into admin.command_names (name, command_id) values ('Bad_Name', ${C2})`,
      ),
    ).toBe("23514");
    await sql`delete from admin.commands where id = ${C1}`;
    const [n] = await sql`select count(*)::int as n from admin.command_names`;
    expect(n?.n).toBe(0);
  });

  it("ADM-BR-10 · spec M2 §4 · feature_commands: PK (feature, command) 23505; xoá feature HOẶC command → CASCADE xoá hàng", async () => {
    await base();
    await command(C1);
    await command(C2, { name: "tr-nhanh" });
    await feature(F1, "ke-toan");
    await feature(F2, "dich-thuat");
    await sql`insert into admin.feature_commands (feature_id, command_id) values (${F1}, ${C1}), (${F1}, ${C2}), (${F2}, ${C1})`;
    expect(
      await code(
        sql`insert into admin.feature_commands (feature_id, command_id) values (${F1}, ${C1})`,
      ),
    ).toBe("23505");
    await sql`delete from admin.features where id = ${F1}`;
    const left = await sql`select feature_id, command_id from admin.feature_commands`;
    expect(left).toHaveLength(1);
    await sql`delete from admin.commands where id = ${C1}`;
    const [n] = await sql`select count(*)::int as n from admin.feature_commands`;
    expect(n?.n).toBe(0);
  });

  it("ADM-FR-31 · spec M2 §4 · feature_entitlements: PK 23505; CASCADE theo feature và tenant; revoked_at mặc định null, granted_at ≈ now", async () => {
    await clean();
    await feature(F1, "ke-toan");
    await tenant(T1, "acme");
    await tenant(T2, "globex");
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${F1}, ${T1}), (${F1}, ${T2})`;
    expect(
      await code(
        sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${F1}, ${T1})`,
      ),
    ).toBe("23505");
    const [row] =
      await sql`select revoked_at, granted_at, now() - granted_at < interval '1 minute' as fresh
      from admin.feature_entitlements where tenant_id = ${T1}`;
    expect(row?.revoked_at).toBeNull();
    expect(row?.fresh).toBe(true);
    await sql`delete from admin.tenants where id = ${T2}`;
    expect((await sql`select 1 from admin.feature_entitlements`).length).toBe(1);
    await sql`delete from admin.features where id = ${F1}`;
    expect((await sql`select 1 from admin.feature_entitlements`).length).toBe(0);
  });

  it("ADM-FR-31 · spec M2 §4 · granted_by và updated_by (secrets/workflows/commands/features) FK ON DELETE SET NULL: xoá user không xoá hàng", async () => {
    await clean();
    await tenant(T1, "acme");
    await sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
      values (${U1}, ${T1}, 'an', 'h', 'An', 'member')`;
    await secret(S1, "DIFY_KEY");
    await sql`update admin.secrets set updated_by = ${U1}`;
    await feature(F1, "ke-toan");
    await sql`update admin.features set updated_by = ${U1}`;
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by) values (${F1}, ${T1}, ${U1})`;
    await sql`delete from admin.users where id = ${U1}`;
    const [s] = await sql`select updated_by from admin.secrets`;
    const [f] = await sql`select updated_by from admin.features`;
    const [e] = await sql`select granted_by from admin.feature_entitlements`;
    expect(s?.updated_by).toBeNull();
    expect(f?.updated_by).toBeNull();
    expect(e?.granted_by).toBeNull();
    const [wcol] = await sql`select count(*)::int as n from information_schema.columns
      where table_schema = 'admin' and column_name = 'updated_by'
        and table_name in ('secrets', 'workflows', 'commands', 'features')`;
    expect(wcol?.n).toBe(4);
  });
});

describe("ADM-NFR-06 · bất biến M1 và hub-stub", () => {
  it("ADM-NFR-06 · spec M2 §4 · hub.agent_workflows có agent_id, workflow_id + chỉ mục agent_workflows_workflow_id_idx; admin_rw SELECT được", async () => {
    const cols = await sql<{ c: string }[]>`select column_name as c from information_schema.columns
      where table_schema = 'hub' and table_name = 'agent_workflows'`;
    expect(cols.map((x) => x.c)).toEqual(expect.arrayContaining(["agent_id", "workflow_id"]));
    const [idx] = await sql`select count(*)::int as n from pg_indexes
      where schemaname = 'hub' and indexname = 'agent_workflows_workflow_id_idx'`;
    expect(idx?.n).toBe(1);
    const [p] =
      await sql`select has_table_privilege('admin_rw', 'hub.agent_workflows', 'SELECT') as sel,
      has_table_privilege('admin_rw', 'hub.agent_workflows', 'INSERT') as ins`;
    expect(p).toEqual({ sel: true, ins: false });
  });

  it("ADM-NFR-06 · spec M2 §4 · features giữ cột M1 (+ updated_by); tenants/users/refresh_tokens không đổi tên cột chính", async () => {
    const cols = async (t: string) =>
      (
        await sql<{ c: string }[]>`select column_name as c from information_schema.columns
          where table_schema = 'admin' and table_name = ${t}`
      ).map((x) => x.c);
    expect(await cols("features")).toEqual(
      expect.arrayContaining([
        "id",
        "key",
        "name",
        "description",
        "icon",
        "status",
        "version",
        "updated_by",
      ]),
    );
    expect(await cols("users")).toEqual(
      expect.arrayContaining(["tenant_id", "username", "role", "version"]),
    );
    expect(await cols("tenants")).toEqual(
      expect.arrayContaining(["key", "name", "active", "version"]),
    );
    expect(await cols("refresh_tokens")).toEqual(
      expect.arrayContaining(["token_hash", "family_id"]),
    );
  });
});

describe("ADM-NFR-06 · migration production M2", () => {
  it("ADM-NFR-06 · spec M2 §4 · production: {main:9, dev:0}; 19 bảng admin.* (M4), 0 bảng hub.*", async () => {
    await resetTestDb(URL);
    const r = await runMigrations({ url: URL, appEnv: "production" });
    expect(r).toEqual({ main: 9, dev: 0 });
    expect(await names(["admin", "hub"])).toEqual(ADMIN19);
  });
});
