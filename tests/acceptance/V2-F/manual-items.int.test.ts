// V2-F · BA §5.5a: dòng HĐ nhập tay gắn SP danh mục (V2-B) + thành phần đã chọn, qua hub-api THẬT. SP của tenant khác / không có ⇒ 422
// `PRODUCT_INVALID` (không tạo HĐ); thành phần không kèm SP ⇒ 400; viewer ⇒ 403. Danh sách `include=progress` trả thêm `start_date`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  detail,
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
const itemsOf = (id: string) =>
  c.sql<{ name: string; product_id: string | null; component_ids: string[] | null }[]>`
    select name, product_id::text, component_ids::text[] as component_ids
    from contracts.contract_items where contract_id = ${id} order by ord`;
const contractsCount = async () =>
  (await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contracts`)[0]?.n ?? 0;

describe("V2-F · 5.5a nhập tay: dòng gắn SP + thành phần", () => {
  it("lưu product_id + component_ids; dòng không gắn vẫn nhận (null)", async () => {
    const out = await ok(
      call(c, P.hoa, "POST", "/contracts/manual", {
        title: "HĐ mua token",
        partner_name: "Đối tác V2",
        deal: "buy",
        total_value: 9_750_000,
        items: [
          item({ product_id: tokenId, component_ids: [tokenCompId] }),
          item({ name: "Dòng chưa gắn" }),
        ],
      }),
    );
    expect(await itemsOf(out.id)).toEqual([
      { name: "USB Token trắng", product_id: tokenId, component_ids: [tokenCompId] },
      { name: "Dòng chưa gắn", product_id: null, component_ids: null },
    ]);
    const x = await detail(c, out.id);
    expect(x.items.map((i: Json) => [i.name, i.qty, i.unit_price])).toEqual([
      ["USB Token trắng", 50, 195_000],
      ["Dòng chưa gắn", 50, 195_000],
    ]);
  });

  it("SP không có hoặc của tenant khác ⇒ 422 PRODUCT_INVALID, không tạo HĐ", async () => {
    const before = await contractsCount();
    for (const product_id of [otherTenantProduct, "e1000000-0000-4000-8000-0000000000ff"]) {
      const r = await call(c, P.hoa, "POST", "/contracts/manual", {
        title: "HĐ sai SP",
        partner_name: "A",
        deal: "buy",
        items: [item({ product_id })],
      });
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe("PRODUCT_INVALID");
    }
    expect(await contractsCount()).toBe(before);
  });

  it("thành phần không kèm SP ⇒ 400; id không phải uuid ⇒ 400", async () => {
    for (const items of [
      [item({ component_ids: [tokenCompId] })],
      [item({ product_id: "không-phải-uuid" })],
      [item({ product_id: tokenId, component_ids: [] })],
    ]) {
      const r = await call(c, P.hoa, "POST", "/contracts/manual", {
        title: "HĐ",
        partner_name: "A",
        deal: "buy",
        items,
      });
      expect(r.status).toBe(400);
    }
  });

  it("viewer ⇒ 403 (guard quyền ghi trước khi đọc thân)", async () => {
    const r = await call(c, P.tam, "POST", "/contracts/manual", {
      title: "HĐ",
      partner_name: "A",
      deal: "buy",
      items: [item({ product_id: tokenId })],
    });
    expect(r.status).toBe(403);
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
