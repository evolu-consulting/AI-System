// products-confirm · BA 5.5 (khách 2026-10-22) — đường chính `POST /contracts/:id/product-links`: HĐ ĐÃ xác nhận ⇒ dòng chọn SP có sẵn
// được gắn, dòng "tạo mới" tạo SP (sinh từ HĐ, HĐ Mua ⇒ NCC chính) rồi gắn; trùng tên SP có sẵn ⇒ gắn SP đó, không tạo. HĐ còn chờ xác
// nhận ⇒ 409 CONTRACT_NOT_CONFIRMED, không tạo SP nào. Tenant khác ⇒ 404 (không đổi gì).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  itemRows,
  makeProduct,
  needV2g,
  P,
  restoreApproval,
  seedReview,
  setApproval,
  startHd1,
  T,
} from "../V2-G/_support/v2g";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await needV2g(c.sql);
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const post = (id: string, links: unknown, p: (typeof P)[keyof typeof P] = P.hoa) =>
  call(c, p, "POST", `/contracts/${id}/product-links`, { links });
const products = () =>
  c.sql<{ name: string; from: string | null; supplier: string | null }[]>`select name,
    created_from_contract_id::text as from, main_supplier_name as supplier
    from contracts.products where tenant_id = ${T.acme} order by name`;

describe("products-confirm · đường gắn SP sau xác nhận bị khoá theo K4 (CR-127)", () => {
  it("HĐ đã xác nhận (K4 khoá gắn SP) ⇒ 409 CONTRACT_LOCKED, không tạo SP; chờ xác nhận ⇒ 409 CONTRACT_NOT_CONFIRMED; tenant khác ⇒ 404", async () => {
    await arrangeV2a(c);
    await setApproval(c.sql, T.acme, false);
    await c.sql`truncate contracts.products cascade`;
    const tape = await makeProduct(c, P.hoa, { name: "Băng keo", group: "goods" });
    const s = await seedReview(c, 1, {
      status: "active",
      deal: "buy",
      items: [
        { name: "Băng keo trong" },
        { name: "Thùng carton", unit: "thùng" },
        { name: "băng keo" },
      ],
    });
    const [a, b, dup] = s.items as [string, string, string];

    // chờ xác nhận ⇒ không tạo gì
    const pending = await seedReview(c, 2, { deal: "buy", items: [{ name: "Hàng chờ" }] });
    const r0 = await post(pending.id, [
      { item_id: pending.items[0], new_product: { name: "Hàng chờ", group: "goods" } },
    ]);
    expect([r0.status, r0.json.error.code]).toEqual([409, "CONTRACT_NOT_CONFIRMED"]);
    // tenant khác ⇒ 404
    expect((await post(s.id, [{ item_id: a, product_id: tape.id }], P.an)).status).toBe(404);
    expect((await products()).map((p) => p.name)).toEqual(["Băng keo"]);

    // CR-127 K4 (BR-02): SP gắn khi HĐ còn Nháp (qua "Xác nhận & lưu" kèm `products`); HĐ đã processing/done khoá gắn SP ⇒ 409, không tạo SP, không đổi dòng.
    const r = await post(s.id, [
      { item_id: a, product_id: tape.id },
      { item_id: b, new_product: { name: "Thùng carton 5 lớp", unit: "thùng", group: "goods" } },
      { item_id: dup, new_product: { name: "Băng keo", group: "goods" } },
    ]);
    expect([r.status, r.json?.error?.code]).toEqual([409, "CONTRACT_LOCKED"]);
    expect([...(await products())]).toEqual([{ name: "Băng keo", from: null, supplier: null }]);
    expect((await itemRows(c.sql, s.id)).map((i) => i.product_id)).toEqual([null, null, null]);
  });
});
