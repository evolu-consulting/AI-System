// M1D-FR-01 · M1D-FR-02 · M1D-FR-03 · M1D-FR-04 · docs/specs/M1-departments: luật thấy của mgmt-app (orgs.Ctx.sees) bằng RLS,
// chạy qua `hub_api` + role `contracts_rw` + `app.tenant_id`/`app.user_id` như `withPackScope`. Cây quản lý của tenant A:
//   boss(owner gói) · u2 → u3 → u4 (u2 quản lý u3, u3 quản lý u4) · u5 ngang hàng · phòng "kd": trưởng u6, thành viên u7.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  contracts,
  department,
  enablePack,
  managers,
  members,
  tenants,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, inPackAs, inPackAsRollback, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

let sql: Sql;
let A = "";
let B = "";
let boss = "";
let u2 = "";
let u3 = "";
let u4 = "";
let u5 = "";
let u6 = "";
let u7 = "";
let b1 = "";
/** HĐ theo người phụ trách (1 HĐ mỗi người) + 2 HĐ chưa giao (u2 tải, u5 tải). */
const C: Record<string, string> = {};

const seen = (tenant: string, user: string): Promise<string[]> =>
  inPackAs("contracts", tenant, user, async (tx) =>
    (await tx<{ title: string }[]>`select title from contracts.contracts order by title`).map(
      (r) => r.title,
    ),
  );
const count = (tenant: string, user: string, table: string): Promise<number> =>
  inPackAs("contracts", tenant, user, async (tx) => {
    const r = (await tx.unsafe(`select count(*)::int as n from contracts.${table}`)) as unknown as {
      n: number;
    }[];
    return r[0]?.n ?? -1;
  });

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 801)) as [string, string];
  [boss, u2, u3, u4, u5, u6, u7] = (await users(sql, A, 7, { from: 801 })) as string[] as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  [b1] = (await users(sql, B, 1, { from: 901 })) as [string];
  const roles = await enablePack(sql, [A, B], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [boss]);
  await members(sql, A, roles.get(A)?.editor as string, [u2, u3, u4, u5, u6, u7]);
  await members(sql, B, roles.get(B)?.viewer as string, [b1]);
  await managers(sql, A, [
    [u3, u2],
    [u4, u3],
  ]);
  await department(sql, A, "kd", { head: u6, members: [u6, u7] });
  const own: [string, string][] = [
    ["boss", boss],
    ["u2", u2],
    ["u3", u3],
    ["u4", u4],
    ["u5", u5],
    ["u6", u6],
    ["u7", u7],
  ];
  let i = 801;
  for (const [name, id] of own) {
    const [c] = await contracts(sql, A, 1, { from: i++, createdBy: id, owner: id });
    C[name] = c as string;
    await sql`update contracts.contracts set title = ${`HD ${name}`} where id = ${c as string}`;
  }
  for (const [name, by] of [
    ["free-u2", u2],
    ["free-u5", u5],
  ] as const) {
    const [c] = await contracts(sql, A, 1, { from: i++, createdBy: by });
    C[name] = c as string;
    await sql`update contracts.contracts set title = ${`HD ${name}`} where id = ${c as string}`;
  }
  const [cb] = await contracts(sql, B, 1, { from: i++, createdBy: b1, owner: b1 });
  await sql`update contracts.contracts set title = 'HD b1' where id = ${cb as string}`;
  // Hàng con của HĐ u5 và u4: item, đợt thanh toán, chữ ký số bán theo HĐ.
  await sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name)
    values (${A}, ${C.u5 as string}, 0, 'x'), (${A}, ${C.u4 as string}, 0, 'y')`;
  await sql`insert into contracts.obligations (tenant_id, contract_id, direction, seq, due_date)
    values (${A}, ${C.u5 as string}, 'pay', 1, '2026-12-01'), (${A}, ${C.u4 as string}, 'pay', 1, '2026-12-01')`;
  const [cu] = await sql<{ id: string }[]>`insert into contracts.cks_customers (tenant_id, name)
    values (${A}, 'Khách') returning id`;
  await sql`insert into contracts.cks_certificates (tenant_id, customer_id, ca, holder_name, valid_to, source,
      sale_contract_id, created_by)
    values (${A}, ${cu?.id as string}, 'CA', 'H', '2027-01-01', 'ours', ${C.u5 as string}, ${u5})`;
  await visibility(sql, [A, B], "org");
}, 60_000);

afterAll(async () => {
  await sql?.end({ timeout: 2 });
});

describe("M1D-FR-01 · chế độ org: luật mgmt-app dưới RLS", () => {
  it("cấp dưới mọi tầng thấy được: u2 thấy HĐ của mình, u3, u4 và HĐ chưa giao do mình tải; KHÔNG thấy u5/u6/u7/boss", async () => {
    expect(await seen(A, u2)).toEqual(["HD free-u2", "HD u2", "HD u3", "HD u4"]);
  });
  it("không thấy ngược lên: u3 thấy u3, u4; không thấy quản lý u2", async () => {
    expect(await seen(A, u3)).toEqual(["HD u3", "HD u4"]);
  });
  it("ngang hàng không thấy nhau: u5 chỉ thấy HĐ của mình + HĐ chưa giao mình tải", async () => {
    expect(await seen(A, u5)).toEqual(["HD free-u5", "HD u5"]);
  });
  it("M1D-FR-03 · trưởng phòng thấy HĐ của thành viên phòng; thành viên không thấy của trưởng phòng", async () => {
    expect(await seen(A, u6)).toEqual(["HD u6", "HD u7"]);
    expect(await seen(A, u7)).toEqual(["HD u7"]);
  });
  it("owner gói thấy mọi HĐ của tenant; việc nền (user rỗng) cũng vậy", async () => {
    const all = [
      "HD boss",
      "HD free-u2",
      "HD free-u5",
      "HD u2",
      "HD u3",
      "HD u4",
      "HD u5",
      "HD u6",
      "HD u7",
    ];
    expect(await seen(A, boss)).toEqual(all);
    expect(await seen(A, "")).toEqual(all);
  });
  it("tenant khác không bao giờ thấy: B thấy đúng HĐ của B; user của A đặt tenant B thấy 0; owner A không thấy HĐ của B", async () => {
    expect(await seen(B, b1)).toEqual(["HD b1"]);
    expect(await seen(B, u2)).toEqual([]);
    expect(await seen(B, boss)).toEqual([]);
    expect(await seen(A, b1)).toEqual([]);
  });
  it("hàng con theo HĐ: items/đợt/CKS của HĐ u5 ẩn với u2, hiện với u5; u2 thấy của u4 (cấp dưới)", async () => {
    const r = {
      u2: {
        items: await count(A, u2, "contract_items"),
        obligations: await count(A, u2, "obligations"),
        certs: await count(A, u2, "cks_certificates"),
      },
      u5: {
        items: await count(A, u5, "contract_items"),
        obligations: await count(A, u5, "obligations"),
        certs: await count(A, u5, "cks_certificates"),
      },
    };
    expect(r).toEqual({
      u2: { items: 1, obligations: 1, certs: 0 },
      u5: { items: 1, obligations: 1, certs: 1 },
    });
  });
  it("ghi cũng bị lọc: u2 UPDATE HĐ của u5 tác động 0 hàng; HĐ của u4 (cấp dưới) 1 hàng", async () => {
    const upd = (id: string) =>
      inPackAsRollback(
        "contracts",
        A,
        u2,
        async (tx) =>
          (await tx`update contracts.contracts set title = title where id = ${id}`).count,
      );
    expect({ peer: await upd(C.u5 as string), sub: await upd(C.u4 as string) }).toEqual({
      peer: 0,
      sub: 1,
    });
  });
});

describe("M1D-FR-02 · chuỗi quản lý: closure theo trigger, cấm vòng", () => {
  it("vòng bị chặn: u2 nhận u4 (cấp dưới tầng 2) làm quản lý ⇒ 23514; tự quản lý mình ⇒ 23514; chuỗi giữ nguyên", async () => {
    expect(await pgCode(() => managers(sql, A, [[u2, u4]]))).toBe("23514");
    expect(await pgCode(() => managers(sql, A, [[u5, u5]]))).toBe("23514");
    expect(await seen(A, u2)).toEqual(["HD free-u2", "HD u2", "HD u3", "HD u4"]);
  });
  it("đổi quản lý: u3 (kèm u4) chuyển sang u5 ⇒ u2 mất, u5 được; bỏ quản lý ⇒ u5 mất", async () => {
    await managers(sql, A, [[u3, u5]]);
    const after = { u2: await seen(A, u2), u5: await seen(A, u5) };
    await sql`delete from admin.user_managers where user_id = ${u3}`;
    const detached = await seen(A, u5);
    await managers(sql, A, [[u3, u2]]); // trả lại cây ban đầu
    expect({ ...after, detached }).toEqual({
      u2: ["HD free-u2", "HD u2"],
      u5: ["HD free-u5", "HD u3", "HD u4", "HD u5"],
      detached: ["HD free-u5", "HD u5"],
    });
    const [r] = await sql<
      { n: number; d: number }[]
    >`select count(*)::int as n, max(depth)::int as d
      from admin.user_reports where tenant_id = ${A}`;
    expect(r).toEqual({ n: 3, d: 2 }); // (u2,u3,1) (u2,u4,2) (u3,u4,1)
  });
  it("quản lý phải cùng tenant (FK kép) ⇒ 23503", async () => {
    expect(await pgCode(() => managers(sql, A, [[u5, b1]]))).toBe("23503");
  });
});

describe("M1D-FR-04 · chế độ tenant (mặc định) giữ hành vi HD1–HD9", () => {
  it("không có hàng cài đặt / mode=tenant ⇒ editor thấy cả tenant", async () => {
    await visibility(sql, [A], "tenant");
    const n = (await seen(A, u5)).length;
    await visibility(sql, [A], "org");
    expect(n).toBe(9);
  });
});
