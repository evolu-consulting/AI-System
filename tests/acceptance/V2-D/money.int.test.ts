// V2-D · BA v2 §5.3 · §5.7a-d · HD-05 — tiền/kho khi xác nhận mốc giao, viết TRƯỚC code. Xác nhận = `POST /obligations/:id/settle`
// THẬT: Mua ⇒ nhập kho / nhập suất gói (hạn = ngày kết thúc HĐ) + BQ gia quyền; Bán ⇒ xuất theo BQ; đặt theo khách ⇒ kho không đổi;
// thiếu tồn ⇒ chặn, không ghi gì; giao nhiều đợt, trống = giao hết phần còn lại, không giao vượt SL trên HĐ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  addDelivery,
  addDeliveryRaw,
  arrangeV2d,
  type CtxN1,
  call,
  comp,
  d,
  deal,
  deliveredOf,
  item,
  lotsOf,
  movesOf,
  ok,
  P,
  product,
  settleRaw,
  startHd1,
  statusOf,
  stockIn,
} from "./_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("V2-D · HĐ Mua: nhập kho + BQ (5.3, 5.7c/d)", () => {
  it("320 @10.000 rồi nhập 300 @12.000 ⇒ 620, BQ 10.968; phản hồi ghi kho + giá vốn trước → sau", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Băng keo 5cm", grp: "goods" });
    const cid = p.comps[0] as string;
    await stockIn(c, p.id, 320, 10_000);
    expect(await comp(c.sql, cid)).toEqual({ onHand: 320, value: 3_200_000, avg: 10_000 });

    const k = await deal(c.sql, { sale: false, end: d(365) });
    const line = await item(c.sql, k, { qty: 300, price: 12_000, productId: p.id });
    const m = await addDelivery(c, k);
    const r = await ok(settleRaw(c, m));
    expect(r.status).toBe("done");
    expect(await comp(c.sql, cid)).toEqual({ onHand: 620, value: 6_800_000, avg: 10_968 });
    expect(await deliveredOf(c.sql, line)).toBe(300);
    expect(r.delivery.stock).toEqual([
      expect.objectContaining({
        component_id: cid,
        product_id: p.id,
        name: "Băng keo 5cm",
        mode: "stock",
        on_hand_before: "320",
        on_hand_after: "620",
        avg_cost_before: 10_000,
        avg_cost_after: 10_968,
      }),
    ]);
    expect(r.delivery.notes).toContain("kho Băng keo 5cm: 320 → 620");
    expect(r.delivery.items).toEqual([{ item_id: line, qty: "300" }]);
    const mv = await movesOf(c.sql, cid);
    expect(mv.at(-1)).toEqual({
      direction: "in",
      qty: 300,
      unit_cost: 12_000,
      amount: 3_600_000,
      milestone_id: m,
    });
  });

  it("dịch vụ có hạn: nhập suất, hạn gói = ngày kết thúc HĐ mua", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Chứng thư số 1 năm", grp: "service" });
    const cid = p.comps[0] as string;
    const end = d(400);
    await stockIn(c, p.id, 50, 200_000, { end });
    expect(await comp(c.sql, cid)).toEqual({ onHand: 50, value: 10_000_000, avg: 200_000 });
    expect([...(await lotsOf(c.sql, cid))]).toEqual([{ qty: 50, remaining: 50, expires_on: end }]);
  });

  it("HĐ dịch vụ có hạn không có ngày kết thúc ⇒ 422, không ghi gì, mốc còn mở", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Gói suất X", grp: "service" });
    const k = await deal(c.sql, { sale: false, end: null });
    await item(c.sql, k, { qty: 10, price: 1_000, productId: p.id });
    const m = await addDelivery(c, k);
    const r = await settleRaw(c, m);
    expect([r.status, r.json?.error?.code]).toEqual([422, "DELIVERY_INVALID"]);
    expect(await statusOf(c.sql, m)).toBe("open");
    expect(await comp(c.sql, p.comps[0] as string)).toEqual({ onHand: 0, value: 0, avg: 0 });
  });

  it("dòng mua thiếu đơn giá ⇒ 422, không ghi gì", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Ốc vít", grp: "goods" });
    const k = await deal(c.sql, { sale: false });
    const line = await item(c.sql, k, { qty: 10, price: null, productId: p.id });
    const m = await addDelivery(c, k);
    const r = await settleRaw(c, m);
    expect([r.status, r.json?.error?.code]).toEqual([422, "DELIVERY_INVALID"]);
    expect(await statusOf(c.sql, m)).toBe("open");
    expect(await deliveredOf(c.sql, line)).toBe(0);
    expect([...(await movesOf(c.sql, p.comps[0] as string))]).toEqual([]);
  });

  it("SP nhiều thành phần: dòng chọn USB Token ⇒ chỉ cộng kho USB Token, không cộng suất chứng thư (5.7f)", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, {
      name: "Chữ ký số DN – USB Token",
      grp: "service",
      components: [
        { name: "Chứng thư số", mode: "quota" },
        { name: "USB Token", mode: "stock" },
      ],
    });
    const [cert, token] = p.comps as [string, string];
    await stockIn(c, p.id, 50, 150_000, { componentIds: [token] });
    expect(await comp(c.sql, token)).toEqual({ onHand: 50, value: 7_500_000, avg: 150_000 });
    expect(await comp(c.sql, cert)).toEqual({ onHand: 0, value: 0, avg: 0 });
  });

  it("đặt theo khách (không giữ hàng): mua ghi giá vốn đơn, kho không đổi", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, {
      name: "Máy in đặt riêng",
      grp: "goods",
      components: [{ name: "Máy in đặt riêng", mode: "order" }],
    });
    const cid = p.comps[0] as string;
    await stockIn(c, p.id, 2, 5_000_000);
    expect(await comp(c.sql, cid)).toEqual({ onHand: 0, value: 0, avg: 0 });
    expect((await movesOf(c.sql, cid)).map((x) => [x.direction, x.qty, x.unit_cost])).toEqual([
      ["in", 2, 5_000_000],
    ]);
  });
});

describe("V2-D · HĐ Bán: xuất theo BQ, chặn thiếu tồn (5.3b, 5.7b)", () => {
  it("bán 120 khi tồn 620 BQ 10.968 ⇒ 500, giá vốn đơn = BQ lúc bán, BQ giữ nguyên", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Băng keo 5cm", grp: "goods" });
    const cid = p.comps[0] as string;
    await stockIn(c, p.id, 320, 10_000);
    await stockIn(c, p.id, 300, 12_000);
    const k = await deal(c.sql, { sale: true });
    await item(c.sql, k, { qty: 120, price: 20_000, productId: p.id });
    const r = await ok(settleRaw(c, await addDelivery(c, k)));
    // 6.800.000 × 120 / 620 = 1.316.129,03 ⇒ 1.316.129
    expect(await comp(c.sql, cid)).toEqual({ onHand: 500, value: 5_483_871, avg: 10_968 });
    expect((await movesOf(c.sql, cid)).at(-1)).toEqual(
      expect.objectContaining({ direction: "out", qty: 120, unit_cost: 10_968, amount: 1_316_129 }),
    );
    expect(r.delivery.notes).toContain("kho Băng keo 5cm: 620 → 500");
  });

  it("thiếu tồn ⇒ 409 STOCK_INSUFFICIENT kèm thành phần thiếu; không ghi kho, mốc còn mở", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Băng keo 5cm", grp: "goods" });
    const q = await product(c.sql, { name: "Kéo", grp: "goods" });
    await stockIn(c, p.id, 20, 10_000);
    await stockIn(c, q.id, 100, 5_000);
    const k = await deal(c.sql, { sale: true });
    const a = await item(c.sql, k, { qty: 50, price: 20_000, productId: p.id });
    await item(c.sql, k, { qty: 10, price: 9_000, productId: q.id });
    const m = await addDelivery(c, k);
    const r = await settleRaw(c, m);
    expect([r.status, r.json?.error?.code]).toEqual([409, "STOCK_INSUFFICIENT"]);
    expect(r.json.error.details.shortages).toEqual([
      { component_id: p.comps[0], name: "Băng keo 5cm", need: "50", have: "20" },
    ]);
    expect(r.json.error.message).toContain("Băng keo 5cm");
    expect(await statusOf(c.sql, m)).toBe("open");
    expect(await comp(c.sql, p.comps[0] as string)).toEqual({
      onHand: 20,
      value: 200_000,
      avg: 10_000,
    });
    expect(await comp(c.sql, q.comps[0] as string)).toEqual({
      onHand: 100,
      value: 500_000,
      avg: 5_000,
    });
    expect(await deliveredOf(c.sql, a)).toBe(0);
  });

  it("bán dịch vụ có hạn ⇒ trừ suất gói", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Chứng thư số 1 năm", grp: "service" });
    const cid = p.comps[0] as string;
    await stockIn(c, p.id, 50, 200_000, { end: d(400) });
    const k = await deal(c.sql, { sale: true, end: d(365) });
    await item(c.sql, k, { qty: 3, price: 500_000, productId: p.id });
    await ok(settleRaw(c, await addDelivery(c, k)));
    expect(await comp(c.sql, cid)).toEqual({ onHand: 47, value: 9_400_000, avg: 200_000 });
  });

  it("đặt theo khách: bán không đổi kho, không chặn vì tồn 0", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, {
      name: "In ấn theo mẫu",
      grp: "goods",
      components: [{ name: "In ấn theo mẫu", mode: "order" }],
    });
    const k = await deal(c.sql, { sale: true });
    await item(c.sql, k, { qty: 1000, price: 3_000, productId: p.id });
    const r = await ok(settleRaw(c, await addDelivery(c, k)));
    expect(r.status).toBe("done");
    expect(await comp(c.sql, p.comps[0] as string)).toEqual({ onHand: 0, value: 0, avg: 0 });
  });

  it("lưu HĐ bán vượt tồn được phép, API trả cờ cảnh báo (5.7b/e) — không ghi gì", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Băng keo 5cm", grp: "goods" });
    await stockIn(c, p.id, 20, 10_000);
    const r = await ok(
      call(c, P.hoa, "POST", "/stock/check", { items: [{ product_id: p.id, qty: 50 }] }),
    );
    expect(r.over_stock).toBe(true);
    expect(r.components).toEqual([
      expect.objectContaining({ component_id: p.comps[0], need: "50", on_hand: "20", over: true }),
    ]);
    const fine = await ok(
      call(c, P.hoa, "POST", "/stock/check", { items: [{ product_id: p.id, qty: 20 }] }),
    );
    expect(fine.over_stock).toBe(false);
    expect(await comp(c.sql, p.comps[0] as string)).toEqual({
      onHand: 20,
      value: 200_000,
      avg: 10_000,
    });
  });
});

describe("V2-D · giao nhiều đợt: Trên HĐ · Đã giao · Giao lần này (5.7a)", () => {
  it("đợt 1 giao 40, đợt 2 để trống ⇒ giao hết 60 còn lại; đợt 3 không còn gì ⇒ kho không đổi", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Giấy A4", grp: "goods" });
    const cid = p.comps[0] as string;
    const k = await deal(c.sql, { sale: false });
    const line = await item(c.sql, k, { qty: 100, price: 50_000, productId: p.id });
    const m1 = await addDelivery(c, k, [{ item_id: line, qty: 40 }]);
    const m2 = await addDelivery(c, k);
    const view = await ok(call(c, P.hoa, "GET", `/milestones/${m1}/delivery`));
    expect(view.rows).toEqual([
      expect.objectContaining({
        item_id: line,
        on_contract: "100",
        delivered: "0",
        this_time: "40",
      }),
    ]);
    await ok(settleRaw(c, m1));
    expect(await comp(c.sql, cid)).toEqual({ onHand: 40, value: 2_000_000, avg: 50_000 });
    const v2 = await ok(call(c, P.hoa, "GET", `/milestones/${m2}/delivery`));
    expect(v2.rows[0]).toEqual(
      expect.objectContaining({ delivered: "40", this_time: "60", remaining: "60" }),
    );
    await ok(settleRaw(c, m2));
    expect(await comp(c.sql, cid)).toEqual({ onHand: 100, value: 5_000_000, avg: 50_000 });
    expect(await deliveredOf(c.sql, line)).toBe(100);
    const m3 = await addDelivery(c, k);
    const r3 = await ok(settleRaw(c, m3));
    expect(r3.status).toBe("done");
    expect(await comp(c.sql, cid)).toEqual({ onHand: 100, value: 5_000_000, avg: 50_000 });
  });

  it("HĐ nhiều dòng: dòng để trống trong bảng ⇒ không giao đợt đó", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Giấy A4", grp: "goods" });
    const q = await product(c.sql, { name: "Bút bi", grp: "goods" });
    const k = await deal(c.sql, { sale: false });
    const a = await item(c.sql, k, { qty: 100, price: 50_000, productId: p.id });
    const b = await item(c.sql, k, { qty: 10, price: 3_000, productId: q.id });
    const m = await addDelivery(c, k, [{ item_id: a, qty: 30 }]);
    await ok(settleRaw(c, m));
    expect([await deliveredOf(c.sql, a), await deliveredOf(c.sql, b)]).toEqual([30, 0]);
    expect((await comp(c.sql, q.comps[0] as string))?.onHand).toBe(0);
  });

  it("không giao vượt SL trên HĐ: lưu mốc vượt phần còn lại ⇒ 422 DELIVERY_OVER", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Giấy A4", grp: "goods" });
    const k = await deal(c.sql, { sale: false });
    const line = await item(c.sql, k, { qty: 100, price: 50_000, productId: p.id });
    await ok(settleRaw(c, await addDelivery(c, k, [{ item_id: line, qty: 70 }])));
    const r = await addDeliveryRaw(c, k, [{ item_id: line, qty: 31 }]);
    expect([r.status, r.json?.error?.code]).toEqual([422, "DELIVERY_OVER"]);
    const fine = await addDeliveryRaw(c, k, [{ item_id: line, qty: 30 }]);
    expect(fine.status).toBe(201);
  });

  it("hai mốc cùng kế hoạch phần còn lại: mốc xác nhận sau vượt ⇒ 422 DELIVERY_OVER, không ghi gì", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Giấy A4", grp: "goods" });
    const k = await deal(c.sql, { sale: false });
    const line = await item(c.sql, k, { qty: 100, price: 50_000, productId: p.id });
    const m1 = await addDelivery(c, k, [{ item_id: line, qty: 60 }]);
    const m2 = await addDelivery(c, k, [{ item_id: line, qty: 60 }]);
    await ok(settleRaw(c, m1));
    const r = await settleRaw(c, m2);
    expect([r.status, r.json?.error?.code]).toEqual([422, "DELIVERY_OVER"]);
    expect(await statusOf(c.sql, m2)).toBe("open");
    expect(await deliveredOf(c.sql, line)).toBe(60);
  });

  it("SL trên mốc chỉ cho dòng thuộc HĐ; mốc không phải Giao hàng không nhận bảng SL", async () => {
    await arrangeV2d(c);
    const k = await deal(c.sql, { sale: false });
    const other = await deal(c.sql, { sale: false });
    const foreign = await item(c.sql, other, { qty: 5, price: 1 });
    await item(c.sql, k, { qty: 5, price: 1 });
    const r = await addDeliveryRaw(c, k, [{ item_id: foreign, qty: 1 }]);
    expect([r.status, r.json?.error?.code]).toEqual([422, "MILESTONE_INVALID"]);
    const r2 = await call(c, P.hoa, "POST", `/contracts/${k}/milestones`, {
      kind: "other",
      due_date: d(2),
      items: [{ item_id: foreign, qty: 1 }],
    });
    expect([r2.status, r2.json?.error?.code]).toEqual([422, "MILESTONE_INVALID"]);
  });

  it("đã xác nhận giao có ghi kho ⇒ huỷ dòng 'đã giao' bị chặn 409 DELIVERY_LOCKED (đảo kho để V2-M)", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Giấy A4", grp: "goods" });
    const k = await deal(c.sql, { sale: false, partner: "NCC Giấy" });
    await item(c.sql, k, { qty: 10, price: 50_000, productId: p.id });
    const m = await addDelivery(c, k);
    await ok(settleRaw(c, m));
    const [ev] = await c.sql<{ id: string }[]>`select id::text from contracts.partner_events
      where obligation_id = ${m} and type = 'delivered'`;
    const r = await call(c, P.hoa, "POST", `/partner-events/${ev?.id}/void`);
    expect([r.status, r.json?.error?.code]).toEqual([409, "DELIVERY_LOCKED"]);
    expect(await statusOf(c.sql, m)).toBe("done");
  });
});
