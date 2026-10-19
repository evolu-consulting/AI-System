// TK1 · builder theo tập: dựng đúng, số câu SQL KHÔNG phụ thuộc n (Luật 4c), bật gói tương đương API (3 Group vai, 6 grant).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  contractId,
  contracts,
  enablePack,
  groups,
  members,
  tenantId,
  tenants,
  userId,
  users,
} from "./builders";
import { cloneDb, openOwner, type Sql } from "./db";
import { captureSql } from "./perf";

let sql: Sql;
beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
});
afterAll(async () => {
  await sql.end({ timeout: 2 });
});
const n = async (q: Promise<{ n: number }[]>): Promise<number> => (await q)[0]?.n ?? -1;

describe("builders theo tập", () => {
  it("tenants/users/contracts: đúng số hàng, id tất định", async () => {
    const ts = await tenants(sql, 3, 801);
    expect(ts).toEqual([tenantId(801), tenantId(802), tenantId(803)]);
    const us = await users(sql, ts[0] as string, 5, { from: 801 });
    expect(us[0]).toBe(userId(801));
    await contracts(sql, ts[0] as string, 7, { createdBy: us[0] as string, from: 801 });
    expect(
      await n(sql`select count(*)::int as n from admin.tenants where id = any(${ts}::uuid[])`),
    ).toBe(3);
    expect(
      await n(sql`select count(*)::int as n from admin.users where tenant_id = ${ts[0] as string}`),
    ).toBe(5);
    expect(
      await n(
        sql`select count(*)::int as n from contracts.contracts where id = ${contractId(807)}`,
      ),
    ).toBe(1);
  });

  it("số câu SQL cố định: 5 hàng và 500 hàng đều 1 câu", async () => {
    const [t] = await tenants(sql, 1, 810);
    const small = await captureSql(sql, () => users(sql, t as string, 5, { from: 1000 }));
    const big = await captureSql(sql, () => users(sql, t as string, 500, { from: 2000 }));
    expect([small.queries.length, big.queries.length]).toEqual([1, 1]);
  });

  it("groups + members: idempotent theo khoá, thêm thành viên theo tập", async () => {
    const [t] = await tenants(sql, 1, 820);
    const us = await users(sql, t as string, 3, { from: 3000 });
    const g1 = await groups(sql, t as string, ["alpha", "beta"]);
    const g2 = await groups(sql, t as string, ["alpha"]);
    expect(g2.get("alpha")).toBe(g1.get("alpha"));
    await members(sql, t as string, g1.get("alpha") as string, us);
    await members(sql, t as string, g1.get("alpha") as string, us);
    expect(
      await n(
        sql`select count(*)::int as n from admin.group_members where group_id = ${g1.get("alpha") as string}`,
      ),
    ).toBe(3);
  });

  it("enablePack: 3 entitlement, 3 Group vai, 6 grant mỗi tenant; chạy lại không nhân đôi; số câu không phụ thuộc số tenant", async () => {
    const ts = await tenants(sql, 4, 830);
    const cap = await captureSql(sql, () => enablePack(sql, ts, "pkdemo"));
    expect(cap.queries.length).toBe(3);
    const again = await enablePack(sql, ts, "pkdemo");
    expect([...again.keys()].sort()).toEqual([...ts].sort());
    for (const t of ts) {
      expect(
        await n(
          sql`select count(*)::int as n from admin.feature_entitlements where tenant_id = ${t} and revoked_at is null`,
        ),
      ).toBe(3);
      expect(
        await n(
          sql`select count(*)::int as n from admin.groups where tenant_id = ${t} and key like 'pkdemo-%'`,
        ),
      ).toBe(3);
      expect(
        await n(sql`select count(*)::int as n from admin.feature_grants where tenant_id = ${t}`),
      ).toBe(6);
    }
    const g = cap.r.get(ts[0] as string);
    expect(Object.keys(g ?? {}).sort()).toEqual(["editor", "owner", "viewer"]);
  });
});
