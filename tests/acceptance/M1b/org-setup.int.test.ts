// M1D-FR-02 · M1D-FR-04 · docs/specs/M1b-visibility: (1) tenant MỚI tạo qua admin-api bắt đầu ở chế độ thấy `org`;
// (2) công cụ chuyển user mgmt-app (N5) nhập `manager_email` vào `admin.user_managers` theo lô, chặn vòng, không đè, chạy lại
// idempotent. Hạ tầng N5 (DB sạch + fixture H1 + pool `admin_api` NOBYPASSRLS). Dữ liệu export GIẢ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runIdentityImport } from "../../../apps/admin-api/src/modules/identity-import/identity-import.run";
import { createTenant } from "../../../apps/admin-api/src/modules/tenants/tenants.service";
import { type CtxN5, mkExport, startN5, tenantOfOrg, userX } from "../N5/_support/n5";

let c: CtxN5;
beforeAll(async () => {
  c = await startN5();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** Chế độ hiệu lực + `sees_all()` của một user thường trong tenant (owner DB đặt biến như `withPackScope`). */
async function modeOf(tenantId: string, userId: string) {
  return c.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId}, true)`;
    const [r] = await tx<
      { mode: string; all: boolean }[]
    >`select contracts.visibility_mode() as mode,
      contracts.sees_all() as all`;
    return r;
  });
}

describe("M1D-FR-04 · tenant mới mặc định `org`", () => {
  it("POST /admin/tenants (createTenant) ⇒ settings.visibility = org ⇒ gói contracts ở chế độ org, user thường không thấy cả tenant", async () => {
    const r = await createTenant(
      { ctx: { db: c.db }, scope: { kind: "platform" }, actor: { userId: c.padmin } },
      {
        key: "m1b-new",
        name: "M1b New",
        max_concurrent_sub: null,
        timezone: "Asia/Ho_Chi_Minh",
        first_admin: {
          username: "boss",
          display_name: "Boss",
          email: "boss@m1b-new.test",
          locale: "vi",
        },
      },
    );
    const [s] = await c.sql<{ v: string }[]>`select settings->>'visibility' as v from admin.tenants
      where id = ${r.tenant.id}`;
    expect({ setting: s?.v, eff: await modeOf(r.tenant.id, r.first_admin.id) }).toEqual({
      setting: "org",
      eff: { mode: "org", all: false },
    });
  });
});

const mgr = (email: string, org: string, manager: string | null, role = "editor") => ({
  ...userX(email, org, role),
  manager_email: manager,
});
const RAW = mkExport(
  [{ id: "m1b-org", name: "Quan Ly Co", tenant_key: "m1b-ql" }],
  [
    mgr("a@ql.test", "m1b-org", null, "owner"),
    mgr("b@ql.test", "m1b-org", "A@QL.test"),
    mgr("c@ql.test", "m1b-org", "b@ql.test"),
    mgr("e@ql.test", "m1b-org", "f@ql.test"),
    mgr("f@ql.test", "m1b-org", "e@ql.test"),
    mgr("g@ql.test", "m1b-org", "nobody@ql.test"),
    mgr("h@ql.test", "m1b-org", "h@ql.test"),
  ],
);
const run = (apply: boolean) =>
  runIdentityImport(c.db, RAW, { actorId: c.padmin, apply, batch: 2 });
const edges = async (tid: string) =>
  (
    await c.sql<{ e: string }[]>`select lower(u.email) || '>' || lower(m.email) as e
      from admin.user_managers x join admin.users u on u.id = x.user_id join admin.users m on m.id = x.manager_id
      where x.tenant_id = ${tid} order by 1`
  ).map((r) => r.e);
const mgrIssues = (r: { issues: { kind: string; ref: string; code: string }[] }) =>
  r.issues.filter((i) => i.kind === "manager").map((i) => `${i.ref}:${i.code}`);

describe("M1D-FR-02 · N5 nhập manager_email", () => {
  it("dry-run: báo số SẼ đặt + lỗi vòng/không rõ, không ghi user_managers", async () => {
    const r = await run(false);
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.user_managers`;
    expect({ m: r.managers, issues: mgrIssues(r), rows: n?.n }).toEqual({
      m: { read: 6, set: 3, existing: 0, errors: 3 },
      issues: ["f@ql.test:MANAGER_CYCLE", "g@ql.test:MANAGER_UNKNOWN", "h@ql.test:MANAGER_CYCLE"],
      rows: 0,
    });
  });
  it("apply: đặt b>a, c>b, e>f (cạnh sau của vòng e↔f bị từ chối); closure đúng (a quản lý c ở tầng 2); audit mỗi user", async () => {
    const r = await run(true);
    const tid = (await tenantOfOrg(c.sql, "m1b-org"))[0]?.id as string;
    const [cl] = await c.sql<{ n: number; deep: number }[]>`select count(*)::int as n,
        count(*) filter (where depth = 2)::int as deep from admin.user_reports where tenant_id = ${tid}`;
    const [au] = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.audit_log
      where tenant_id = ${tid} and summary->>'manager_id' is not null`;
    expect({
      m: r.managers,
      edges: await edges(tid),
      closure: cl,
      audit: au?.n,
    }).toEqual({
      m: { read: 6, set: 3, existing: 0, errors: 3 },
      edges: ["b@ql.test>a@ql.test", "c@ql.test>b@ql.test", "e@ql.test>f@ql.test"],
      closure: { n: 4, deep: 1 },
      audit: 3,
    });
  });
  it("chạy lại: 0 đặt mới, 3 đã có (không đè quản lý đặt tay), không thêm hàng", async () => {
    const tid = (await tenantOfOrg(c.sql, "m1b-org"))[0]?.id as string;
    await c.sql`update admin.user_managers set manager_id = (select id from admin.users
      where tenant_id = ${tid} and lower(email) = 'a@ql.test') where user_id = (select id from admin.users
      where tenant_id = ${tid} and lower(email) = 'c@ql.test')`;
    const r = await run(true);
    expect({ m: r.managers, edges: await edges(tid) }).toEqual({
      m: { read: 6, set: 0, existing: 3, errors: 3 },
      edges: ["b@ql.test>a@ql.test", "c@ql.test>a@ql.test", "e@ql.test>f@ql.test"],
    });
  });
});
