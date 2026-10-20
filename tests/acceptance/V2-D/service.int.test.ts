// V2-D · BA v2 §5.8a/b — HĐ Bán SP Dịch vụ có hạn tạo dòng "khách đang dùng" ngay khi lưu (hạn = ngày kết thúc HĐ); HĐ bán mới
// cùng khách + SP = gia hạn: thay hạn, đếm vào "Gia hạn qua mình" (`renewals`, `prev_contract_id`). Viết TRƯỚC code. HĐ/dòng ghi
// bằng owner (trigger trì hoãn tới cuối tx chạy như mọi đường lưu).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2d,
  type CtxN1,
  d,
  deal,
  item,
  product,
  type Sql,
  startHd1,
  T,
} from "./_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

async function rows(sql: Sql) {
  return sql<
    {
      product_id: string;
      party_key: string;
      customer_name: string | null;
      contract_id: string;
      expires_on: string | null;
      renewals: number;
      prev_contract_id: string | null;
    }[]
  >`select product_id::text, party_key, customer_name, contract_id::text, to_char(expires_on, 'YYYY-MM-DD') as expires_on,
      renewals, prev_contract_id::text
    from contracts.service_customers order by created_at, product_id`;
}

describe("V2-D · khách đang dùng (5.8a)", () => {
  it("HĐ bán SP dịch vụ có hạn ⇒ một dòng khách, hạn = ngày kết thúc HĐ", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Chứng thư số 1 năm", grp: "service" });
    const end = d(365);
    const k = await deal(c.sql, { sale: true, partner: "Công ty Khách A", tax: "0312345678", end });
    await item(c.sql, k, { qty: 1, price: 500_000, productId: p.id });
    expect(await rows(c.sql)).toEqual([
      {
        product_id: p.id,
        party_key: "tax:0312345678",
        customer_name: "Công ty Khách A",
        contract_id: k,
        expires_on: end,
        renewals: 0,
        prev_contract_id: null,
      },
    ]);
  });

  it("không tạo dòng: HĐ mua, SP hàng hoá, HĐ chưa lưu (chờ duyệt); lưu xong mới tạo", async () => {
    await arrangeV2d(c);
    const svc = await product(c.sql, { name: "Hosting 1 năm", grp: "service" });
    const goods = await product(c.sql, { name: "Băng keo", grp: "goods" });
    const buy = await deal(c.sql, { sale: false, end: d(300) });
    await item(c.sql, buy, { qty: 1, price: 1, productId: svc.id });
    const g = await deal(c.sql, { sale: true, end: d(300) });
    await item(c.sql, g, { qty: 1, price: 1, productId: goods.id });
    const draft = await deal(c.sql, {
      sale: true,
      end: d(300),
      status: "needs_review",
      partner: "Khách B",
    });
    await item(c.sql, draft, { qty: 1, price: 1, productId: svc.id });
    expect(await rows(c.sql)).toEqual([]);
    await c.sql`update contracts.contracts set status = 'active' where id = ${draft}`;
    expect((await rows(c.sql)).map((r) => r.contract_id)).toEqual([draft]);
  });

  it("sửa ngày kết thúc của chính HĐ đó ⇒ hạn đổi theo, không tính gia hạn", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Chứng thư số 1 năm", grp: "service" });
    const k = await deal(c.sql, { sale: true, partner: "Khách C", end: d(100) });
    await item(c.sql, k, { qty: 1, price: 1, productId: p.id });
    const end = d(200);
    await c.sql`update contracts.contracts
      set fields = jsonb_set(fields, '{end_date}', ${c.sql.json({ value: end, quote: "", verified: true, edited: true })})
      where id = ${k}`;
    const [r] = await rows(c.sql);
    expect([r?.expires_on, r?.renewals]).toEqual([end, 0]);
  });
});

describe("V2-D · gia hạn (5.8b)", () => {
  it("HĐ bán mới cùng khách + SP ⇒ thay hạn, renewals 1, nhớ HĐ trước; lưu lại HĐ mới không đếm lần nữa", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Chứng thư số 1 năm", grp: "service" });
    const k1 = await deal(c.sql, { sale: true, partner: "Khách D", tax: "0399999999", end: d(30) });
    await item(c.sql, k1, { qty: 1, price: 1, productId: p.id });
    const end2 = d(395);
    const k2 = await deal(c.sql, { sale: true, partner: "Khách D", tax: "0399999999", end: end2 });
    await item(c.sql, k2, { qty: 1, price: 1, productId: p.id });
    await c.sql`update contracts.contracts set status = 'expiring' where id = ${k2}`;
    expect(await rows(c.sql)).toEqual([
      expect.objectContaining({
        contract_id: k2,
        expires_on: end2,
        renewals: 1,
        prev_contract_id: k1,
      }),
    ]);
    // HĐ cũ được sửa sau đó không giành lại dòng khách.
    await c.sql`update contracts.contracts set status = 'renewed' where id = ${k1}`;
    expect((await rows(c.sql)).map((r) => [r.contract_id, r.renewals])).toEqual([[k2, 1]]);
  });

  it("khách khác hoặc SP khác ⇒ dòng riêng, không tính gia hạn; tenant khác tách biệt", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Chứng thư số 1 năm", grp: "service" });
    const q = await product(c.sql, { name: "Hosting 1 năm", grp: "service" });
    const pb = await product(c.sql, { name: "Chứng thư số 1 năm", grp: "service", tenant: T.beta });
    const k1 = await deal(c.sql, { sale: true, partner: "Khách E", end: d(60) });
    await item(c.sql, k1, { qty: 1, price: 1, productId: p.id });
    await item(c.sql, k1, { qty: 1, price: 1, productId: q.id });
    const k2 = await deal(c.sql, { sale: true, partner: "Khách F", end: d(90) });
    await item(c.sql, k2, { qty: 1, price: 1, productId: p.id });
    const kb = await deal(c.sql, { sale: true, partner: "Khách E", end: d(60), tenant: T.beta });
    await item(c.sql, kb, { qty: 1, price: 1, productId: pb.id, tenant: T.beta });
    const all = await rows(c.sql);
    expect(all).toHaveLength(4);
    expect(all.every((r) => r.renewals === 0)).toBe(true);
  });
});
