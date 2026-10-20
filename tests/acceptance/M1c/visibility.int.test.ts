// M1D-FR-01 · docs/specs/M1c-fixes (review CR-095 đợt A): lỗ luật thấy chế độ `org` dưới RLS thật (`hub_api` → `contracts_rw`).
// Tenant A: boss (owner gói) · u2 quản lý u3 · u5 ngang hàng (editor). HĐ u3 đã duyệt với khách "Khach Mot" (MST 0101).
//   A-2 khoá bên giả: u5 tạo HĐ NHÁP mang MST 0101 (tự phụ trách) ⇒ vẫn không thấy khách / sổ đối tác của 0101.
//   A-1 văn bản đã ký, hẹn gọi CKS, huỷ sự kiện theo khách/sự kiện thấy được. A-9 chỉ owner gói ghi chế độ thấy.
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
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

let sql: Sql;
let A = "";
let boss = "";
let u2 = "";
let u3 = "";
let u5 = "";
let hdU3 = "";

const n = (user: string, table: string): Promise<number> =>
  inPackAs("contracts", A, user, async (tx) => {
    const r = (await tx.unsafe(`select count(*)::int as n from contracts.${table}`)) as unknown as {
      n: number;
    }[];
    return r[0]?.n ?? -1;
  });
const party = (name: string, tax: string) => ({
  buyer_name: { value: name },
  buyer_tax_id: { value: tax },
});

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A] = (await tenants(sql, 1, 1301)) as [string];
  [boss, u2, u3, u5] = (await users(sql, A, 4, { from: 1301 })) as [string, string, string, string];
  const roles = await enablePack(sql, [A], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [boss]);
  await members(sql, A, roles.get(A)?.editor as string, [u2, u3, u5]);
  await managers(sql, A, [[u3, u2]]);
  [hdU3] = (await contracts(sql, A, 1, { from: 1301, createdBy: u3, owner: u3 })) as [string];
  await sql`update contracts.contracts set fields = ${sql.json(party("Khach Mot", "0101"))} where id = ${hdU3}`;
  const [cu] = await sql<
    { id: string }[]
  >`insert into contracts.cks_customers (tenant_id, name, tax_id)
    values (${A}, 'Khach Mot', '0101') returning id`;
  const cid = cu?.id as string;
  const [ev] = await sql<{ id: string }[]>`insert into contracts.partner_events
      (tenant_id, party_key, role, type, at, by_user)
    values (${A}, 'tax:0101', 'customer', 'paid', '2026-10-01', null) returning id::text`;
  await sql`insert into contracts.partner_event_voids (event_id, tenant_id, by_user)
    values (${ev?.id as string}::bigint, ${A}, ${boss})`;
  await sql`insert into contracts.cks_signed_docs (tenant_id, customer_id, kind, title, source, filename, sha256,
      created_by)
    values (${A}, ${cid}, 'invoice', 'HĐ đỏ', 'xml', 'a.xml', ${"a".repeat(64)}, ${boss})`;
  await sql`insert into contracts.cks_followups (tenant_id, user_id, customer_id, due_at)
    values (${A}, ${boss}, ${cid}, now())`;
  await visibility(sql, [A], "org");
}, 60_000);

afterAll(async () => {
  await sql?.end({ timeout: 2 });
});

describe("M1D-FR-01 · A-2 khoá bên chỉ từ HĐ đã duyệt", () => {
  it("u5 tạo HĐ nháp (tự phụ trách) mang MST 0101 ⇒ vẫn 0 khách, 0 sự kiện sổ đối tác của 0101; u2 (quản lý u3) thấy", async () => {
    const abuse = await inPackAs(
      "contracts",
      A,
      u5,
      async (tx) => {
        await tx`insert into contracts.contracts (tenant_id, title, status, created_by, owner_user_id, fields)
          values (${A}, 'Nhap gia', 'needs_review', ${u5}, ${u5}, ${tx.json(party("X", "0101"))})`;
        const c = await tx<{ n: number }[]>`select count(*)::int as n from contracts.cks_customers`;
        const e = await tx<
          { n: number }[]
        >`select count(*)::int as n from contracts.partner_events`;
        return { customers: c[0]?.n, events: e[0]?.n };
      },
      { rollback: true },
    );
    expect({
      abuse,
      u2: { customers: await n(u2, "cks_customers"), events: await n(u2, "partner_events") },
    }).toEqual({ abuse: { customers: 0, events: 0 }, u2: { customers: 1, events: 1 } });
  });
});

describe("M1D-FR-01 · A-1 bảng con CKS / sổ đối tác theo khách thấy được", () => {
  it("văn bản đã ký, hẹn gọi, huỷ sự kiện của khách u3: u2 thấy, u5 không; owner thấy hết", async () => {
    const t = ["cks_signed_docs", "cks_followups", "partner_event_voids"];
    const of = async (u: string) => Promise.all(t.map((x) => n(u, x)));
    expect({ u2: await of(u2), u5: await of(u5), boss: await of(boss) }).toEqual({
      u2: [1, 1, 1],
      u5: [0, 0, 0],
      boss: [1, 1, 1],
    });
  });
});

describe("M1D-FR-04 · A-9 chế độ thấy chỉ owner gói ghi", () => {
  it("editor u5 chèn/đổi visibility_settings ⇒ 42501 / 0 hàng; owner boss đổi được", async () => {
    const as = (u: string, q: string) =>
      inPackAs("contracts", A, u, async (tx) => (await tx.unsafe(q)).count, { rollback: true });
    const upd = `update contracts.visibility_settings set mode = 'tenant' where tenant_id = '${A}'`;
    expect({
      editorUpd: await as(u5, upd).catch((e: { code?: string }) => e.code),
      ownerUpd: await as(boss, upd),
      editorIns: await pgCode(() =>
        inPackAs(
          "contracts",
          A,
          u5,
          (
            tx,
          ) => tx`insert into contracts.visibility_settings (tenant_id, mode) values (${A}, 'tenant')
            on conflict (tenant_id) do update set mode = excluded.mode`,
          { rollback: true },
        ),
      ),
    }).toEqual({ editorUpd: 0, ownerUpd: 1, editorIns: "42501" });
  });
});
