// V2-J1 · điểm kinh doanh + danh sách/chi tiết SP + HĐ theo SP + cấu hình (CD-06) + điền `contracts.product_group` — một đường chính mỗi
// endpoint (Luật 0b). Hub-api THẬT in-process; kho/bán đi qua xác nhận mốc giao thật (V2-D).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  addDelivery,
  arrangeV2d,
  type CtxN1,
  call,
  deal,
  item,
  ok,
  P,
  product,
  settleRaw,
  startHd1,
  stockIn,
} from "../V2-D/_support/v2d";

const B = "/business";
let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

/** Hàng hoá: nhập 100 × 10.000 rồi 100 × 12.000 (BQ 11.000); bán 30 × 15.000 (giá vốn 330.000, lãi 120.000). */
async function seed() {
  await arrangeV2d(c);
  const g = await product(c.sql, { name: "Băng keo trong", grp: "goods" });
  await product(c.sql, { name: "Chứng thư số", grp: "service" });
  await stockIn(c, g.id, 100, 10_000);
  await stockIn(c, g.id, 100, 12_000);
  const k = await deal(c.sql, { sale: true, partner: "Khách A" });
  await item(c.sql, k, { qty: 30, price: 15_000, productId: g.id });
  await ok(settleRaw(c, await addDelivery(c, k)));
  return { g: g.id, sale: k };
}

describe("V2-J1 · điểm kinh doanh", () => {
  it("GET /business/products: SP đang giữ hàng có điểm + đề xuất Mua thêm/Giữ/Xả hàng, đếm theo nhóm", async () => {
    const s = await seed();
    const r = await ok(call(c, P.hoa, "GET", `${B}/products`));
    expect(r.counts).toEqual({ all: 2, service: 1, goods: 1, referral: 0 });
    const g = r.items.find((x: { id: string }) => x.id === s.g);
    expect(g).toMatchObject({ group: "goods", kind: "stock", sold_12m: 30, sold_3m: 30 });
    expect(g.held.qty).toBe(170);
    expect(g.held.value).toBe(170 * 11_000);
    expect(g.business.score).toBeGreaterThan(0);
    expect(["buy", "hold", "dump"]).toContain(g.business.suggestion);
    expect(g.business.factors.map((f: { key: string }) => f.key)).toEqual([
      "rot",
      "margin",
      "trend",
    ]);
    const f = (await ok(call(c, P.hoa, "GET", `${B}/products?group=service`))).items;
    expect(f.map((x: { name: string }) => x.name)).toEqual(["Chứng thư số"]);
    expect(f[0].business.suggestion).toBeNull(); // chưa bán, không giữ ⇒ chưa có dữ liệu
  });

  it("GET /business/products/:id: tóm tắt, lô (chênh giá + còn lại), bán (giá vốn + lãi); tenant khác ⇒ 404", async () => {
    const s = await seed();
    const r = await ok(call(c, P.hoa, "GET", `${B}/products/${s.g}`));
    expect(r.product.held.qty).toBe(170);
    expect(r.margin_pct).toBeCloseTo(26.7, 1);
    expect(r.revenue_12m).toBe(450_000);
    expect(
      r.lots.map((l: { unit_cost: number; price_change: number | null; remaining: number }) => [
        l.unit_cost,
        l.price_change,
        l.remaining,
      ]),
    ).toEqual([
      [12_000, 2_000, 100],
      [10_000, null, 70],
    ]);
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0]).toMatchObject({
      qty: 30,
      unit_price: 15_000,
      cost: 330_000,
      profit: 120_000,
      customer: "Khách A",
    });
    expect(r.contracts_count).toBe(3);
    expect((await call(c, P.an, "GET", `${B}/products/${s.g}`)).status).toBe(404);
  });

  it("GET /business/products/:id/contracts: HĐ có dòng gắn SP kèm loại", async () => {
    const s = await seed();
    const r = await ok(call(c, P.hoa, "GET", `${B}/products/${s.g}/contracts`));
    expect(r.items.map((x: { deal: string }) => x.deal).sort()).toEqual(["buy", "buy", "sell"]);
    expect(r.items.find((x: { id: string }) => x.id === s.sale)?.partner).toBe("Khách A");
  });

  it("GET/PUT /business/config: mặc định → quản lý lưu → đọc lại; ngưỡng sai 422; viewer ghi 403", async () => {
    await arrangeV2d(c);
    await c.sql`delete from contracts.score_configs_v2 where scope = 'business'`;
    const g = await ok(call(c, P.hoa, "GET", `${B}/config`));
    expect(g.config).toEqual(g.defaults);
    expect(g.version).toBe(0);
    const next = { ...g.config, hi: 80 };
    expect((await call(c, P.tam, "PUT", `${B}/config`, next)).status).toBe(403);
    expect((await call(c, P.lan, "PUT", `${B}/config`, { ...next, hi: 55, lo: 60 })).status).toBe(
      422,
    );
    const s = await ok(call(c, P.lan, "PUT", `${B}/config`, next));
    expect([s.config.hi, s.version]).toEqual([80, 1]);
    expect((await ok(call(c, P.hoa, "GET", `${B}/config`))).config.hi).toBe(80);
  });
});

describe("V2-J1 · nhóm SP của HĐ", () => {
  it("dòng gắn SP dịch vụ ⇒ service; chỉ hàng hoá ⇒ goods; chỉ Giới thiệu ⇒ giữ nguyên", async () => {
    await arrangeV2d(c);
    const svc = await product(c.sql, { name: "Hosting", grp: "service" });
    const gds = await product(c.sql, { name: "Giấy", grp: "goods" });
    const ref = await product(c.sql, { name: "Giới thiệu A", grp: "referral" });
    const groupOf = async (id: string) =>
      (
        await c.sql<
          { g: string | null }[]
        >`select product_group as g from contracts.contracts where id = ${id}`
      )[0]?.g;
    const k1 = await deal(c.sql, { sale: true });
    await item(c.sql, k1, { qty: 1, price: 1, productId: gds.id });
    expect(await groupOf(k1)).toBe("goods");
    await item(c.sql, k1, { qty: 1, price: 1, productId: svc.id });
    expect(await groupOf(k1)).toBe("service");
    const k2 = await deal(c.sql, { sale: true });
    await item(c.sql, k2, { qty: 1, price: 1, productId: ref.id });
    expect(await groupOf(k2)).toBeNull();
  });
});
