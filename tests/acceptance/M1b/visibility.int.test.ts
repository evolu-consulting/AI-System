// M1D-FR-01 · M1D-FR-04 · docs/specs/M1b-visibility: phần còn lại của luật thấy mgmt-app ở chế độ `org`, dưới RLS thật
// (`hub_api` → `contracts_rw` + `app.tenant_id`/`app.user_id`). Cây của tenant A: boss (owner gói) · u2 quản lý u3 · u5 ngang hàng.
//   (1) phụ lục chưa giao theo HĐ cha (`visibility_owner_id` do trigger giữ; đổi người phụ trách HĐ cha ⇒ lan xuống);
//   (2) khách CKS + sổ đối tác lọc theo người (khoá bên của HĐ mình thấy / do mình tạo-ghi);
//   (3) chế độ mặc định theo `admin.tenants.settings.visibility` khi tenant chưa có hàng cài đặt.
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
let B = "";
let boss = "";
let u2 = "";
let u3 = "";
let u5 = "";
let b1 = "";
let b2 = "";
const C: Record<string, string> = {};

const party = (name: string, tax: string) => ({
  buyer_name: { value: name },
  buyer_tax_id: { value: tax },
});
const titles = (tenant: string, user: string, table: string, col: string): Promise<string[]> =>
  inPackAs("contracts", tenant, user, async (tx) =>
    (
      (await tx.unsafe(
        `select ${col}::text as x from contracts.${table} order by 1`,
      )) as unknown as {
        x: string;
      }[]
    ).map((r) => r.x),
  );
const seen = (tenant: string, user: string) => titles(tenant, user, "contracts", "title");

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 1101)) as [string, string];
  [boss, u2, u3, u5] = (await users(sql, A, 4, { from: 1101 })) as [string, string, string, string];
  [b1, b2] = (await users(sql, B, 2, { from: 1201 })) as [string, string];
  const roles = await enablePack(sql, [A, B], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [boss]);
  await members(sql, A, roles.get(A)?.editor as string, [u2, u3, u5]);
  await members(sql, B, roles.get(B)?.editor as string, [b1, b2]);
  await managers(sql, A, [[u3, u2]]);
  let i = 1101;
  for (const [name, owner, by, p] of [
    ["u3", u3, u3, party("Khach Mot", "0101")],
    ["u5", u5, u5, party("Khach Hai", "0202")],
    ["b1", b1, b1, {}],
    ["b2", b2, b2, {}],
  ] as const) {
    const [c] = await contracts(sql, name.startsWith("b") ? B : A, 1, {
      from: i++,
      createdBy: by,
      owner,
    });
    C[name] = c as string;
    await sql`update contracts.contracts set title = ${`HD ${name}`}, fields = ${sql.json(p)}
      where id = ${c as string}`;
  }
  // Phụ lục chưa giao của HĐ u3, do boss tải (owner gói — u2/u5 không phải người tạo).
  const [ap] = await sql<{ id: string }[]>`insert into contracts.contracts
      (tenant_id, kind, parent_id, title, status, created_by)
    values (${A}, 'appendix', ${C.u3 as string}, 'PL u3', 'active', ${boss}) returning id`;
  C.pl = ap?.id as string;
  await sql`insert into contracts.cks_customers (tenant_id, name, tax_id)
    values (${A}, 'Khach Mot', '0101'), (${A}, 'Khach Hai', '0202')`;
  await sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user)
    values (${A}, 'tax:0101', 'customer', 'paid', '2026-10-01', null),
           (${A}, 'tax:0202', 'customer', 'paid', '2026-10-01', null),
           (${A}, 'tax:0101', 'customer', 'reminded', '2026-10-02', ${u5})`;
  await visibility(sql, [A], "org");
}, 60_000);

afterAll(async () => {
  await sql?.end({ timeout: 2 });
});

describe("M1D-FR-01 · phụ lục chưa giao theo HĐ cha (orgs.sees)", () => {
  it("trigger ghi visibility_owner_id = người phụ trách HĐ cha; quản lý của u3 và u3 thấy phụ lục, ngang hàng u5 không", async () => {
    const [r] = await sql<
      { v: string }[]
    >`select visibility_owner_id::text as v from contracts.contracts
      where id = ${C.pl as string}`;
    expect({
      col: r?.v === u3,
      u2: await seen(A, u2),
      u3: await seen(A, u3),
      u5: await seen(A, u5),
    }).toEqual({ col: true, u2: ["HD u3", "PL u3"], u3: ["HD u3", "PL u3"], u5: ["HD u5"] });
  });
  it("đổi người phụ trách HĐ cha sang u5 (qua RLS của boss) ⇒ phụ lục lan theo: u5 thấy, u2/u3 mất; trả lại", async () => {
    const move = (to: string) =>
      inPackAs(
        "contracts",
        A,
        boss,
        (tx) =>
          tx`update contracts.contracts set owner_user_id = ${to} where id = ${C.u3 as string}`,
      );
    await move(u5);
    const after = { u2: await seen(A, u2), u5: await seen(A, u5) };
    await move(u3);
    expect(after).toEqual({ u2: [], u5: ["HD u3", "HD u5", "PL u3"] });
    expect(await seen(A, u2)).toEqual(["HD u3", "PL u3"]);
  });
  it("không lộ/không giả: u5 tạo phụ lục dưới HĐ u3 (không thấy) ⇒ cột null; tự đặt cột = u3 ⇒ trigger tính lại null", async () => {
    const r = await inPackAsRollback("contracts", A, u5, async (tx) => {
      const [x] = await tx<{ id: string; v: string | null }[]>`insert into contracts.contracts
            (tenant_id, kind, parent_id, title, status, created_by, visibility_owner_id)
          values (${A}, 'appendix', ${C.u3 as string}, 'PL u5', 'active', ${u5}, ${u3})
          returning id, visibility_owner_id::text as v`;
      const [y] = await tx<{ v: string | null }[]>`update contracts.contracts
          set visibility_owner_id = ${u3} where id = ${x?.id as string} returning visibility_owner_id::text as v`;
      return { insert: x?.v ?? null, update: y?.v ?? null };
    });
    expect(r).toEqual({ insert: null, update: null });
  });
});

describe("M1D-FR-01 · đối tác theo người (access.View.company)", () => {
  it("khách CKS: u2 thấy khách của HĐ cấp dưới u3, không thấy khách của u5; u5 ngược lại; owner thấy hết", async () => {
    const t = (u: string) => titles(A, u, "cks_customers", "name");
    expect({ u2: await t(u2), u5: await t(u5), boss: await t(boss) }).toEqual({
      u2: ["Khach Mot"],
      u5: ["Khach Hai"],
      boss: ["Khach Hai", "Khach Mot"],
    });
  });
  it("khách do mình tạo luôn thấy (INSERT … RETURNING qua RLS, created_by mặc định = app.user_id)", async () => {
    const got = await inPackAsRollback(
      "contracts",
      A,
      u5,
      async (tx) =>
        (
          await tx<{ name: string }[]>`insert into contracts.cks_customers (tenant_id, name)
          values (${A}, 'Khach Moi') returning name`
        )[0]?.name,
    );
    expect(got).toBe("Khach Moi");
  });
  it("sổ đối tác: theo khoá bên của HĐ mình thấy, cộng sự kiện do mình ghi", async () => {
    const t = (u: string) => titles(A, u, "partner_events", "party_key || ':' || type");
    expect({ u2: await t(u2), u5: await t(u5), boss: (await t(boss)).length }).toEqual({
      u2: ["tax:0101:paid", "tax:0101:reminded"],
      u5: ["tax:0101:reminded", "tax:0202:paid"],
      boss: 3,
    });
  });
  it("chế độ tenant giữ hành vi cũ: u5 thấy cả 2 khách, 3 sự kiện, phụ lục", async () => {
    await visibility(sql, [A], "tenant");
    const r = {
      cust: (await titles(A, u5, "cks_customers", "name")).length,
      ev: (await titles(A, u5, "partner_events", "id")).length,
      hd: (await seen(A, u5)).length,
    };
    await visibility(sql, [A], "org");
    expect(r).toEqual({ cust: 2, ev: 3, hd: 3 });
  });
});

describe("M1D-FR-04 · chế độ mặc định theo tenant", () => {
  it("không có hàng cài đặt: settings {} ⇒ tenant (fixture/seed); settings.visibility=org ⇒ org; hàng cài đặt thắng", async () => {
    const mode = () =>
      inPackAs("contracts", B, b1, async (tx) => ({
        mode: (await tx<{ m: string }[]>`select contracts.visibility_mode() as m`)[0]?.m,
        seen: (await tx<{ title: string }[]>`select title from contracts.contracts order by 1`).map(
          (x) => x.title,
        ),
      }));
    const plain = await mode();
    await sql`update admin.tenants set settings = settings || '{"visibility":"org"}' where id = ${B}`;
    const orgDefault = await mode();
    await visibility(sql, [B], "tenant");
    const row = await mode();
    expect({ plain, orgDefault, row }).toEqual({
      plain: { mode: "tenant", seen: ["HD b1", "HD b2"] },
      orgDefault: { mode: "org", seen: ["HD b1"] },
      row: { mode: "tenant", seen: ["HD b1", "HD b2"] },
    });
  });
});
