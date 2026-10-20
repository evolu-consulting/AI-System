// V2-B · tiền + kho qua `applyDelivery` THẬT (làn đầy đủ — viết TRƯỚC code). BA §5.3 (BQ gia quyền, xuất theo BQ lúc bán), §5.7
// (chặn bán vượt tồn khi xác nhận, kho trước → sau, BQ riêng từng thành phần, suất gói có hạn, đặt theo khách không đổi kho), §2
// (mỗi lần nhập một lô). Tiền bigint đồng: tổng nhập = tổng xuất + giá trị còn — không lệch đồng nào.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { comp, deliver, failOf, lotsOf, movesOf, product, type World, world } from "./_support/v2b";

let w: World;
beforeAll(async () => {
  w = await world({ ns: 2311 });
}, 120_000);
afterAll(async () => {
  await w?.stop();
});

const inn = (componentId: string, qty: string, unitPrice: number, extra = {}) => ({
  componentId,
  direction: "in" as const,
  qty,
  unitPrice,
  contractId: w.C1,
  supplierPartyKey: "tax:0311111111",
  ...extra,
});
const out = (componentId: string, qty: string, extra = {}) => ({
  componentId,
  direction: "out" as const,
  qty,
  contractId: w.C1,
  ...extra,
});
const sum = (xs: { amount: string }[], dir?: string) =>
  xs.reduce((s, m) => s + Number(m.amount), 0) + (dir ? 0 : 0);

describe("BA 5.3 · giá vốn bình quân gia quyền", () => {
  it("nhập 2 lô ⇒ BQ = (tồn cũ × giá cũ + lô × giá) ÷ tổng tồn; xuất theo BQ, BQ không đổi; hết hàng ⇒ giá trị 0", async () => {
    const p = await product(w.sql, w.A, { name: "Băng keo 5cm", grp: "goods" });
    const c = p.comps[0] as string;
    const r1 = await deliver(w, w.A, w.u1, [inn(c, "320", 10_000)]);
    expect(r1.components).toEqual([
      expect.objectContaining({
        componentId: c,
        productId: p.id,
        mode: "stock",
        onHandBefore: "0",
        onHandAfter: "320",
        avgCostBefore: 0,
        avgCostAfter: 10_000,
        valueBefore: 0,
        valueAfter: 3_200_000,
      }),
    ]);
    // "kho Băng keo 5cm: 320 → 620" (BA 5.7d)
    const r2 = await deliver(w, w.A, w.u1, [inn(c, "300", 12_000)]);
    expect(r2.components[0]).toMatchObject({
      onHandBefore: "320",
      onHandAfter: "620",
      avgCostBefore: 10_000,
      avgCostAfter: 10_968, // 6.800.000 ÷ 620 = 10.967,74 ⇒ làm tròn đồng
      valueAfter: 6_800_000,
    });
    const r3 = await deliver(w, w.A, w.u1, [out(c, "150")]);
    expect(r3.moves[0]).toMatchObject({
      direction: "out",
      qty: "150",
      unitCost: 10_968,
      amount: 1_645_161,
    });
    expect(r3.components[0]).toMatchObject({
      onHandAfter: "470",
      avgCostAfter: 10_968,
      valueAfter: 5_154_839,
    });
    const r4 = await deliver(w, w.A, w.u1, [out(c, "470")]);
    expect(r4.moves[0]?.amount).toBe(5_154_839);
    expect(await comp(w.sql, c)).toEqual({ onHand: 0, value: 0, avg: 10_968 });
    const ms = await movesOf(w.sql, c);
    const ins = ms.filter((m) => m.direction === "in");
    const outs = ms.filter((m) => m.direction === "out");
    expect(sum(ins)).toBe(6_800_000);
    expect(sum(outs)).toBe(6_800_000);
    expect(ins.every((m) => m.lot_id !== null)).toBe(true);
    // Mỗi lần nhập một lô; xuất trừ lô cũ trước (FIFO) — hết hàng ⇒ mọi lô còn 0.
    expect((await lotsOf(w.sql, c)).map((l) => [l.qty, l.remaining])).toEqual([
      [320, 0],
      [300, 0],
    ]);
  });

  it("số lượng lẻ + làm tròn: tổng xuất = tổng nhập đúng từng đồng", async () => {
    const c = (await product(w.sql, w.A, { name: "Hoá chất kg", grp: "goods" })).comps[0] as string;
    await deliver(w, w.A, w.u1, [inn(c, "2.5", 33_333), inn(c, "1", 1)]);
    // 2,5 × 33.333 = 83.332,5 ⇒ 83.333; + 1 ⇒ 83.334 ÷ 3,5 = 23.809,7 ⇒ 23.810
    expect(await comp(w.sql, c)).toEqual({ onHand: 3.5, value: 83_334, avg: 23_810 });
    for (const q of ["1", "0.3333", "1.1667", "1"]) await deliver(w, w.A, w.u1, [out(c, q)]);
    const ms = await movesOf(w.sql, c);
    expect(sum(ms.filter((m) => m.direction === "out"))).toBe(83_334);
    expect(await comp(w.sql, c)).toEqual({ onHand: 0, value: 0, avg: 23_810 });
  });
});

describe("BA 5.7b · chặn bán vượt tồn khi xác nhận", () => {
  it("thiếu ở một dòng ⇒ ném stock_insufficient kèm từng thành phần thiếu, KHÔNG ghi gì (kể cả dòng đủ)", async () => {
    const a = (await product(w.sql, w.A, { name: "Thùng phi 200L", grp: "goods" }))
      .comps[0] as string;
    const b = (await product(w.sql, w.A, { name: "Băng keo 10cm", grp: "goods" }))
      .comps[0] as string;
    await deliver(w, w.A, w.u1, [inn(a, "10", 500_000), inn(b, "5", 20_000)]);
    let err: unknown;
    try {
      await deliver(w, w.A, w.u1, [out(a, "3"), out(b, "6")]);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({
      code: "stock_insufficient",
      shortages: [{ componentId: b, need: "6", have: "5" }],
    });
    expect(await comp(w.sql, a)).toEqual({ onHand: 10, value: 5_000_000, avg: 500_000 });
    expect((await movesOf(w.sql, a)).length).toBe(1);
    expect((await movesOf(w.sql, b)).length).toBe(1);
  });

  it("cùng thành phần trên 2 dòng: cộng dồn mới so tồn", async () => {
    const a = (await product(w.sql, w.A, { name: "Keo dán", grp: "goods" })).comps[0] as string;
    await deliver(w, w.A, w.u1, [inn(a, "10", 1_000)]);
    expect(await failOf(() => deliver(w, w.A, w.u1, [out(a, "6"), out(a, "5")]))).toBe(
      "stock_insufficient",
    );
    const r = await deliver(w, w.A, w.u1, [out(a, "6"), out(a, "4")]);
    expect(r.components).toHaveLength(1);
    expect(r.components[0]).toMatchObject({ onHandBefore: "10", onHandAfter: "0" });
    expect(r.moves.map((m) => m.amount)).toEqual([6_000, 4_000]);
  });
});

describe("BA 5.7f · SP nhiều thành phần: kho + BQ riêng từng thành phần", () => {
  it("nhập 50 token trắng chỉ cộng USB Token, không cộng suất chứng thư; BQ không gộp", async () => {
    const p = await product(w.sql, w.A, {
      name: "Chữ ký số DN – USB Token",
      grp: "service",
      components: [
        { name: "Chứng thư số", mode: "quota" },
        { name: "USB Token", mode: "stock" },
      ],
    });
    const [cert, token] = p.comps as [string, string];
    await deliver(w, w.A, w.u1, [inn(cert, "100", 300_000, { expiresOn: "2027-10-31" })]);
    const r = await deliver(w, w.A, w.u1, [inn(token, "50", 150_000)]);
    expect(r.components.map((x) => x.componentId)).toEqual([token]);
    expect(await comp(w.sql, cert)).toEqual({ onHand: 100, value: 30_000_000, avg: 300_000 });
    expect(await comp(w.sql, token)).toEqual({ onHand: 50, value: 7_500_000, avg: 150_000 });
    const sale = await deliver(w, w.A, w.u1, [out(cert, "1"), out(token, "1")]);
    expect(sale.moves.map((m) => [m.componentId, m.unitCost, m.amount])).toEqual([
      [cert, 300_000, 300_000],
      [token, 150_000, 150_000],
    ]);
  });
});

describe("BA 5.7c · gói suất có hạn (Dịch vụ có hạn)", () => {
  it("nhập gói: hạn = ngày kết thúc HĐ; bán trừ gói hết hạn sớm nhất; gói quá hạn ⇒ xuất 'expire' theo BQ trước khi bán", async () => {
    const c = (await product(w.sql, w.A, { name: "Hoá đơn điện tử", grp: "service" }))
      .comps[0] as string;
    expect(await failOf(() => deliver(w, w.A, w.u1, [inn(c, "100", 200_000)]))).toBe("invalid"); // thiếu hạn gói
    await deliver(
      w,
      w.A,
      w.u1,
      [inn(c, "100", 200_000, { expiresOn: "2026-12-31" })],
      "2026-01-10",
    );
    await deliver(w, w.A, w.u1, [inn(c, "50", 260_000, { expiresOn: "2027-06-30" })], "2026-07-01");
    expect(await comp(w.sql, c)).toEqual({ onHand: 150, value: 33_000_000, avg: 220_000 });
    await deliver(w, w.A, w.u1, [out(c, "30")], "2026-11-01");
    expect((await lotsOf(w.sql, c)).map((l) => l.remaining)).toEqual([70, 50]);
    // 2027-01-05: gói 1 (hạn 2026-12-31) còn 70 suất ⇒ hết hạn; còn 50 suất ⇒ bán 60 bị chặn.
    expect(await failOf(() => deliver(w, w.A, w.u1, [out(c, "60")], "2027-01-05"))).toBe(
      "stock_insufficient",
    );
    expect(await comp(w.sql, c)).toEqual({ onHand: 120, value: 26_400_000, avg: 220_000 });
    const r = await deliver(w, w.A, w.u1, [out(c, "10")], "2027-01-05");
    expect(r.moves.map((m) => [m.reason, m.qty, m.amount])).toEqual([
      ["expire", "70", 15_400_000],
      ["delivery", "10", 2_200_000],
    ]);
    expect(r.components[0]).toMatchObject({ onHandBefore: "120", onHandAfter: "40" });
    expect((await lotsOf(w.sql, c)).map((l) => [l.remaining, l.expires_on])).toEqual([
      [0, "2026-12-31"],
      [40, "2027-06-30"],
    ]);
  });
});

describe("BA §2 · không giữ hàng: giá vốn theo từng đơn", () => {
  it("thành phần `order`: ghi giá vốn của đơn, tồn/BQ không đổi; thiếu giá ⇒ invalid", async () => {
    const c = (
      await product(w.sql, w.A, {
        name: "Chữ ký số cá nhân",
        grp: "service",
        components: [{ name: "Chữ ký số cá nhân", mode: "order" }],
      })
    ).comps[0] as string;
    expect(await failOf(() => deliver(w, w.A, w.u1, [out(c, "2")]))).toBe("invalid");
    const r = await deliver(w, w.A, w.u1, [out(c, "2", { unitPrice: 450_000 })]);
    expect(r.moves[0]).toMatchObject({ unitCost: 450_000, amount: 900_000, lotId: null });
    expect(r.components[0]).toMatchObject({ mode: "order", onHandBefore: "0", onHandAfter: "0" });
    expect(await comp(w.sql, c)).toEqual({ onHand: 0, value: 0, avg: 0 });
  });

  it("SP Giới thiệu (none) ⇒ invalid; vừa nhập vừa xuất cùng thành phần ⇒ invalid; SL ≤ 0 / > 4 số lẻ ⇒ invalid", async () => {
    const ref = (await product(w.sql, w.A, { name: "Bảo hiểm xe", grp: "referral" }))
      .comps[0] as string;
    const g = (await product(w.sql, w.A, { name: "Ống nhựa", grp: "goods" })).comps[0] as string;
    expect(await failOf(() => deliver(w, w.A, w.u1, [inn(ref, "1", 1)]))).toBe("invalid");
    expect(await failOf(() => deliver(w, w.A, w.u1, [inn(g, "5", 1), out(g, "1")]))).toBe(
      "invalid",
    );
    for (const q of ["0", "-1", "1.00001", "abc"])
      expect({ q, f: await failOf(() => deliver(w, w.A, w.u1, [inn(g, q, 1)])) }).toEqual({
        q,
        f: "invalid",
      });
  });
});
