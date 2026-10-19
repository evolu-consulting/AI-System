// HD7-FR-11 · HD7-AC07 · thay D9-08: CKS lập đợt như mgmt-app (`cks/sales.py:58`, `lots.py:33`, `sales.py:102`, `sales.py:146-148`)
// và nhóm bán `paid` = có đợt và mọi đợt đã xong (`cks/overview.py:39`). Tiền = số chữ ký × giá, bigint đồng. Viết TRƯỚC code.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeCks, customerNamed, d, kcall, world } from "../HD9/_support/hd9";
import { type CtxN1, call, type Json, needHd7, ok, P, startHd1 } from "./_support/hd7";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

async function fresh() {
  await needHd7(c.sql);
  await c.sql`truncate contracts.partner_event_voids, contracts.partner_events, contracts.obligations`;
  await arrangeCks(c);
  return world(c);
}
const obs = (contractId: string) =>
  ok(call(c, P.hoa, "GET", `/obligations?contract_id=${contractId}`));

describe("HD7-AC07 · CKS lập đợt + `paid`", () => {
  it("bán 3 chữ ký × 1.650.000 ⇒ 1 đợt thu 4.950.000 hạn ngày ký; chưa thu ⇒ paid=false; thu ⇒ paid=true", async () => {
    const w = await fresh();
    const [o] = await obs(w.bv.contract_id);
    expect([o.amount, o.due_date, o.direction, o.source, o.seq, o.party]).toEqual([
      4_950_000,
      d(-356),
      "receive",
      "cks",
      1,
      "tax:0312340001",
    ]);
    const before = await customerNamed(c, "Bếp Việt");
    expect(before.sales.map((s: Json) => s.paid)).toEqual([false]);
    await ok(call(c, P.hoa, "POST", `/obligations/${o.id}/settle`, {}));
    const after = await customerNamed(c, "Bếp Việt");
    expect(after.sales.map((s: Json) => [s.paid, s.total])).toEqual([[true, 4_950_000]]);
  });

  it("lô 5 × 1.100.000 ⇒ đợt trả 5.500.000 hạn ngày mua; chữ ký tự mua nơi khác ⇒ không đợt", async () => {
    const w = await fresh();
    const [lot] = await c.sql<
      { id: string }[]
    >`select purchase_contract_id::text as id from contracts.cks_lots
      where id = ${w.lot.id}`;
    const [o] = await obs(lot?.id as string);
    expect([o.amount, o.due_date, o.direction, o.source]).toEqual([
      5_500_000,
      d(-200),
      "pay",
      "cks",
    ]);
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.obligations`;
    expect(n?.n).toBe(3); // lô + 2 nhóm bán
  });

  it("gia hạn ⇒ đợt hạn hôm nay + 15 (số chữ ký × giá); mất khách ⇒ đợt của HĐ gia hạn bị huỷ (cancelled)", async () => {
    const w = await fresh();
    const ren = await ok(
      kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, { price_each: 1_700_000 }),
    );
    const [o] = await obs(ren.new_contract_id);
    expect([o.amount, o.due_date, o.status]).toEqual([5_100_000, d(15), "open"]);
    await ok(kcall(c, P.hoa, "POST", `/renewals/${ren.id}/lost`, { reason: "mua nơi khác" }));
    expect((await obs(ren.new_contract_id)).map((x: Json) => x.status)).toEqual(["cancelled"]);
  });
});
