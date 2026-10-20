// V2-B · RLS/tenant + M1 + chỉ thêm (làn đầy đủ — viết TRƯỚC code kho). Bảng mới: products, product_components, product_rules,
// stock_lots, stock_moves. Tenant A ở chế độ thấy `org`: boss = owner gói, u1/u2 editor ngang hàng (không thấy HĐ của nhau).
// docs/specs/V2-B/tasks.md D2: danh mục + tồn + lô (số lượng) thấy cả tenant; sổ nhập/xuất (giá, HĐ) theo luật thấy HĐ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inPackAs, pgCode } from "@ai/test-kit/db";
import { comp, deliver, failOf, product, type World, world } from "./_support/v2b";

let w: World;
let tape: { id: string; comps: string[] };
beforeAll(async () => {
  w = await world({ ns: 2301 });
  tape = await product(w.sql, w.A, { name: "Băng keo 5cm", grp: "goods" });
  await deliver(w, w.A, w.u1, [
    {
      componentId: tape.comps[0] as string,
      direction: "in",
      qty: "320",
      unitPrice: 10_000,
      contractId: w.C1,
      supplierPartyKey: "tax:0311111111",
    },
  ]);
}, 120_000);
afterAll(async () => {
  await w?.stop();
});

const count = (tenant: string, user: string, table: string) =>
  inPackAs("contracts", tenant, user, async (tx) => {
    const r = (await tx.unsafe(`select count(*)::int as n from contracts.${table}`)) as unknown as {
      n: number;
    }[];
    return r[0]?.n ?? -1;
  });

describe("V2-B RLS · cách ly tenant", () => {
  it("tenant B không thấy SP / thành phần / lô / sổ của A", async () => {
    for (const t of ["products", "product_components", "stock_lots", "stock_moves"]) {
      expect({ t, n: await count(w.B, w.b1, t) }).toEqual({ t, n: 0 });
      expect({ t, n: (await count(w.A, w.boss, t)) > 0 }).toEqual({ t, n: true });
    }
  });

  it("B không ghi được vào A: tenant_id lạ ⇒ 42501; trỏ SP của A ⇒ 23503 (FK kép, không lộ tồn tại)", async () => {
    expect(
      await pgCode(() =>
        inPackAs(
          "contracts",
          w.B,
          w.b1,
          (tx) =>
            tx`insert into contracts.products (tenant_id, name, grp) values (${w.A}, 'X', 'goods')`,
        ),
      ),
    ).toBe("42501");
    expect(
      await pgCode(() =>
        inPackAs(
          "contracts",
          w.B,
          w.b1,
          (tx) =>
            tx`insert into contracts.product_components (tenant_id, product_id, name, mode)
            values (${w.B}, ${tape.id}, 'X', 'stock')`,
        ),
      ),
    ).toBe("23503");
  });

  it("B giao hàng vào thành phần của A ⇒ không thấy thành phần (lỗi invalid), A không đổi", async () => {
    const before = await comp(w.sql, tape.comps[0] as string);
    const code = await failOf(() =>
      deliver(w, w.B, w.b1, [
        {
          componentId: tape.comps[0] as string,
          direction: "in",
          qty: "5",
          unitPrice: 1,
          contractId: w.CB,
        },
      ]),
    );
    expect(code).toBe("invalid");
    expect(await comp(w.sql, tape.comps[0] as string)).toEqual(before);
  });
});

describe("V2-B RLS · M1 (chế độ org)", () => {
  it("u2 thấy danh mục + tồn + lô (số lượng) nhưng KHÔNG thấy dòng sổ của HĐ u1; boss và u1 thấy", async () => {
    expect(await count(w.A, w.u2, "products")).toBe(1);
    expect(await count(w.A, w.u2, "stock_lots")).toBe(1);
    const onHand = await inPackAs("contracts", w.A, w.u2, async (tx) => {
      const [r] = await tx<
        { n: string }[]
      >`select on_hand::float8::text as n from contracts.product_components
        where id = ${tape.comps[0] as string}`;
      return r?.n;
    });
    expect(onHand).toBe("320");
    expect(await count(w.A, w.u2, "stock_moves")).toBe(0);
    expect(await count(w.A, w.u1, "stock_moves")).toBe(1);
    expect(await count(w.A, w.boss, "stock_moves")).toBe(1);
  });

  it("u2 ghi sổ cho HĐ u1 (không thấy) ⇒ 42501, tồn không đổi", async () => {
    const before = await comp(w.sql, tape.comps[0] as string);
    const code = await failOf(() =>
      deliver(w, w.A, w.u2, [
        {
          componentId: tape.comps[0] as string,
          direction: "in",
          qty: "10",
          unitPrice: 9_000,
          contractId: w.C1,
        },
      ]),
    );
    expect(code).toBe("42501");
    expect(await comp(w.sql, tape.comps[0] as string)).toEqual(before);
  });

  it("u2 bán từ tồn do u1 nhập qua HĐ của mình: được, BQ đúng, u2 chỉ thấy dòng sổ của mình", async () => {
    const r = await deliver(w, w.A, w.u2, [
      { componentId: tape.comps[0] as string, direction: "out", qty: "20", contractId: w.C2 },
    ]);
    expect(r.components[0]).toMatchObject({
      onHandBefore: "320",
      onHandAfter: "300",
      avgCostAfter: 10_000,
    });
    expect(await count(w.A, w.u2, "stock_moves")).toBe(1);
    expect(await count(w.A, w.u1, "stock_moves")).toBe(1);
    expect(await count(w.A, w.boss, "stock_moves")).toBe(2);
  });

  it("u2 xoá quy tắc nhận diện của u1 ⇒ 0 hàng; u1 xoá được", async () => {
    await inPackAs(
      "contracts",
      w.A,
      w.u1,
      (tx) =>
        tx`insert into contracts.product_rules (tenant_id, product_id, pattern) values (${w.A}, ${tape.id}, 'băng keo')`,
    );
    const del = (u: string) =>
      inPackAs(
        "contracts",
        w.A,
        u,
        async (tx) => (await tx`delete from contracts.product_rules returning id`).length,
      );
    expect(await del(w.u2)).toBe(0);
    expect(await del(w.u1)).toBe(1);
  });
});

describe("V2-B · chỉ thêm + tồn/BQ chỉ đổi kèm dòng sổ", () => {
  const asU1 = (q: string) => pgCode(() => inPackAs("contracts", w.A, w.u1, (tx) => tx.unsafe(q)));

  it("sửa/xoá sổ, sửa/xoá SP, xoá lô, sửa số lượng lô ⇒ 42501", async () => {
    for (const q of [
      "update contracts.stock_moves set amount = 1",
      "delete from contracts.stock_moves",
      "update contracts.products set name = 'X'",
      "delete from contracts.products",
      "delete from contracts.product_components",
      "update contracts.product_components set name = 'X'",
      "delete from contracts.stock_lots",
      "update contracts.stock_lots set qty = 1",
    ]) {
      expect({ q, code: await asU1(q) }).toEqual({ q, code: "42501" });
    }
  });

  it("sửa tay tồn / giá vốn không kèm dòng sổ mới ⇒ 23514", async () => {
    const id = tape.comps[0] as string;
    expect(
      await asU1(`update contracts.product_components set on_hand = 999 where id = '${id}'`),
    ).toBe("23514");
    expect(
      await asU1(`update contracts.product_components set avg_cost = 1 where id = '${id}'`),
    ).toBe("23514");
    expect(
      await asU1(`update contracts.product_components set on_hand = 999, stock_value = 1,
        last_move_id = (select id from contracts.stock_moves order by seq limit 1) where id = '${id}'`),
    ).toBe("23514");
  });

  it("ghi sổ mạo danh người khác (created_by) ⇒ 42501", async () => {
    const code =
      await asU1(`insert into contracts.stock_moves (id, tenant_id, component_id, direction, qty, unit_cost,
      amount, moved_on, created_by) values (gen_random_uuid(), '${w.A}', '${tape.comps[0]}', 'in', 1, 1, 1, current_date,
      '${w.u2}')`);
    expect(code).toBe("42501");
  });
});
