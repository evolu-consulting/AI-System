// ADM-FR-50, ADM-FR-31, ADM-NFR-07 · RLS + quyền cột + REVOKE của catalog M2 (plan M2 §3.4). qc có M2-AC01/02 riêng.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { resetTestDb } from "./test-db";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const ACME = "01900000-0000-7000-8000-00000000c001";
const GLOBEX = "01900000-0000-7000-8000-00000000c002";
const SECRET = "01900000-0000-7000-8000-00000000c011";
const WORKFLOW = "01900000-0000-7000-8000-00000000c021";
const FEATURE = "01900000-0000-7000-8000-00000000c031";
const FEATURE2 = "01900000-0000-7000-8000-00000000c032";
const NEW_ID = "01900000-0000-7000-8000-00000000c0ff";

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const api = postgres(API, { max: 1, onnotice: () => {} });
type Tx = postgres.TransactionSql;
class Rollback extends Error {}

/** Chạy trong transaction có scope (hoặc role) rồi rollback; trả kết quả hoặc SQLSTATE lỗi. */
async function run<T>(
  sql: postgres.Sql,
  setup: { scope?: string; tenant?: string; role?: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<{ ok: T } | { code: string }> {
  let out: T | undefined;
  try {
    await sql.begin(async (tx) => {
      if (setup.role) await tx.unsafe(`set local role ${setup.role}`);
      if (setup.scope)
        await tx`select set_config('app.scope', ${setup.scope}, true), set_config('app.tenant_id', ${setup.tenant ?? ""}, true)`;
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) return { code: (e as { code?: string }).code ?? "unknown" };
  }
  return { ok: out as T };
}
const platform = { scope: "platform" };
const acme = { scope: "tenant", tenant: ACME };
const hub = { role: "hub_ro" };
const insertSecret = (tx: Tx) =>
  tx`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${NEW_ID}, 'NEW_KEY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${ACME}, 'acme', 'Acme'), (${GLOBEX}, 'globex', 'Globex')`;
  await owner`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${SECRET}, 'DIFY_KEY', ${Buffer.alloc(40, 7)}, ${Buffer.alloc(12, 1)}, 'wxyz')`;
  await owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
    values (${WORKFLOW}, 'translate', 'Dịch', ${"d".repeat(20)}, 'workflow', 'https://x.test/v1', ${SECRET})`;
  await owner`insert into admin.features (id, key, name) values
    (${FEATURE}, 'docs', '{"vi":"Tài liệu"}'::jsonb), (${FEATURE2}, 'extra', '{"vi":"Thêm"}'::jsonb)`;
  await owner`insert into admin.feature_entitlements (feature_id, tenant_id) values (${FEATURE}, ${ACME}), (${FEATURE}, ${GLOBEX})`;
});
afterAll(async () => {
  await api.end();
  await owner.end();
});

describe("ADM-NFR-07 · RLS admin.secrets", () => {
  test("ADM-NFR-07 · scope tenant: 0 hàng, insert → 42501", async () => {
    expect(
      await run(api, acme, async (tx) => (await tx`select id from admin.secrets`).length),
    ).toEqual({ ok: 0 });
    expect(await run(api, acme, insertSecret)).toEqual({ code: "42501" });
  });

  test("ADM-NFR-07 · scope platform: thấy, insert/update/delete được", async () => {
    const r = await run(api, platform, async (tx) => {
      const seen = (await tx`select id, name from admin.secrets`).length;
      await insertSecret(tx);
      const upd = await tx`update admin.secrets set note = 'n' where id = ${NEW_ID} returning id`;
      const del = await tx`delete from admin.secrets where id = ${NEW_ID} returning id`;
      return [seen, upd.length, del.length];
    });
    expect(r).toEqual({ ok: [1, 1, 1] });
  });

  test("ADM-FR-50 · admin_rw không SELECT ciphertext/iv; đọc được cột không mật", async () => {
    expect(await run(api, platform, (tx) => tx`select ciphertext from admin.secrets`)).toEqual({
      code: "42501",
    });
    expect(await run(api, platform, (tx) => tx`select iv from admin.secrets`)).toEqual({
      code: "42501",
    });
    const ok = await run(
      api,
      platform,
      async (tx) =>
        (
          await tx`select id, name, last4, note, key_version, created_at, updated_at, updated_by from admin.secrets`
        ).length,
    );
    expect(ok).toEqual({ ok: 1 });
  });
});

describe("ADM-NFR-07 · quyền hub_ro", () => {
  test("ADM-FR-50 · hub_ro không đọc secrets; đọc được bảng catalog khác", async () => {
    expect(await run(owner, hub, (tx) => tx`select name from admin.secrets`)).toEqual({
      code: "42501",
    });
    for (const t of ["workflows", "commands", "command_names", "feature_commands", "features"]) {
      const r = await run(owner, hub, (tx) => tx.unsafe(`select * from admin.${t}`));
      expect("ok" in r).toBe(true);
    }
    const ent = await run(
      owner,
      hub,
      async (tx) => (await tx`select tenant_id from admin.feature_entitlements`).length,
    );
    expect(ent).toEqual({ ok: 2 });
  });

  test("ADM-NFR-07 · has_table_privilege / has_column_privilege", async () => {
    const [p] = await owner`select
      has_table_privilege('hub_ro', 'admin.secrets', 'SELECT') as hub,
      has_column_privilege('admin_rw', 'admin.secrets', 'ciphertext', 'SELECT') as ct,
      has_column_privilege('admin_rw', 'admin.secrets', 'iv', 'SELECT') as iv`;
    expect(p).toEqual({ hub: false, ct: false, iv: false });
  });
});

describe("ADM-FR-31 · RLS admin.feature_entitlements", () => {
  test("ADM-FR-31 · scope tenant acme chỉ thấy hàng acme; insert tenant khác → 42501", async () => {
    const rows = await run(api, acme, (tx) => tx`select tenant_id from admin.feature_entitlements`);
    expect("ok" in rows && rows.ok.map((r) => r.tenant_id)).toEqual([ACME]);
    const ins = await run(
      api,
      acme,
      (tx) =>
        tx`insert into admin.feature_entitlements (feature_id, tenant_id) values (${FEATURE2}, ${GLOBEX})`,
    );
    expect(ins).toEqual({ code: "42501" });
  });

  test("ADM-NFR-07 · relrowsecurity đúng 13 bảng (M3 thêm groups, group_members, feature_grants; M4 thêm audit_log, quota_alerts, tenant_quotas, user_backup_codes, user_totp), không FORCE", async () => {
    const rows =
      await owner`select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'admin' and c.relkind = 'r' order by c.relname`;
    expect(rows.filter((r) => r.rls).map((r) => r.relname)).toEqual([
      "audit_log",
      "feature_entitlements",
      "feature_grants",
      "group_members",
      "groups",
      "quota_alerts",
      "refresh_tokens",
      "secrets",
      "tenant_quotas",
      "tenants",
      "user_backup_codes",
      "user_totp",
      "users",
    ]);
    expect(rows.some((r) => r.force)).toBe(false);
  });
});
