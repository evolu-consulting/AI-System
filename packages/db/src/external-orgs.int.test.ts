// CR-102a · ADM-FR-74 · com-c1-ext-identity: migration 0028 — CHECK/FK/trigger của user ngoài + RLS `admin.external_orgs`.
// Viết TRƯỚC migration (làn đầy đủ, Luật 1b): đỏ tới khi 0028 có.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { resetTestDb } from "./test-db";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-0000000ce${String(n).padStart(3, "0")}`;
const ACME = id(1);
const GLOBEX = id(2);
const ORG_ACME = id(11);
const ORG_GLOBEX = id(12);
const U_INT = id(21);
const U_EXT = id(22);
const G_ACME = id(31);

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const api = postgres(API, { max: 1, onnotice: () => {} });
type Tx = postgres.TransactionSql;
class Rollback extends Error {}

/** Chạy trong transaction rồi rollback; trả `{ok}` hoặc `{code, constraint}` của lỗi Postgres. */
async function run<T>(
  sql: postgres.Sql,
  setup: { scope?: string; tenant?: string; role?: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<{ ok: T } | { code: string; constraint?: string }> {
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
    if (!(e instanceof Rollback)) {
      const pg = e as { code?: string; constraint_name?: string };
      return { code: pg.code ?? String(e), constraint: pg.constraint_name };
    }
  }
  return { ok: out as T };
}
const own = <T>(fn: (tx: Tx) => Promise<T>) => run(owner, {}, fn);
const extUser = (
  tx: Tx,
  o: { uid: string; t: string; org: string | null; role?: string; kind?: string },
) =>
  tx`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id)
    values (${o.uid}, ${o.t}, ${`u${o.uid.slice(-3)}`}, 'x', 'X', ${o.role ?? "member"}, ${o.kind ?? "external"}, ${o.org})`;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${ACME}, 'acme', 'Acme'), (${GLOBEX}, 'globex', 'Globex')`;
  await owner`insert into admin.external_orgs (id, tenant_id, name) values
    (${ORG_ACME}, ${ACME}, 'NCC Một'), (${ORG_GLOBEX}, ${GLOBEX}, 'NCC Globex')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${U_INT}, ${ACME}, 'an', 'x', 'An', 'member')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id)
    values (${U_EXT}, ${ACME}, 'ncc1', 'x', 'NCC 1', 'member', 'external', ${ORG_ACME})`;
  await owner`insert into admin.groups (id, tenant_id, key, name) values (${G_ACME}, ${ACME}, 'ke-toan', '{"vi":"Kế toán"}')`;
});
afterAll(async () => {
  await owner.end();
  await api.end();
});

describe("CR-102a · admin.users.kind / external_org_id", () => {
  test("hàng cũ mặc định internal, không org", async () => {
    const [r] = await owner`select kind, external_org_id from admin.users where id = ${U_INT}`;
    expect(r).toEqual({ kind: "internal", external_org_id: null });
  });

  test("kind ngoài tập → 23514 users_kind_check", async () => {
    expect(
      await own((tx) => extUser(tx, { uid: id(40), t: ACME, org: null, kind: "guest" })),
    ).toMatchObject({
      code: "23514",
      constraint: "users_kind_check",
    });
  });

  test("external thiếu org / internal có org → 23514 users_kind_org_check", async () => {
    const a = await own((tx) => extUser(tx, { uid: id(41), t: ACME, org: null }));
    const b = await own((tx) =>
      extUser(tx, { uid: id(42), t: ACME, org: ORG_ACME, kind: "internal" }),
    );
    expect(a).toMatchObject({ code: "23514", constraint: "users_kind_org_check" });
    expect(b).toMatchObject({ code: "23514", constraint: "users_kind_org_check" });
  });

  test("external phải là member (không tenant_admin) → 23514 users_external_member_check", async () => {
    const r = await own((tx) =>
      extUser(tx, { uid: id(43), t: ACME, org: ORG_ACME, role: "tenant_admin" }),
    );
    expect(r).toMatchObject({ code: "23514", constraint: "users_external_member_check" });
    const up = await own(
      (tx) => tx`update admin.users set role = 'tenant_admin', email = 'x@y.z' where id = ${U_EXT}`,
    );
    expect(up).toMatchObject({ code: "23514", constraint: "users_external_member_check" });
  });

  test("org của tenant khác (FK kép) → 23503", async () => {
    const r = await own((tx) => extUser(tx, { uid: id(44), t: ACME, org: ORG_GLOBEX }));
    expect(r).toMatchObject({ code: "23503", constraint: "users_external_org_fk" });
  });

  test("kind / external_org_id bất biến sau khi tạo → 23514 users_kind_fixed_ck", async () => {
    const a = await own(
      (tx) =>
        tx`update admin.users set kind = 'external', external_org_id = ${ORG_ACME} where id = ${U_INT}`,
    );
    const b = await own(
      (tx) =>
        tx`update admin.users set kind = 'internal', external_org_id = null where id = ${U_EXT}`,
    );
    expect(a).toMatchObject({ code: "23514", constraint: "users_kind_fixed_ck" });
    expect(b).toMatchObject({ code: "23514", constraint: "users_kind_fixed_ck" });
  });

  test("vô hiệu ⇒ active=false (users_deactivated_check)", async () => {
    const r = await own(
      (tx) => tx`update admin.users set deactivated_at = now() where id = ${U_EXT}`,
    );
    expect(r).toMatchObject({ code: "23514", constraint: "users_deactivated_check" });
    expect(
      await own(
        (tx) =>
          tx`update admin.users set deactivated_at = now(), active = false where id = ${U_EXT}`,
      ),
    ).toHaveProperty("ok");
  });

  test("user ngoài không vào được group (trigger) → 23514 group_members_internal_ck; user nội bộ vào được", async () => {
    const ext = await own(
      (tx) =>
        tx`insert into admin.group_members (tenant_id, group_id, user_id) values (${ACME}, ${G_ACME}, ${U_EXT})`,
    );
    expect(ext).toMatchObject({ code: "23514", constraint: "group_members_internal_ck" });
    const int = await own(
      (tx) =>
        tx`insert into admin.group_members (tenant_id, group_id, user_id) values (${ACME}, ${G_ACME}, ${U_INT})`,
    );
    expect(int).toHaveProperty("ok");
  });
});

describe("CR-102a · admin.external_orgs", () => {
  test("tên 1..200 và trùng (không phân biệt hoa thường) trong tenant → lỗi; tenant khác trùng tên được", async () => {
    expect(
      await own((tx) => tx`insert into admin.external_orgs (tenant_id, name) values (${ACME}, '')`),
    ).toMatchObject({
      code: "23514",
      constraint: "external_orgs_name_check",
    });
    expect(
      await own(
        (tx) =>
          tx`insert into admin.external_orgs (tenant_id, name) values (${ACME}, ${"x".repeat(201)})`,
      ),
    ).toMatchObject({ code: "23514" });
    expect(
      await own(
        (tx) => tx`insert into admin.external_orgs (tenant_id, name) values (${ACME}, 'ncc một')`,
      ),
    ).toMatchObject({
      code: "23505",
      constraint: "external_orgs_tenant_name_uq",
    });
    expect(
      await own(
        (tx) => tx`insert into admin.external_orgs (tenant_id, name) values (${GLOBEX}, 'NCC Một')`,
      ),
    ).toHaveProperty("ok");
  });

  test("RLS: admin_api scope tenant acme không đọc/sửa được org của globex; platform thấy cả hai; scope thiếu → 0", async () => {
    const acme = await run(
      api,
      { scope: "tenant", tenant: ACME },
      (tx) => tx`select id from admin.external_orgs order by id`,
    );
    expect(acme).toEqual({ ok: [{ id: ORG_ACME }] as never });
    const upd = await run(
      api,
      { scope: "tenant", tenant: ACME },
      (tx) =>
        tx`update admin.external_orgs set name = 'hack' where id = ${ORG_GLOBEX} returning id`,
    );
    expect(upd).toEqual({ ok: [] as never });
    const ins = await run(
      api,
      { scope: "tenant", tenant: ACME },
      (tx) => tx`insert into admin.external_orgs (tenant_id, name) values (${GLOBEX}, 'chen')`,
    );
    expect(ins).toMatchObject({ code: "42501" });
    const plat = await run(
      api,
      { scope: "platform" },
      (tx) => tx`select count(*)::int as n from admin.external_orgs`,
    );
    expect(plat).toEqual({ ok: [{ n: 2 }] as never });
    const none = await run(api, {}, (tx) => tx`select count(*)::int as n from admin.external_orgs`);
    expect(none).toEqual({ ok: [{ n: 0 }] as never });
  });

  test("hub_ro đọc được kind/external_org_id/deactivated_at của users và external_orgs (Hub lọc tenant tường minh)", async () => {
    const r = await run(
      owner,
      { role: "hub_ro" },
      (tx) =>
        tx`select u.kind, u.external_org_id, u.deactivated_at, o.name from admin.users u
        join admin.external_orgs o on o.tenant_id = u.tenant_id and o.id = u.external_org_id where u.id = ${U_EXT}`,
    );
    expect(r).toEqual({
      ok: [
        { kind: "external", external_org_id: ORG_ACME, deactivated_at: null, name: "NCC Một" },
      ] as never,
    });
  });

  test("không xoá cứng org còn user (FK restrict)", async () => {
    expect(
      await own((tx) => tx`delete from admin.external_orgs where id = ${ORG_ACME}`),
    ).toMatchObject({ code: "23503" });
  });
});
