// ADM-FR-62, ADM-FR-32, ADM-FR-53, ADM-NFR-07 · RLS/FK kép/quyền của bảng quyền M3 (plan M3 §3.3). qc có M3-AC06 riêng.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { resetTestDb } from "./test-db";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const ACME = "01900000-0000-7000-8000-00000000d001";
const GLOBEX = "01900000-0000-7000-8000-00000000d002";
const U_ACME = "01900000-0000-7000-8000-00000000d011";
const U_GLOBEX = "01900000-0000-7000-8000-00000000d012";
const G_ACME = "01900000-0000-7000-8000-00000000d021";
const G_GLOBEX = "01900000-0000-7000-8000-00000000d022";
const FEATURE = "01900000-0000-7000-8000-00000000d031";
const NEW_T = "01900000-0000-7000-8000-00000000d0ff";

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const api = postgres(API, { max: 1, onnotice: () => {} });
type Tx = postgres.TransactionSql;
class Rollback extends Error {}

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
const user = (id: string, t: string, name: string) =>
  owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${id}, ${t}, ${name}, 'x', ${name}, 'member')`;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${ACME}, 'acme', 'Acme'), (${GLOBEX}, 'globex', 'Globex')`;
  await user(U_ACME, ACME, "an");
  await user(U_GLOBEX, GLOBEX, "binh");
  await owner`insert into admin.groups (id, tenant_id, key, name) values
    (${G_ACME}, ${ACME}, 'ke-toan', '{"vi":"Kế toán"}'), (${G_GLOBEX}, ${GLOBEX}, 'ke-toan', '{"vi":"Kế toán"}')`;
  await owner`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${ACME}, ${G_ACME}, ${U_ACME}), (${GLOBEX}, ${G_GLOBEX}, ${U_GLOBEX})`;
  await owner`insert into admin.features (id, key, name) values (${FEATURE}, 'ke-toan', '{"vi":"Kế toán"}')`;
  await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values
    (${ACME}, ${FEATURE}, ${G_ACME}), (${GLOBEX}, ${FEATURE}, ${G_GLOBEX})`;
});
afterAll(async () => {
  await owner.end();
  await api.end();
});

const tenantsOf = (tx: Tx, table: string) =>
  tx.unsafe(`select distinct tenant_id from admin.${table} order by tenant_id`);

describe("ADM-NFR-07 · RLS bảng quyền M3 (plan M3 §3.3)", () => {
  test.each(["groups", "group_members", "feature_grants"])(
    "%s: tenant chỉ thấy hàng mình; platform thấy hết",
    async (t) => {
      const a = await run(api, acme, (tx) => tenantsOf(tx, t));
      expect("ok" in a && a.ok.map((r) => r.tenant_id)).toEqual([ACME]);
      const p = await run(api, platform, (tx) => tenantsOf(tx, t));
      expect("ok" in p && p.ok.map((r) => r.tenant_id)).toEqual([ACME, GLOBEX]);
    },
  );

  test("tenant acme chèn group globex → 42501", async () => {
    const r = await run(
      api,
      acme,
      (tx) =>
        tx`insert into admin.groups (tenant_id, key, name) values (${GLOBEX}, 'x-y', '{"vi":"X"}')`,
    );
    expect(r).toEqual({ code: "42501" });
  });

  test("hub_ro đọc 4 bảng mới (cả hai tenant), mọi ghi bị từ chối, secrets vẫn cấm", async () => {
    for (const t of ["groups", "group_members", "feature_grants"]) {
      const r = await run(owner, hub, (tx) => tenantsOf(tx, t));
      expect("ok" in r && r.ok.length).toBe(2);
    }
    const cfg = await run(owner, hub, (tx) => tx`select config_version from admin.config_meta`);
    expect("ok" in cfg && cfg.ok.length).toBe(1);
    const w = await run(owner, hub, (tx) => tx`delete from admin.group_members`);
    expect(w).toEqual({ code: "42501" });
    const u = await run(owner, hub, (tx) => tx`update admin.config_meta set config_version = 9`);
    expect(u).toEqual({ code: "42501" });
    const s = await run(owner, hub, (tx) => tx`select name from admin.secrets`);
    expect(s).toEqual({ code: "42501" });
  });
});

describe("ADM-FR-62 · FK kép, CHECK, config_meta, trigger beta-testers", () => {
  test("thành viên/grant chéo tenant → 23503; subject null/cả hai → 23514", async () => {
    const m = await run(
      owner,
      {},
      (tx) =>
        tx`insert into admin.group_members (tenant_id, group_id, user_id) values (${ACME}, ${G_ACME}, ${U_GLOBEX})`,
    );
    expect(m).toEqual({ code: "23503" });
    const g = await run(
      owner,
      {},
      (tx) =>
        tx`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${ACME}, ${FEATURE}, ${G_GLOBEX})`,
    );
    expect(g).toEqual({ code: "23503" });
    const none = await run(
      owner,
      {},
      (tx) =>
        tx`insert into admin.feature_grants (tenant_id, feature_id) values (${ACME}, ${FEATURE})`,
    );
    expect(none).toEqual({ code: "23514" });
  });

  test("admin_api cập nhật config_meta được (cả scope tenant), xoá → 42501", async () => {
    const u = await run(
      api,
      acme,
      (tx) => tx`update admin.config_meta set config_version = config_version + 1 returning id`,
    );
    expect("ok" in u && u.ok.length).toBe(1);
    const d = await run(api, platform, (tx) => tx`delete from admin.config_meta`);
    expect(d).toEqual({ code: "42501" });
  });

  test("mỗi tenant đúng một beta-testers; tenant mới (admin_api, platform) có ngay trong cùng transaction", async () => {
    const [n] = await owner`select count(*)::int as n from admin.groups where key = 'beta-testers'`;
    expect(n?.n).toBe(2);
    const r = await run(api, platform, async (tx) => {
      await tx`insert into admin.tenants (id, key, name) values (${NEW_T}, 'initech', 'Initech')`;
      return tx`select key from admin.groups where tenant_id = ${NEW_T}`;
    });
    expect("ok" in r && r.ok.map((x) => x.key)).toEqual(["beta-testers"]);
  });
});
