// ADM-NFR-07, ADM-BR-09, ADM-FR-40, ADM-FR-41, ADM-FR-51 · RLS + quyền 3 bảng mới M4 (test-plan D5–D9; M4-AC06, M4-AC17).
// Truy vấn trực tiếp bằng admin_api (scope platform/tenant) / hub_ro / owner, không qua app; mọi ghi trong tx rollback.
// Xanh ở T0.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { ADMIN_API_URL, auditMark, createM4Env, ID, type M4Env, TENANT_ID } from "./_ab";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
class Rollback extends Error {}
let env: M4Env;
let api: Sql;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const TABLES = ["tenant_quotas", "quota_alerts", "audit_log"] as const;

beforeAll(async () => {
  env = await createM4Env();
  await env.reset4();
  api = postgres(ADMIN_API_URL, { max: 2, onnotice: () => {} });
  const o = env.owner;
  await o`insert into admin.tenant_quotas (tenant_id, feature_id, max_runs) values (${A}, null, 10), (${G}, null, 20)`;
  await o`insert into admin.quota_alerts (tenant_id, level, month, pct) values
    (${A}, 80, '2026-10-01', 80), (${G}, 80, '2026-10-01', 85)`;
  const mark = await auditMark(o);
  for (const t of [A, G, null])
    await o`insert into admin.audit_log (tenant_id, action, entity, entity_name, summary)
      values (${t}, 'update', 'group', ${`rls-${mark}`}, ${o.json({})})`;
});
afterAll(async () => {
  await api?.end({ timeout: 1 });
  await env.close();
});

async function run<T>(
  sql: Sql,
  scope: string | null,
  tid: string | null,
  fn: (tx: Tx) => Promise<T>,
  role?: string,
): Promise<{ out?: T; code: string | null }> {
  let out: T | undefined;
  try {
    await sql.begin(async (tx) => {
      if (role) await tx.unsafe(`set local role ${role}`);
      if (scope !== null)
        await tx`select set_config('app.scope', ${scope}, true), set_config('app.tenant_id', ${tid ?? ""}, true)`;
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) return { code: (e as { code?: string }).code ?? String(e) };
  }
  return { out, code: null };
}
const asTenant = <T>(fn: (tx: Tx) => Promise<T>) => run(api, "tenant", A, fn);
const asPlatform = <T>(fn: (tx: Tx) => Promise<T>) => run(api, "platform", null, fn);
const asHub = <T>(fn: (tx: Tx) => Promise<T>) => run(env.owner, null, null, fn, "hub_ro");
const tenantsIn = (tx: Tx, t: string) =>
  tx.unsafe(`select distinct tenant_id from admin.${t}`) as unknown as Promise<
    { tenant_id: string | null }[]
  >;

describe("ADM-BR-09 · M4-AC17 · RLS đọc", () => {
  it("ADM-BR-09 · M4-AC17 · D5 · scope acme SELECT 3 bảng chỉ thấy hàng acme; platform thấy acme, globex và audit NULL", async () => {
    for (const t of TABLES) {
      const r = await asTenant((tx) => tenantsIn(tx, t));
      expect([t, r.code, (r.out ?? []).map((x) => x.tenant_id)]).toEqual([t, null, [A]]);
    }
    const p = await asPlatform((tx) => tenantsIn(tx, "audit_log"));
    const ids = (p.out ?? []).map((x) => x.tenant_id);
    expect(ids).toContain(null);
    expect(ids).toContain(G);
    const q = await asPlatform((tx) => tenantsIn(tx, "tenant_quotas"));
    expect((q.out ?? []).length).toBe(2);
  });
});

describe("ADM-BR-09 · M4-AC17 · RLS ghi", () => {
  it("ADM-BR-09 · M4-AC17 · D6 · scope acme INSERT quota globex / audit globex / audit NULL → 42501; UPDATE quota globex → 0 hàng; INSERT acme → ok", async () => {
    const ins = (t: string | null) => (tx: Tx) =>
      tx`insert into admin.audit_log (tenant_id, action, entity, entity_name) values (${t}, 'update', 'group', 'd6')`;
    expect(
      (
        await asTenant(
          (tx) =>
            tx`insert into admin.tenant_quotas (tenant_id, feature_id, max_runs) values (${G}, ${ID.feature.keToan}, 1)`,
        )
      ).code,
    ).toBe("42501");
    expect((await asTenant(ins(G))).code).toBe("42501");
    expect((await asTenant(ins(null))).code).toBe("42501");
    expect((await asTenant(ins(A))).code).toBeNull();
    const u = await asTenant(
      (tx) => tx`update admin.tenant_quotas set max_runs = 99 where tenant_id = ${G} returning id`,
    );
    expect(u.out?.length).toBe(0);
  });

  it("ADM-FR-51 · M4-R11 · M4-AC06 · D7 · admin_api (cả platform) UPDATE/DELETE/TRUNCATE audit_log → 42501; owner → trigger P0001; hàng còn nguyên", async () => {
    const stmts = [
      "update admin.audit_log set entity_name = 'x'",
      "delete from admin.audit_log",
      "truncate admin.audit_log",
    ];
    for (const s of stmts) {
      expect([s, (await asPlatform((tx) => tx.unsafe(s))).code]).toEqual([s, "42501"]);
      expect([s, (await asTenant((tx) => tx.unsafe(s))).code]).toEqual([s, "42501"]);
      expect([s, (await run(env.owner, null, null, (tx) => tx.unsafe(s))).code]).toEqual([
        s,
        "P0001",
      ]);
    }
    const [n] = await env.owner`select count(*)::int as n from admin.audit_log`;
    expect(n?.n).toBeGreaterThanOrEqual(3);
  });
});

describe("ADM-NFR-07 · M4-AC17 · hub_ro", () => {
  it("ADM-NFR-07 · M4-AC17 · D8 · hub_ro SELECT tenant_quotas thấy mọi tenant; SELECT quota_alerts/audit_log → 42501; INSERT bất kỳ → 42501", async () => {
    const q = await asHub((tx) => tenantsIn(tx, "tenant_quotas"));
    expect(q.code).toBeNull();
    expect((q.out ?? []).length).toBe(2);
    expect((await asHub((tx) => tenantsIn(tx, "quota_alerts"))).code).toBe("42501");
    expect((await asHub((tx) => tenantsIn(tx, "audit_log"))).code).toBe("42501");
    expect(
      (
        await asHub(
          (tx) => tx`insert into admin.tenant_quotas (tenant_id, max_runs) values (${G}, 1)`,
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await asHub(
          (tx) =>
            tx`insert into admin.audit_log (action, entity, entity_name) values ('update', 'group', 'h')`,
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await asHub(
          (tx) =>
            tx`insert into admin.quota_alerts (tenant_id, level, month, pct) values (${G}, 100, '2026-10-01', 100)`,
        )
      ).code,
    ).toBe("42501");
  });

  it("ADM-NFR-06 · D9 · pg_policies: tenant_quotas/quota_alerts *_admin_rw (ALL, admin_rw, có WITH CHECK); tenant_quotas_hub_ro (SELECT); audit_log_select (SELECT) + audit_log_insert (INSERT)", async () => {
    const rows = await env.owner<
      {
        tablename: string;
        policyname: string;
        roles: string;
        cmd: string;
        with_check: string | null;
      }[]
    >`select tablename, policyname, roles::text as roles, cmd, with_check from pg_policies
      where schemaname = 'admin' and tablename in ('tenant_quotas', 'quota_alerts', 'audit_log')
      order by (tablename || '.' || policyname) collate "C"`;
    const by = (n: string) => rows.find((r) => r.policyname === n);
    for (const t of ["tenant_quotas", "quota_alerts"]) {
      expect([t, by(`${t}_admin_rw`)?.cmd]).toEqual([t, "ALL"]);
      expect(by(`${t}_admin_rw`)?.roles).toContain("admin_rw");
      expect(by(`${t}_admin_rw`)?.with_check).toBeTruthy();
    }
    expect(by("tenant_quotas_hub_ro")?.cmd).toBe("SELECT");
    expect(by("tenant_quotas_hub_ro")?.roles).toContain("hub_ro");
    expect(by("audit_log_select")?.cmd).toBe("SELECT");
    expect(by("audit_log_insert")?.cmd).toBe("INSERT");
    expect(by("audit_log_insert")?.with_check).toBeTruthy();
    expect(
      rows
        .filter((r) => r.tablename === "audit_log")
        .map((r) => r.cmd)
        .sort(),
    ).toEqual(["INSERT", "SELECT"]);
    expect(
      rows.filter((r) => r.tablename === "quota_alerts").some((r) => r.roles.includes("hub_ro")),
    ).toBe(false);
  });
});
