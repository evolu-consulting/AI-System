// M1D-FR-01 · docs/specs/M1d-fixes (security review CR-095 sửa, N-1 + N-4): khoá bên (đối tác) chỉ mở từ HĐ được NGƯỜI KHÁC
// duyệt; HĐ tự duyệt (người duyệt = người tạo) chỉ thấy đối tác qua chính HĐ đó. Nhắc hạn HĐ theo HĐ thấy được.
// Tenant A (chế độ org): boss (owner gói) · u2 quản lý u3 · u5 editor ngang hàng. HĐ u3 (Khach Mot, MST 0101) do boss duyệt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  contracts,
  enablePack,
  managers,
  members,
  tenants,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, inPackAs, inPackAsRollback, openOwner, type Sql } from "@ai/test-kit/db";

let sql: Sql;
let A = "";
let boss = "";
let u2 = "";
let u3 = "";
let u5 = "";
let hdU3 = "";

const party = (name: string, tax: string) => ({
  buyer_name: { value: name },
  buyer_tax_id: { value: tax },
});
const n = (user: string, table: string): Promise<number> =>
  inPackAs("contracts", A, user, async (tx) => {
    const r = (await tx.unsafe(`select count(*)::int as n from contracts.${table}`)) as unknown as {
      n: number;
    }[];
    return r[0]?.n ?? -1;
  });
/** u5 tự tạo HĐ `active` mang MST 0101 với người duyệt `by` (rollback) ⇒ số khách / sự kiện 0101 u5 thấy. */
const forged = (by: string | null) =>
  inPackAsRollback("contracts", A, u5, async (tx) => {
    await tx`insert into contracts.contracts (tenant_id, title, status, created_by, owner_user_id, confirmed_by,
          confirmed_at, fields)
        values (${A}, 'Tu duyet', 'active', ${u5}, ${u5}, ${by}, now(), ${tx.json(party("X", "0101"))})`;
    const c = await tx<{ n: number }[]>`select count(*)::int as n from contracts.cks_customers`;
    const e = await tx<{ n: number }[]>`select count(*)::int as n from contracts.partner_events
        where party_key = 'tax:0101'`;
    return { customers: c[0]?.n, events: e[0]?.n };
  });

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A] = (await tenants(sql, 1, 1401)) as [string];
  [boss, u2, u3, u5] = (await users(sql, A, 4, { from: 1401 })) as [string, string, string, string];
  const roles = await enablePack(sql, [A], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [boss]);
  await members(sql, A, roles.get(A)?.editor as string, [u2, u3, u5]);
  await managers(sql, A, [[u3, u2]]);
  [hdU3] = (await contracts(sql, A, 1, { from: 1401, createdBy: u3, owner: u3 })) as [string];
  await sql`update contracts.contracts set fields = ${sql.json(party("Khach Mot", "0101"))},
    confirmed_by = ${boss}, confirmed_at = now() where id = ${hdU3}`;
  await sql`insert into contracts.cks_customers (tenant_id, name, tax_id) values (${A}, 'Khach Mot', '0101')`;
  await sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user)
    values (${A}, 'tax:0101', 'customer', 'paid', '2026-10-01', null)`;
  await sql`insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
    values (${A}, ${hdU3}, '2026-12-01', 30, ${u3}, 'email')`;
  await visibility(sql, [A], "org");
}, 60_000);

afterAll(async () => {
  await sql?.end({ timeout: 2 });
});

describe("M1D-FR-01 · N-1 HĐ tự duyệt không mở đối tác", () => {
  it("u5 tự tạo + tự duyệt HĐ active mang MST 0101 (người duyệt = người tạo) ⇒ 0 khách, 0 sự kiện 0101", async () => {
    expect(await forged(u5)).toEqual({ customers: 0, events: 0 });
  });
  it("đối chứng: HĐ u3 do boss duyệt ⇒ u2 (quản lý u3) thấy khách và sự kiện 0101; u5 không", async () => {
    expect({
      u2: [await n(u2, "cks_customers"), await n(u2, "partner_events")],
      u5: [await n(u5, "cks_customers"), await n(u5, "partner_events")],
    }).toEqual({ u2: [1, 1], u5: [0, 0] });
  });
});

describe("M1D-FR-01 · N-4 nhắc hạn theo HĐ thấy được", () => {
  it("nhắc hạn của HĐ u3: u2, u3, boss thấy; u5 không", async () => {
    expect([u2, u3, boss, u5].length).toBe(4);
    expect({
      u2: await n(u2, "contract_reminders"),
      u3: await n(u3, "contract_reminders"),
      boss: await n(boss, "contract_reminders"),
      u5: await n(u5, "contract_reminders"),
    }).toEqual({ u2: 1, u3: 1, boss: 1, u5: 0 });
  });
});
