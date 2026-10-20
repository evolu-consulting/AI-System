// V2-D · quyền gói + cách ly tenant trên đường xác nhận giao / bảng SL / kiểm tồn (viết TRƯỚC code). Viewer xác nhận ⇒ 403, kho
// không đổi; tenant khác ⇒ 404 như id lạ (không lộ tồn tại, không lộ tồn kho).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  addDelivery,
  arrangeV2d,
  type CtxN1,
  call,
  comp,
  deal,
  item,
  P,
  product,
  settleRaw,
  startHd1,
  statusOf,
} from "./_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("V2-D · quyền + tenant", () => {
  it("viewer xác nhận mốc giao ⇒ 403, kho và mốc không đổi", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Giấy A4", grp: "goods" });
    const k = await deal(c.sql, { sale: false });
    await item(c.sql, k, { qty: 10, price: 50_000, productId: p.id });
    const m = await addDelivery(c, k);
    const r = await settleRaw(c, m, P.tam);
    expect(r.status).toBe(403);
    expect(await statusOf(c.sql, m)).toBe("open");
    expect(await comp(c.sql, p.comps[0] as string)).toEqual({ onHand: 0, value: 0, avg: 0 });
  });

  it("tenant khác: xác nhận / xem bảng SL / kiểm tồn SP của acme ⇒ 404; viewer acme xem được", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Giấy A4", grp: "goods" });
    const k = await deal(c.sql, { sale: false });
    await item(c.sql, k, { qty: 10, price: 50_000, productId: p.id });
    const m = await addDelivery(c, k);
    const r = [
      await settleRaw(c, m, P.an),
      await call(c, P.an, "GET", `/milestones/${m}/delivery`),
      await call(c, P.an, "POST", "/stock/check", { items: [{ product_id: p.id, qty: 1 }] }),
      await call(c, P.hoa, "GET", `/milestones/${crypto.randomUUID()}/delivery`),
    ];
    expect(r.map((x) => [x.status, x.json?.error?.code])).toEqual([
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
    ]);
    expect(await statusOf(c.sql, m)).toBe("open");
    const v = await call(c, P.tam, "GET", `/milestones/${m}/delivery`);
    expect(v.status).toBe(200);
  });

  it("thân lạ ⇒ 400 trước SQL (kiểm tồn, bảng SL mốc)", async () => {
    await arrangeV2d(c);
    const k = await deal(c.sql, { sale: false });
    const bad = [
      await call(c, P.hoa, "POST", "/stock/check", { items: [], tenant_id: "x" }),
      await call(c, P.hoa, "POST", `/contracts/${k}/milestones`, {
        kind: "delivery",
        due_date: "2026-12-01",
        items: [{ item_id: "nope", qty: 1 }],
      }),
    ];
    expect(bad.map((x) => x.status)).toEqual([400, 400]);
  });
});
