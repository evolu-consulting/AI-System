// CR-130 pha 2 · L1 · ADR-0043 · contracts 0103: `contracts.partner_profiles` (RLS) + hàm đọc `contracts.community_partners(uuid[])`.
// Viết TRƯỚC migration (làn đầy đủ): (1) tenant A không đọc/ghi hồ sơ của B, (2) hàm dưới tenant A không trả hàng B dù truyền
// `ext_org_id` của B, (3) đối tác (user ngoài) chỉ thấy hàng công ty mình, (4) ghi: người dùng thường bị chặn, quản trị gói/việc nền được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, tenants, userId, users } from "./builders";
import { asRole, cloneDb, openOwner, pgCode, type Sql } from "./db";

const A = tenantId(931);
const B = tenantId(932);
const U_ADMIN = userId(931); // tenant_admin của A
const U_MEMBER = userId(932); // thành viên thường của A
const U_EXT = userId(933); // user ngoài của công ty ORG_A1
const ORG_A1 = "0193a000-0000-7000-8000-000000000a01";
const ORG_A2 = "0193a000-0000-7000-8000-000000000a02";
const ORG_B1 = "0193a000-0000-7000-8000-000000000b01";
const NIL = "00000000-0000-0000-0000-000000000000";

let owner: Sql;
type Row = {
  ext_org_id: string;
  party_key: string;
  name: string;
  roles: string[];
  cats: string[];
  area: string;
};

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  await tenants(owner, 2, 931);
  await users(owner, A, 2, { from: 931 });
  await owner`update admin.users set role = 'tenant_admin' where id = ${U_ADMIN}`;
  await owner.unsafe(`
    insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from) values
      ('${A}', 'tax:111', 'supplier', 'Công ty Một', 'manual'),
      ('${A}', 'tax:111', 'customer', 'Công ty Một', 'manual'),
      ('${A}', 'tax:111', 'commission_payer', 'Công ty Một', 'manual'),
      ('${B}', 'tax:999', 'supplier', 'Công ty B', 'manual');
    insert into contracts.partner_profiles (tenant_id, party_key, cats, area, ext_org_id) values
      ('${A}', 'tax:111', array['gao','ca-phe'], 'Miền Nam', '${ORG_A1}'),
      ('${A}', 'name:khong-vai', '{}', '', '${ORG_A2}'),
      ('${A}', 'tax:222', '{}', '', null),
      ('${B}', 'tax:999', array['sat'], 'HN', '${ORG_B1}')`);
});
afterAll(async () => {
  await owner.end({ timeout: 2 });
});

/** Gọi hàm dưới role `contracts_rw` + tenant (+ danh tính người xem đặt như `withPackScope`). */
const call = (t: string | null, orgs: string[], who: { user?: string; ext?: string } = {}) =>
  asRole(
    "contracts_rw",
    t,
    async (tx) => {
      if (who.user !== undefined)
        await tx.unsafe(
          "select set_config('app.user_id', $1, true), set_config('app.ext_org_id', $2, true)",
          [who.user, who.ext ?? "internal"],
        );
      return (await tx.unsafe(
        "select * from contracts.community_partners($1::uuid[]) order by party_key",
        [orgs],
      )) as unknown as Row[];
    },
    { rollback: true },
  );

describe("contracts.partner_profiles · RLS", () => {
  it("tenant A không đọc hồ sơ của B (và ngược lại); thiếu GUC tenant ⇒ 0 hàng", async () => {
    const count = (t: string | null) =>
      asRole(
        "contracts_rw",
        t,
        async (tx) =>
          (await tx.unsafe("select count(*)::int as n from contracts.partner_profiles"))[0]
            ?.n as number,
        { rollback: true },
      );
    expect([await count(A), await count(B), await count(null)]).toEqual([3, 1, 0]);
  });
  it("tenant A không ghi được hàng mang tenant B (42501) và không sửa/xoá hàng của B (0 hàng)", async () => {
    expect(
      await pgCode(() =>
        asRole(
          "contracts_rw",
          A,
          (tx) =>
            tx.unsafe(
              "insert into contracts.partner_profiles (tenant_id, party_key) values ($1, 'tax:x')",
              [B],
            ),
          { rollback: true },
        ),
      ),
    ).toBe("42501");
    const n = await asRole(
      "contracts_rw",
      A,
      async (tx) => {
        const u = await tx.unsafe(
          "update contracts.partner_profiles set area = 'x' where party_key = 'tax:999'",
        );
        const d = await tx.unsafe(
          "delete from contracts.partner_profiles where party_key = 'tax:999'",
        );
        return [u.count, d.count];
      },
      { rollback: true },
    );
    expect(n).toEqual([0, 0]);
  });
  it("UNIQUE (tenant_id, ext_org_id): một tài khoản chỉ gắn một đối tác; ext_org_id NULL nhiều hàng được", async () => {
    expect(
      await pgCode(() =>
        owner.unsafe(
          "insert into contracts.partner_profiles (tenant_id, party_key, ext_org_id) values ($1, 'tax:dup', $2)",
          [A, ORG_A1],
        ),
      ),
    ).toBe("23505");
    expect(
      await pgCode(() =>
        owner.unsafe(
          "insert into contracts.partner_profiles (tenant_id, party_key, cats) values ($1, 'tax:c', $2)",
          [A, Array.from({ length: 51 }, (_, i) => `c${i}`)],
        ),
      ),
    ).toBe("23514");
  });
  it("ghi: thành viên thường 42501/0 hàng; quản trị gói (tenant_admin) và việc nền ghi được; đối tác không ghi", async () => {
    const as = (user: string, ext: string, sql: string) =>
      asRole(
        "contracts_rw",
        A,
        async (tx) => {
          await tx.unsafe(
            "select set_config('app.user_id', $1, true), set_config('app.ext_org_id', $2, true)",
            [user, ext],
          );
          return tx.unsafe(sql);
        },
        { rollback: true },
      );
    const ins =
      "insert into contracts.partner_profiles (tenant_id, party_key) values (current_setting('app.tenant_id')::uuid, 'tax:new')";
    expect(await pgCode(() => as(U_MEMBER, "internal", ins))).toBe("42501");
    expect(await pgCode(() => as(U_EXT, ORG_A1, ins))).toBe("42501");
    expect(await pgCode(() => as(U_ADMIN, "internal", ins))).toBeNull();
    expect(await pgCode(() => as("", "", ins))).toBeNull(); // việc nền
    const upd = "update contracts.partner_profiles set area = 'x' where party_key = 'tax:111'";
    expect((await as(U_MEMBER, "internal", upd)).count).toBe(0);
    expect((await as(U_EXT, ORG_A1, upd)).count).toBe(0);
    expect((await as(U_ADMIN, "internal", upd)).count).toBe(1);
  });
});

describe("contracts.community_partners(uuid[])", () => {
  it("đúng tenant: trả hồ sơ + tên SHT + vai (bỏ commission_payer) + nhóm hàng; hàng chưa có vai ⇒ roles rỗng, name = party_key", async () => {
    const rows = await call(A, [ORG_A1, ORG_A2]);
    expect(rows).toEqual([
      {
        ext_org_id: ORG_A2,
        party_key: "name:khong-vai",
        name: "name:khong-vai",
        roles: [],
        cats: [],
        area: "",
      },
      {
        ext_org_id: ORG_A1,
        party_key: "tax:111",
        name: "Công ty Một",
        roles: ["customer", "supplier"],
        cats: ["gao", "ca-phe"],
        area: "Miền Nam",
      },
    ]);
  });
  it("cách ly tenant: tenant A truyền ext_org_id của B ⇒ 0 hàng (tenant lấy từ GUC, không từ tham số); thiếu GUC ⇒ 0 hàng", async () => {
    expect(await call(A, [ORG_B1])).toEqual([]);
    expect((await call(B, [ORG_B1])).map((r) => r.party_key)).toEqual(["tax:999"]);
    expect(await call(null, [ORG_A1, ORG_B1])).toEqual([]);
    expect(await call("", [ORG_A1, ORG_B1])).toEqual([]); // GUC rỗng
  });
  it("chỉ hàng có ext_org_id trong mảng; mảng rỗng/NULL ⇒ 0 hàng; hàng chưa gắn tài khoản không bao giờ trả", async () => {
    expect((await call(A, [ORG_A2])).map((r) => r.party_key)).toEqual(["name:khong-vai"]);
    expect(await call(A, [])).toEqual([]);
    expect(await call(A, [NIL])).toEqual([]);
  });
  it("đối tác chỉ thấy hàng của chính mình dù truyền cả công ty khác; user ngoài bị từ chối (nil) ⇒ 0 hàng", async () => {
    expect(
      (await call(A, [ORG_A1, ORG_A2], { user: U_EXT, ext: ORG_A1 })).map((r) => r.ext_org_id),
    ).toEqual([ORG_A1]);
    expect(await call(A, [ORG_A2], { user: U_EXT, ext: ORG_A1 })).toEqual([]);
    expect(await call(A, [ORG_A1, ORG_A2], { user: U_EXT, ext: "denied" })).toEqual([]);
  });
  it("CHỦ Ý (ADR-0043): user nội bộ thường (không admin gói) thấy MỌI hồ sơ đã gắn tài khoản trong tenant mình, không thấy tenant khác", async () => {
    const rows = await call(A, [ORG_A1, ORG_A2, ORG_B1], { user: U_MEMBER, ext: "internal" });
    expect(rows.map((r) => r.ext_org_id).sort()).toEqual([ORG_A1, ORG_A2].sort());
  });
  it("role community_rw (nếu đã được cấp EXECUTE như community 0011) gọi được; chủ quản thấy mọi hàng được hỏi", async () => {
    await owner.unsafe("grant usage on schema contracts to community_rw");
    await owner.unsafe(
      "grant execute on function contracts.community_partners(uuid[]) to community_rw",
    );
    const rows = await asRole(
      "community_rw",
      A,
      async (tx) =>
        (await tx.unsafe("select ext_org_id from contracts.community_partners($1::uuid[])", [
          [ORG_A1, ORG_A2],
        ])) as unknown as Row[],
      { rollback: true },
    );
    expect(rows.length).toBe(2);
    // community_rw không có quyền bảng contracts.*
    expect(
      await pgCode(() =>
        asRole("community_rw", A, (tx) => tx.unsafe("select 1 from contracts.partner_profiles"), {
          rollback: true,
        }),
      ),
    ).toBe("42501");
  });
  it("hàm là SECURITY DEFINER, STABLE, chỉ EXECUTE cho role gói (không PUBLIC); một câu lọc qua index UNIQUE (tenant_id, ext_org_id)", async () => {
    const [f] = await owner`select p.prosecdef as def, p.provolatile as vol,
      has_function_privilege('public', p.oid, 'execute') as pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'contracts' and p.proname = 'community_partners'`;
    expect(f).toEqual({ def: true, vol: "s", pub: false });
    const plan = await owner.begin(async (tx) => {
      await tx.unsafe("set local enable_seqscan = off");
      return tx.unsafe(
        `explain (costs off) select * from contracts.partner_profiles where tenant_id = '${A}' and ext_org_id = any(array['${ORG_A1}']::uuid[])`,
      );
    });
    expect(plan.map((r) => String(r["QUERY PLAN"])).join("\n")).toMatch(
      /partner_profiles_org_uq|partner_profiles_pkey/,
    );
  });
});
