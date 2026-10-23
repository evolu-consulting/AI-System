// V2-F · BA §5.5a (nhập tay ngừng — CR-097): dòng HĐ nhập tay gắn SP danh mục (V2-B) + thành phần đã chọn, qua hub-api THẬT. SP của tenant khác / không có ⇒ 422
// `PRODUCT_INVALID` (không tạo HĐ); thành phần không kèm SP ⇒ 400; viewer ⇒ 403. Danh sách `include=progress` trả thêm `start_date`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  type Json,
  manual,
  ok,
  P,
  restoreApproval,
  setApproval,
  startHd1,
  T,
} from "../V2-A/_support/v2a";

let c: CtxN1;
let tokenId: string;
let tokenCompId: string;
let otherTenantProduct: string;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2a(c);
  await setApproval(c.sql, T.acme, false);
  await c.sql`truncate contracts.products cascade`;
  const mine = await ok(
    call(c, P.hoa, "POST", "/products", { name: "USB Token", unit: "cái", group: "goods" }),
  );
  tokenId = mine.id;
  tokenCompId = mine.components[0].id;
  const theirs = await ok(
    call(c, P.an, "POST", "/products", { name: "Sản phẩm beta", group: "goods" }),
  );
  otherTenantProduct = theirs.id;
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const item = (o: Json = {}) => ({
  name: "USB Token trắng",
  unit: "cái",
  qty: 50,
  unit_price: 195_000,
  ...o,
});
const contractsCount = async () =>
  (await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contracts`)[0]?.n ?? 0;

// CR-097 decision 1 (qc): tạo HĐ nhập tay đã ngừng ⇒ 410 kể cả khi dòng gắn SP hợp lệ; gắn SP cho dòng HĐ đi qua màn xác nhận
// (`PUT /contracts/:id/items/:itemId/product`, test V2-G / products-confirm).
describe("V2-F · 5.5a nhập tay (ngừng theo CR-097)", () => {
  it("dòng gắn SP + thành phần ⇒ 410 MANUAL_CONTRACT_DISABLED, không tạo HĐ; viewer ⇒ 403", async () => {
    const before = await contractsCount();
    const r = await call(c, P.hoa, "POST", "/contracts/manual", {
      title: "HĐ mua token",
      partner_name: "Đối tác V2",
      deal: "buy",
      total_value: 9_750_000,
      items: [item({ product_id: tokenId, component_ids: [tokenCompId] })],
    });
    expect([r.status, r.json?.error?.code]).toEqual([410, "MANUAL_CONTRACT_DISABLED"]);
    expect(await contractsCount()).toBe(before);
    const v = await call(c, P.tam, "POST", "/contracts/manual", { title: "HĐ", partner_name: "A" });
    expect(v.status).toBe(403);
    expect(otherTenantProduct).toBeTruthy();
  });
});
describe("V2-F · HD-03 danh sách include=progress mang start_date", () => {
  it("start_date của HĐ có trong từng dòng progress (null khi chưa có)", async () => {
    await c.sql`delete from contracts.contract_items`;
    const a = await manual(c, { deal: "sell", total_value: 1, start_date: d(5), end_date: d(40) });
    const b = await manual(c, { deal: "buy", total_value: 1 });
    const list = await ok(call(c, P.hoa, "GET", "/contracts?include=progress&page_size=50"));
    const byId = new Map<string, Json>(list.progress.map((p: Json) => [p.id, p]));
    expect(byId.get(a.id)?.start_date).toBe(d(5));
    expect(byId.get(b.id)?.start_date).toBeNull();
  });
});
