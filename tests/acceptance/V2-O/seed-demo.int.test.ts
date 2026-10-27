// V2-O · nạp lại bộ mẫu v2 cho tenant demo: chạy 2 lần ra cùng số liệu (lặp lại được), không đụng tenant khác, từ chối khoá khác `demo`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { seedDemo } from "../../../tools/scripts/src/seed-demo-v2";
import { type World, world } from "../V2-B/_support/v2b";

let w: World;
beforeAll(async () => {
  w = await world({ ns: 2701 });
  await w.sql`update admin.tenants set key = 'demo' where id = ${w.A}`;
}, 180_000);
afterAll(async () => {
  await w?.stop();
});

const TODAY = "2026-10-21";
describe("V2-O · seed demo v2", () => {
  it("nạp 2 lần ⇒ cùng số liệu; tenant B nguyên vẹn; SP có tồn; khách đang dùng + vai đối tác có", async () => {
    const ids = { tenantId: w.A, tenantKey: "demo", owner: w.boss, editor: w.u1 };
    const bBefore =
      await w.sql`select count(*)::int as n from contracts.contracts where tenant_id = ${w.B}`;
    const one = await seedDemo(w.sql, ids, TODAY);
    const two = await seedDemo(w.sql, ids, TODAY);
    expect(two).toEqual(one);
    // D1: +1 HĐ (chuỗi phiên bản c6 v1 → v2); CR-101 DOC-deals: +2 giao dịch (chứng từ `deal`, thay bảng G1 chỉ đọc)
    expect(one).toMatchObject({ products: 7, contracts: 19 });
    const [deals] = await w.sql<{ n: number }[]>`select count(*)::int as n from contracts.contracts
      where tenant_id = ${w.A} and doc_type = 'deal' and locked_at is null`;
    expect(deals?.n).toBe(2);
    expect(one.partner_roles).toBeGreaterThanOrEqual(10);
    expect(one.service_customers).toBeGreaterThanOrEqual(5);
    const bAfter =
      await w.sql`select count(*)::int as n from contracts.contracts where tenant_id = ${w.B}`;
    expect(bAfter[0]?.n).toBe(bBefore[0]?.n);
    const [s] = await w.sql<
      { on_hand: string }[]
    >`select on_hand::text from contracts.product_components
      where tenant_id = ${w.A} and name = 'Băng keo 5cm'`;
    expect(Number(s?.on_hand)).toBe(320);
    const [r] = await w.sql<{ n: number }[]>`select renewals as n from contracts.service_customers
      where tenant_id = ${w.A} and customer_name like '%An Phú%'`;
    expect(r?.n).toBe(1);
  });

  it("từ chối tenant khoá khác demo (cả khi khai khoá là demo nhưng DB nói khác)", async () => {
    await expect(
      seedDemo(w.sql, { tenantId: w.B, tenantKey: "nitigroup", owner: w.b1, editor: w.b1 }, TODAY),
    ).rejects.toThrow(/chỉ nạp cho tenant/);
    await expect(
      seedDemo(w.sql, { tenantId: w.B, tenantKey: "demo", owner: w.b1, editor: w.b1 }, TODAY),
    ).rejects.toThrow(/chỉ nạp cho tenant/);
  });
});
