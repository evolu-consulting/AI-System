// ADM-FR-40, ADM-FR-41, ADM-FR-51, ADM-NFR-07 · RLS/quyền/append-only 3 bảng M4 + `insertAuditRows` (plan M4 §3.4, §4.1,
// §8). qc có D1–D9 riêng (tests/acceptance/M4/db-*.int.test.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { type AuditInput, insertAuditRows } from "./audit-log";
import { createDb } from "./client";
import { runMigrations } from "./migrate";
import { type Tx as DTx, sqlState, withScope } from "./scope";
import { resetTestDb } from "./test-db";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const ACME = "01900000-0000-7000-8000-00000000e001";
const GLOBEX = "01900000-0000-7000-8000-00000000e002";
const U_ACME = "01900000-0000-7000-8000-00000000e011";
const FEATURE = "01900000-0000-7000-8000-00000000e031";

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const api = postgres(API, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 1 });
type Tx = postgres.TransactionSql;
type Setup = { scope?: string; tenant?: string; role?: string };
class Rollback extends Error {}

async function run<T>(
  sql: postgres.Sql,
  setup: Setup,
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
const code = (r: { ok: unknown } | { code: string }) => ("code" in r ? r.code : null);
const tenantsOf = (tx: Tx, table: string) =>
  tx.unsafe(`select distinct tenant_id from admin.${table} order by tenant_id nulls last`);

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${ACME}, 'acme', 'Acme'), (${GLOBEX}, 'globex', 'Globex')`;
  await owner`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role)
    values (${U_ACME}, ${ACME}, 'an', 'an@acme.test', 'x', 'An', 'tenant_admin')`;
  await owner`insert into admin.features (id, key, name) values (${FEATURE}, 'ke-toan', '{"vi":"Kế toán"}')`;
  await owner`insert into admin.tenant_quotas (tenant_id, feature_id, max_runs) values
    (${ACME}, null, 10), (${GLOBEX}, ${FEATURE}, 20)`;
  await owner`insert into admin.quota_alerts (tenant_id, level, month, pct) values
    (${ACME}, 80, '2026-10-01', 80), (${GLOBEX}, 100, '2026-10-01', 100)`;
  await owner`insert into admin.audit_log (tenant_id, action, entity, entity_name) values
    (${ACME}, 'update', 'group', 'a'), (${GLOBEX}, 'update', 'group', 'g'), (null, 'create', 'tenant', 's')`;
});
afterAll(async () => {
  await owner.end();
  await api.end();
  await db.close();
});

describe("ADM-NFR-07 · RLS bảng M4 (plan M4 §3.4)", () => {
  test.each(["tenant_quotas", "quota_alerts", "audit_log"])(
    "%s: tenant chỉ thấy hàng mình; platform thấy hết (audit NULL chỉ platform)",
    async (t) => {
      const a = await run(api, acme, (tx) => tenantsOf(tx, t));
      expect("ok" in a && a.ok.map((r) => r.tenant_id)).toEqual([ACME]);
      const p = await run(api, platform, (tx) => tenantsOf(tx, t));
      const all = t === "audit_log" ? [ACME, GLOBEX, null] : [ACME, GLOBEX];
      expect("ok" in p && p.ok.map((r) => r.tenant_id)).toEqual(all);
    },
  );

  test("không có scope → không thấy hàng nào", async () => {
    const r = await run(api, {}, (tx) => tenantsOf(tx, "audit_log"));
    expect("ok" in r && r.ok.length).toBe(0);
  });

  test("audit_log: admin_rw UPDATE/DELETE/TRUNCATE → 42501; owner → trigger P0001", async () => {
    for (const s of [
      "update admin.audit_log set entity_name = 'x'",
      "delete from admin.audit_log",
      "truncate admin.audit_log",
    ]) {
      expect([s, code(await run(api, platform, (tx) => tx.unsafe(s)))]).toEqual([s, "42501"]);
      expect([s, code(await run(owner, {}, (tx) => tx.unsafe(s)))]).toEqual([s, "P0001"]);
    }
  });

  test("hub_ro: đọc tenant_quotas mọi tenant; quota_alerts/audit_log → 42501", async () => {
    const q = await run(owner, hub, (tx) => tenantsOf(tx, "tenant_quotas"));
    expect("ok" in q && q.ok.length).toBe(2);
    expect(code(await run(owner, hub, (tx) => tenantsOf(tx, "quota_alerts")))).toBe("42501");
    expect(code(await run(owner, hub, (tx) => tenantsOf(tx, "audit_log")))).toBe("42501");
  });
});

const row = (o: Partial<AuditInput> = {}): AuditInput => ({
  action: "update",
  entity: "group",
  entityId: null,
  entityName: "ke-toan",
  tenantId: ACME,
  before: null,
  after: null,
  ...o,
});
const asAcme = (fn: (tx: DTx) => Promise<void>) =>
  withScope(db, { kind: "tenant", tenantId: ACME }, fn);

describe("ADM-FR-51 · insertAuditRows (plan M4 §4.1)", () => {
  test("một câu nhiều hàng: actor_username snapshot, config_version, mặc định summary/snapshot, thứ tự seq", async () => {
    const [m] = await owner`select coalesce(max(seq), 0)::bigint as m from admin.audit_log`;
    const rows1 = [
      row({
        entityId: FEATURE,
        before: { name: "a" },
        after: { name: "b" },
        entityVersion: 2,
        snapshot: true,
      }),
      row({ action: "grant", entity: "grant", summary: { subject_type: "group" } }),
    ];
    await asAcme((tx) => insertAuditRows(tx, rows1, { actorId: U_ACME, v: 7 }));
    const rows =
      await owner`select actor_username, action, config_version, entity_version, before, summary,
        snapshot from admin.audit_log where seq > ${m?.m ?? 0} order by seq`;
    expect(rows.map((r) => [r.action, r.actor_username, r.config_version, r.snapshot])).toEqual([
      ["update", "an", 7, true],
      ["grant", "an", 7, false],
    ]);
    expect([rows[0]?.before, rows[0]?.summary]).toEqual([{ name: "a" }, {}]);
    expect([rows[1]?.entity_version, rows[1]?.summary]).toEqual([null, { subject_type: "group" }]);
  });

  test("scope tenant ghi hàng tenant khác → 42501; rows rỗng → không làm gì", async () => {
    const other = asAcme((tx) =>
      insertAuditRows(tx, [row({ tenantId: GLOBEX })], { actorId: null, v: null }),
    );
    expect(await other.then(() => null, sqlState)).toBe("42501");
    await asAcme((tx) => insertAuditRows(tx, [], { actorId: null, v: null }));
  });
});
