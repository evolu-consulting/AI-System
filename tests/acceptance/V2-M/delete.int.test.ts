// V2-M · BA v2 HD-07 · 5.5e · 6a · C7 — đường chính: chủ (contracts-owner) xem tác động rồi xoá HĐ BÁN (kho trả lại), HĐ MUA (kho trừ lại),
// HĐ dịch vụ (khách đang dùng + SP sinh từ HĐ bị gỡ, sổ đối tác bị huỷ) — hub-api THẬT in-process, MỘT tx mỗi lần xoá, một dòng audit.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  addDelivery,
  arrangeV2d,
  type CtxN1,
  call,
  comp,
  d,
  deal,
  item,
  movesOf,
  ok,
  P,
  product,
  settleRaw,
  startHd1,
  T,
} from "../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

async function delivered(sale: boolean, productId: string, qty: number, price: number) {
  const k = await deal(c.sql, { sale, end: d(365) });
  await item(c.sql, k, { qty, price, productId });
  await ok(settleRaw(c, await addDelivery(c, k)));
  return k;
}
const exists = async (table: string, col: string, id: string) =>
  (
    (await c.sql.unsafe(
      `select count(*)::int as n from contracts.${table} where ${col} = '${id}'`,
    )) as { n: number }[]
  )[0]?.n ?? 0;

describe("V2-M · xoá hợp đồng (owner)", () => {
  it("đảo kho + gỡ khách đang dùng / SP sinh từ HĐ + huỷ sổ đối tác + một dòng audit", async () => {
    await arrangeV2d(c);
    const g = await product(c.sql, { name: "Hàng V2M", grp: "goods" });
    const gc = g.comps[0] as string;
    const buy = await delivered(false, g.id, 10, 100);
    const sell = await delivered(true, g.id, 4, 150);
    expect(await comp(c.sql, gc)).toEqual({ onHand: 6, value: 600, avg: 100 });

    // xoá HĐ bán ⇒ hàng + giá vốn trả lại
    const pv = await ok(call(c, P.lan, "GET", `/contracts/${sell}/delete-preview`));
    expect([
      pv.milestones,
      pv.delivered_lines,
      (pv.stock as unknown[]).length,
      pv.appendices,
    ]).toEqual([1, 1, 1, 0]);
    const r1 = await ok(call(c, P.lan, "DELETE", `/contracts/${sell}`));
    expect([r1.deleted, r1.impact.stock_reversed]).toEqual([true, 1]);
    expect(await comp(c.sql, gc)).toEqual({ onHand: 10, value: 1000, avg: 100 });
    expect(await exists("contracts", "id", sell)).toBe(0);
    expect(await exists("obligations", "contract_id", sell)).toBe(0);
    expect(await exists("milestone_items", "contract_id", sell)).toBe(0);

    // xoá HĐ mua ⇒ kho trừ lại; sổ kho giữ nguyên (chỉ thêm dòng đảo)
    await ok(call(c, P.lan, "DELETE", `/contracts/${buy}`));
    expect(await comp(c.sql, gc)).toEqual({ onHand: 0, value: 0, avg: 100 });
    expect((await movesOf(c.sql, gc)).length).toBe(4);

    // HĐ bán dịch vụ: SP sinh từ HĐ + khách đang dùng + sự kiện đối tác
    const s = await product(c.sql, { name: "Dịch vụ V2M", grp: "service" });
    const svc = await deal(c.sql, { sale: true, partner: "Khách V2M", end: d(200) });
    await item(c.sql, svc, { qty: 1, price: 500, productId: s.id });
    await c.sql`update contracts.products set created_from_contract_id = ${svc} where id = ${s.id}`;
    await c.sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at, contract_id)
      values (${T.acme}, 'khach v2m', 'customer', 'delivered', current_date, ${svc})`;
    // phụ lục + việc hẹn của người khác + lô CKS gắn HĐ: xoá theo / gỡ liên kết
    const app = await deal(c.sql, { sale: true, end: d(100) });
    await c.sql`update contracts.contracts set kind = 'appendix', parent_id = ${svc} where id = ${app}`;
    await c.sql`insert into contracts.followups (tenant_id, user_id, subject_kind, subject_id, contract_id, due_at, title)
      values (${T.acme}, gen_random_uuid(), 'contract', ${svc}, ${svc}, now(), 'nhắc người khác')`;
    await c.sql`insert into contracts.cks_lots (tenant_id, label, ca, qty, unit_cost, bought_at, purchase_contract_id, created_by)
      values (${T.acme}, 'L', 'CA', 1, 1, current_date, ${svc}, gen_random_uuid())`;
    expect(await exists("service_customers", "contract_id", svc)).toBe(1);
    const pv3 = await ok(call(c, P.lan, "GET", `/contracts/${svc}/delete-preview`));
    expect([pv3.service_customers, pv3.products, pv3.partner_events]).toEqual([
      1,
      ["Dịch vụ V2M"],
      1,
    ]);
    // products-confirm: SP mồ côi chỉ xoá khi người xoá tick (mặc định giữ)
    expect(pv3.orphan_products).toEqual([{ id: s.id, name: "Dịch vụ V2M" }]);
    await ok(call(c, P.lan, "DELETE", `/contracts/${svc}`, { remove_products: [s.id] }));
    expect(await exists("contracts", "id", app)).toBe(0);
    expect(await exists("followups", "contract_id", svc)).toBe(0);
    expect(await exists("cks_lots", "purchase_contract_id", svc)).toBe(0);
    expect(await exists("service_customers", "contract_id", svc)).toBe(0);
    expect(await exists("products", "id", s.id)).toBe(0);
    const [v] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.partner_event_voids v
      join contracts.partner_events e on e.id = v.event_id and e.tenant_id = v.tenant_id where e.contract_id = ${svc}`;
    expect(v?.n).toBe(1);

    // đúng MỘT dòng audit mỗi HĐ (số, tên, người, lúc)
    const log = await c.sql<
      { title: string; by: string | null }[]
    >`select title, deleted_by::text as by
      from contracts.contract_delete_log where contract_id = ${svc}`;
    expect(log.length).toBe(1);
    expect(log[0]?.by).not.toBeNull();
  });
});
