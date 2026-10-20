// V2-K · TQ-02 · BA §4.1/§5.3c/§5.4: `GET /overview` đường chính — doanh thu dự kiến/thực nhận theo mốc (5.4a chia đều phần còn lại),
// hoa hồng (% × giá trị), lãi gộp trên doanh thu dự kiến (giá vốn BQ), hàng đang giữ, theo nhóm; luật thấy M1 (chế độ org).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2k,
  type CtxN1,
  contract,
  item,
  milestone,
  monthDay,
  overview,
  P,
  product,
  setVisibility,
  startHd1,
  stockIn,
} from "./_support/v2k";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("V2-K · Tổng quan", () => {
  it("4 con số + % kỳ trước + theo nhóm; người không thấy HĐ ⇒ 0", async () => {
    await arrangeV2k(c);
    const g = await product(c.sql, { name: "Băng keo", grp: "goods" });
    await stockIn(c, g.id, 20, 5_000_000); // hàng đang giữ 100 tr, BQ 5 tr
    // HĐ bán 100.000.001: 1 mốc 30 tr (hạn tháng trước, thu tháng này) + 2 mốc trống ⇒ chia 70.000.001 = 35.000.001 + 35.000.000.
    const sale = await contract(c.sql, { deal: "sell", value: 100_000_001 });
    await item(c.sql, sale, { qty: 10, price: 9_000_000, productId: g.id }); // trước VAT 90 tr, giá vốn 10 × 5 tr
    await milestone(c.sql, sale, {
      kind: "collect",
      due: monthDay(3, 1),
      amount: 30_000_000,
      done: monthDay(0),
    });
    await milestone(c.sql, sale, { kind: "collect", due: monthDay(1), done: monthDay(2) });
    await milestone(c.sql, sale, { kind: "collect", due: monthDay(5) });
    // HĐ giới thiệu: 10% × 50 tr = 5 tr, mốc trống chưa nhận.
    const ref = await contract(c.sql, { deal: "referral", value: 50_000_000, pct: 10 });
    await milestone(c.sql, ref, { kind: "commission", due: monthDay(3) });

    const o = await overview(c, "?period=month");
    expect(o.revenue).toEqual({
      expected: 70_000_001,
      actual: 65_000_001,
      outstanding: 5_000_000,
      prev_actual: 0,
      change_pct: null,
    });
    expect(o.commission).toMatchObject({ expected: 5_000_000, actual: 0, outstanding: 5_000_000 });
    // Mỗi mốc × (90 tr − 50 tr) / 100.000.001, làm tròn xuống: 14.000.000 + 13.999.999 + hoa hồng 5 tr; biên ≈ 40%.
    expect(o.gross_profit).toMatchObject({
      amount: 32_999_999,
      margin_pct: 40,
      cost_missing: false,
    });
    expect(o.stock_held.value).toBe(100_000_000);
    const by = Object.fromEntries(
      o.groups.map((x: { group: string; total: number }) => [x.group, x.total]),
    );
    expect(by).toEqual({ service: 0, goods: 70_000_001, referral: 5_000_000 });
    expect((await overview(c, "?period=12m")).revenue.expected).toBe(100_000_001);

    await setVisibility(c, "org");
    try {
      const h = await overview(c, "", P.hoa); // hoa không phụ trách HĐ nào
      expect([h.revenue.expected, h.commission.expected]).toEqual([0, 0]);
    } finally {
      await setVisibility(c, "tenant");
    }
  });
});
