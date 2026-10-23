// V2-G · BA §5.5a/5.5f · C12 — vá khoảng trống V2-F: chi tiết trả product_id/component_ids từng dòng (xem review.int) và lệnh gắn / gắn lại
// SP cho dòng HĐ ĐÃ LƯU (`PUT /contracts/:id/items/:itemId/product`, khối "Sản phẩm"). Dòng đã có phát sinh kho (V2-D) ⇒ 409 ITEM_LOCKED.
// Tenant khác ⇒ 404; SP/thành phần không hợp lệ ⇒ 422 PRODUCT_INVALID; viewer ⇒ 403.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  detail,
  itemRows,
  makeProduct,
  needV2g,
  P,
  restoreApproval,
  seedReview,
  setApproval,
  startHd1,
  T,
} from "./_support/v2g";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await needV2g(c.sql);
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const put = (cid: string, itemId: string, body: unknown, p: (typeof P)[keyof typeof P] = P.hoa) =>
  call(c, p, "PUT", `/contracts/${cid}/items/${itemId}/product`, body);

async function world(status = "needs_review") {
  await arrangeV2a(c);
  await setApproval(c.sql, T.acme, false);
  await c.sql`truncate contracts.products cascade`;
  const multi = await makeProduct(c, P.hoa, {
    name: "Chữ ký số DN",
    group: "service",
    components: [{ name: "USB Token" }, { name: "Chứng thư số" }],
  });
  const single = await makeProduct(c, P.hoa, { name: "Băng keo", group: "goods" });
  const theirs = await makeProduct(c, P.an, { name: "SP beta", group: "goods" });
  const s = await seedReview(c, 1, {
    status,
    deal: "sell",
    items: [{ name: "Token USB", qty: 5, unit_price: 10 }, { name: "Dòng 2" }],
  });
  return { multi, single, theirs, s };
}

describe("V2-G · C12 gắn / gắn lại SP cho dòng HĐ đã lưu", () => {
  it("gắn SP + thành phần ⇒ chi tiết trả đúng; gắn lại SP khác; gỡ (null); có sự kiện item_product_set", async () => {
    const { multi, single, s } = await world();
    const [first, second] = s.items as [string, string];
    const a = await put(s.id, first, { product_id: multi.id, component_ids: [multi.comps[0]] });
    expect(a.status).toBe(200);
    expect(a.json).toEqual({ id: first, product_id: multi.id, component_ids: [multi.comps[0]] });
    let x = await detail(c, s.id);
    expect(x.items.map((i: { product_id: string | null }) => i.product_id)).toEqual([
      multi.id,
      null,
    ]);

    const b = await put(s.id, first, { product_id: single.id });
    expect(b.json).toEqual({ id: first, product_id: single.id, component_ids: null });
    const g = await put(s.id, first, { product_id: null });
    expect(g.json).toEqual({ id: first, product_id: null, component_ids: null });
    x = await detail(c, s.id);
    expect(x.items.map((i: { product_id: string | null }) => i.product_id)).toEqual([null, null]);

    await put(s.id, second, { product_id: single.id });
    expect((await itemRows(c.sql, s.id)).map((i) => i.product_id)).toEqual([null, single.id]);
    const ev = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contract_events
      where contract_id = ${s.id} and type = 'item_product_set'`;
    expect(ev[0]?.n).toBe(4);
  });

  it("SP của tenant khác / không có ⇒ 422 PRODUCT_INVALID; thành phần không thuộc SP ⇒ 422; không đổi gì", async () => {
    const { multi, single, theirs, s } = await world();
    const [first] = s.items as [string];
    await put(s.id, first, { product_id: single.id });
    for (const body of [
      { product_id: theirs.id },
      { product_id: "e1000000-0000-4000-8000-0000000000ff" },
      { product_id: multi.id, component_ids: single.comps },
    ]) {
      const r = await put(s.id, first, body);
      expect([r.status, r.json.error.code]).toEqual([422, "PRODUCT_INVALID"]);
    }
    expect((await itemRows(c.sql, s.id))[0]?.product_id).toBe(single.id);
  });

  it("thân sai ⇒ 400 (thành phần không kèm SP, uuid hỏng, thiếu khoá, khoá lạ)", async () => {
    const { multi, s } = await world();
    const [first] = s.items as [string];
    for (const body of [
      { product_id: null, component_ids: multi.comps },
      { product_id: "x" },
      {},
      { product_id: multi.id, tenant_id: T.beta },
    ])
      expect((await put(s.id, first, body)).status).toBe(400);
    expect(
      (
        await call(c, P.hoa, "PUT", `/contracts/${s.id}/items/khong-uuid/product`, {
          product_id: null,
        })
      ).status,
    ).toBe(400);
  });

  it("dòng đã có phát sinh kho ⇒ 409 ITEM_LOCKED (C12); HĐ khác không bị khoá theo", async () => {
    const { multi, single, s } = await world();
    const other = await seedReview(c, 2, { deal: "sell", items: [{ name: "HĐ khác" }] });
    const [first] = s.items as [string];
    await put(s.id, first, { product_id: multi.id, component_ids: [multi.comps[0]] });
    await c.sql`insert into contracts.stock_moves (id, tenant_id, component_id, direction, reason, qty, unit_cost, amount,
        moved_on, contract_id, contract_item_id)
      values (${crypto.randomUUID()}, ${T.acme}, ${multi.comps[0] as string}, 'out', 'delivery', 1, 0, 0, current_date, ${s.id},
        ${first})`;
    const r = await put(s.id, first, { product_id: single.id });
    expect([r.status, r.json.error.code]).toEqual([409, "ITEM_LOCKED"]);
    expect((await itemRows(c.sql, s.id))[0]?.product_id).toBe(multi.id);
    expect((await put(other.id, other.items[0] as string, { product_id: single.id })).status).toBe(
      200,
    );
  });

  it("HĐ đang đọc (extracting) ⇒ 409 ITEM_LOCKED (dòng sắp bị AI thay)", async () => {
    const { single, s } = await world("extracting");
    const r = await put(s.id, s.items[0] as string, { product_id: single.id });
    expect([r.status, r.json.error.code]).toEqual([409, "ITEM_LOCKED"]);
  });

  it("quyền + cô lập: viewer 403; tenant khác 404; dòng của HĐ khác / không có 404", async () => {
    const { single, s } = await world();
    const [first] = s.items as [string];
    const other = await seedReview(c, 2, { deal: "sell", items: [{ name: "HĐ khác" }] });
    expect((await put(s.id, first, { product_id: single.id }, P.tam)).status).toBe(403);
    expect((await put(s.id, first, { product_id: null }, P.an)).status).toBe(404);
    // dòng thuộc HĐ khác qua URL của HĐ này
    expect((await put(s.id, other.items[0] as string, { product_id: single.id })).status).toBe(404);
    expect(
      (await put(s.id, "e1000000-0000-4000-8000-0000000000fe", { product_id: null })).status,
    ).toBe(404);
    expect((await itemRows(c.sql, other.id))[0]?.product_id).toBeNull();
  });
});
