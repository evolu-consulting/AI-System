// delivery-opts · đường chính: (1) đợt giao theo % — mốc ghi %, xác nhận ⇒ SL dòng = làm tròn(% × SL HĐ), đợt cuối lấy phần còn lại;
// (2) cho phép giao vượt tồn — tắt (mặc định) ⇒ 409 STOCK_INSUFFICIENT; bật qua `PUT /company` ⇒ xác nhận được, tồn âm, cảnh báo + sổ
// ghi `overdrawn`. Xác nhận = `POST /obligations/:id/settle` THẬT (như V2-D). VIẾT, CHƯA CHẠY trong lát.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2d,
  type CtxN1,
  call,
  comp,
  d,
  deal,
  deliveredOf,
  item,
  ok,
  P,
  product,
  settleRaw,
  startHd1,
  stockIn,
} from "../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const addPct = (contractId: string, pct: number) =>
  ok(
    call(c, P.hoa, "POST", `/contracts/${contractId}/milestones`, {
      kind: "delivery",
      due_date: d(3),
      pct,
    }),
  );

describe("delivery-opts · đợt giao theo %", () => {
  it("30% rồi 70% (đợt cuối) trên HĐ bán 10 cái ⇒ 3 rồi 7; view hiện SL tính sẵn", async () => {
    await arrangeV2d(c);
    const p = await product(c.sql, { name: "Băng keo 5cm", grp: "goods" });
    await stockIn(c, p.id, 100, 10_000);
    const k = await deal(c.sql, { sale: true });
    const line = await item(c.sql, k, { qty: 10, price: 20_000, productId: p.id });
    const m1 = await addPct(k, 30);
    expect(m1.pct).toBe(30);

    const v = await ok(call(c, P.hoa, "GET", `/milestones/${m1.id}/delivery`));
    expect(v.pct).toBe(30);
    expect(v.rows[0]).toMatchObject({ item_id: line, this_time: "3", remaining: "10" });

    await ok(settleRaw(c, m1.id));
    expect(await deliveredOf(c.sql, line)).toBe(3);
    const m2 = await addPct(k, 70);
    await ok(settleRaw(c, m2.id));
    expect(await deliveredOf(c.sql, line)).toBe(10);
    expect(await comp(c.sql, p.comps[0] as string)).toMatchObject({ onHand: 90 });
  });

  it("% và SL chung không đi cùng nhau; % chỉ cho mốc Giao hàng ⇒ 422", async () => {
    await arrangeV2d(c);
    const k = await deal(c.sql, { sale: true });
    const both = await call(c, P.hoa, "POST", `/contracts/${k}/milestones`, {
      kind: "delivery",
      due_date: d(3),
      pct: 30,
      qty: 5,
    });
    const wrongKind = await call(c, P.hoa, "POST", `/contracts/${k}/milestones`, {
      kind: "other",
      due_date: d(3),
      pct: 30,
    });
    expect([both.status, wrongKind.status]).toEqual([422, 422]);
  });
});

const company = (allow: boolean) => ({
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "auto",
  own_names: [],
  own_tax_ids: [],
  approval_enabled: false,
  allow_negative_stock: allow,
});

describe("delivery-opts · giao vượt tồn", () => {
  it("mặc định tắt ⇒ 409; bật ⇒ giao được, tồn -30, cảnh báo + sổ overdrawn; tắt lại ⇒ 409", async () => {
    await arrangeV2d(c);
    await c.sql`delete from contracts.approval_settings`;
    const p = await product(c.sql, { name: "Băng keo 5cm", grp: "goods" });
    const cid = p.comps[0] as string;
    await stockIn(c, p.id, 20, 10_000);
    const k = await deal(c.sql, { sale: true });
    await item(c.sql, k, { qty: 50, price: 20_000, productId: p.id });
    const m = (
      await ok(
        call(c, P.hoa, "POST", `/contracts/${k}/milestones`, { kind: "delivery", due_date: d(3) }),
      )
    ).id;

    const blocked = await settleRaw(c, m);
    expect([blocked.status, blocked.json?.error?.code]).toEqual([409, "STOCK_INSUFFICIENT"]);

    const saved = await ok(call(c, P.lan, "PUT", "/company", company(true)));
    expect(saved.allow_negative_stock).toBe(true);
    const r = await ok(settleRaw(c, m));
    expect(r.status).toBe("done");
    expect(r.delivery.overdrawn).toEqual([
      { component_id: cid, name: "Băng keo 5cm", need: "50", have: "20" },
    ]);
    expect(r.delivery.notes).toContain("giao vượt tồn 30: Băng keo 5cm (cần 50, còn 20)");
    expect(await comp(c.sql, cid)).toEqual({ onHand: -30, value: 0, avg: 10_000 });
    const [mv] = await c.sql<
      { overdrawn: string }[]
    >`select overdrawn::text from contracts.stock_moves
      where component_id = ${cid} and direction = 'out'`;
    expect(Number(mv?.overdrawn)).toBe(30);

    await ok(call(c, P.lan, "PUT", "/company", company(false)));
    const k2 = await deal(c.sql, { sale: true });
    await item(c.sql, k2, { qty: 5, price: 20_000, productId: p.id });
    const m2 = (
      await ok(
        call(c, P.hoa, "POST", `/contracts/${k2}/milestones`, { kind: "delivery", due_date: d(3) }),
      )
    ).id;
    expect((await settleRaw(c, m2)).status).toBe(409);
  });
});
