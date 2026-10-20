// HD8-FR-05…07 · HD8-AC05…AC07 · M1D-FR-01: so giá hàng hoá (parity NGUYÊN VĂN mgmt-app `tests/test_prices.py`), khách CKS nối đối
// tác (`cks_customers.party_key`) + dòng uy tín `cks_renewed`/`cks_lapsed` (`cks/sales.py:130-145`), và luật thấy M1 trên sổ đối tác
// (`test_a_member_neither_sees_nor_undoes_what_was_recorded_on_contracts_outside_their_view`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeCks, kcall, world } from "../HD9/_support/hd9";
import {
  ago,
  arrangeHd8,
  type CtxN1,
  call,
  d,
  deal,
  items,
  type Json,
  ok,
  P,
  record,
  startHd1,
  T,
} from "./_support/hd8";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const PORK = "name:thit heo|";
const enc = encodeURIComponent;

/** `pork` fixture: HĐ mua thịt heo 98.000 đ/kg của Bình An + 4 lần giao đúng hạn. */
async function pork() {
  await arrangeHd8(c);
  const id = await deal(c.sql, {
    sale: false,
    partner: "Thực phẩm Sạch Bình An",
    tax: "0322223333",
    number: "TH-1",
  });
  await items(c.sql, T.acme, id, [{ name: "Thịt heo", unit: "kg", qty: 6000, unit_price: 98_000 }]);
  for (let i = 0; i < 4; i++)
    await record(c.sql, T.acme, "tax:0322223333", "supplier", "delivered", ago(10 + i * 20), {
      days_late: 0,
    });
  return id;
}

describe("HD8-AC05 · so giá một mặt hàng (test_prices.py)", () => {
  it("mặt hàng để so = thứ NCC bán cho mình", async () => {
    await pork();
    const got: Json[] = await ok(call(c, P.tam, "GET", "/prices/products"));
    expect(got.map((p: Json) => [p.key, p.label])).toEqual([[PORK, "Thịt heo (đ/kg)"]]);
  });

  it("giá HĐ trước, báo giá NCC mới đánh dấu MỚI; báo giá mới hơn thay báo giá cũ; viewer 403; tenant khác 404", async () => {
    await pork();
    const q = {
      product: PORK,
      supplier_name: "Thực phẩm Hưng Phát",
      price: 94_500,
      quoted_at: "2026-10-10",
    };
    expect((await call(c, P.hoa, "POST", "/prices/quotes", q)).status).toBe(201);
    expect(
      (await call(c, P.tam, "POST", "/prices/quotes", { ...q, supplier_name: "X", price: 1 }))
        .status,
    ).toBe(403);
    const cmp = await ok(call(c, P.lan, "GET", `/prices/compare?product=${enc(PORK)}`));
    const [first, quote] = cmp.rows;
    expect([first.supplier, first.price, first.source.type, first.is_new]).toEqual([
      "Thực phẩm Sạch Bình An",
      98_000,
      "contract",
      false,
    ]);
    expect(first.score).not.toBeNull();
    expect(first.band).toBe("good");
    expect([
      quote.supplier,
      quote.price,
      quote.source.type,
      quote.is_new,
      quote.source.date,
    ]).toEqual(["Thực phẩm Hưng Phát", 94_500, "quote", true, "2026-10-10"]);
    expect(cmp.product).toEqual({ key: PORK, label: "Thịt heo", unit: "kg" });
    await ok(
      call(c, P.hoa, "POST", "/prices/quotes", { ...q, price: 94_000, quoted_at: "2026-10-12" }),
    );
    const again = await ok(call(c, P.lan, "GET", `/prices/compare?product=${enc(PORK)}`));
    expect(again.rows.map((r: Json) => r.price)).toEqual([98_000, 94_000]);
    expect(again.market).toEqual({ status: "tbd" });
    expect((await call(c, P.an, "GET", `/prices/compare?product=${enc(PORK)}`)).status).toBe(404);
    expect(
      (await call(c, P.an, "POST", "/prices/quotes", { ...q, supplier_name: "X", price: 1 }))
        .status,
    ).toBe(404);
    // review HD78 #2: xoá báo giá cần quản lý (editor ⇒ 403)
    expect((await call(c, P.hoa, "DELETE", `/prices/quotes/${quote.source.quote_id}`)).status).toBe(
      403,
    );
    const del = await ok(call(c, P.lan, "DELETE", `/prices/quotes/${quote.source.quote_id}`));
    expect(del).toEqual({ ok: true });
  });

  it("báo giá NCC không MST = đối tác cùng tên đã có (không sinh «Bình An» thứ hai); NCC đắt hơn ⇒ điểm giá thấp hơn", async () => {
    const id = await pork();
    await ok(
      call(c, P.hoa, "POST", "/prices/quotes", {
        product: PORK,
        supplier_name: "thực phẩm sạch bình an",
        price: 90_000,
        quoted_at: "2026-10-11",
      }),
    );
    const [q] = await c.sql<
      { k: string }[]
    >`select supplier_party_key as k from contracts.price_quotes`;
    expect(q?.k).toBe("tax:0322223333");
    // HĐ đang áp dụng là giá thật ⇒ báo giá của cùng NCC không thay dòng HĐ.
    const cmp = await ok(call(c, P.lan, "GET", `/prices/compare?product=${enc(PORK)}`));
    expect(cmp.rows.map((r: Json) => [r.price, r.source.type])).toEqual([[98_000, "contract"]]);
    // test_scoring_ratings L106-110: NCC thứ hai rẻ hơn 10% ⇒ Bình An "Đắt hơn …%"
    const other = await deal(c.sql, { sale: false, partner: "Heo Rẻ", tax: "0322224444" });
    await items(c.sql, T.acme, other, [{ name: "Thịt heo", unit: "kg", unit_price: 89_090 }]);
    const sc = await ok(
      call(c, P.lan, "GET", `/partners/score?party=${enc("tax:0322223333")}&role=supplier`),
    );
    expect(sc.breakdown.price.detail).toBe("Đắt hơn 10.0%");
    expect(sc.breakdown.price.value).toBe(50);
    expect(id).toBeString();
  });
});

describe("HD8-AC06 · khách CKS là đối tác; gia hạn/mất khách ghi sổ uy tín (cks/sales.py:130-145)", () => {
  it("gia hạn xong ⇒ mỗi chữ ký một cks_renewed (còn 9 ngày ⇒ 100); mất khách ⇒ cks_lapsed + lý do", async () => {
    await arrangeHd8(c);
    await arrangeCks(c);
    const w = await world(c);
    const [cu] = await c.sql<{ p: string }[]>`select party_key as p from contracts.cks_customers
      where tenant_id = ${T.acme} and tax_id = '0312340001'`;
    expect(cu?.p).toBe("tax:0312340001");
    const ren = await ok(
      kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, { price_each: 1_700_000 }),
    );
    await ok(
      kcall(c, P.hoa, "POST", `/renewals/${ren.id}/complete`, { serials: {}, valid_to: null }),
    );
    const evs: Json[] = await ok(
      call(c, P.hoa, "GET", `/partner-events?party=${enc("tax:0312340001")}`),
    );
    const renewed = evs.filter((e: Json) => e.type === "cks_renewed");
    expect(renewed.map((e: Json) => [e.days_before_expiry, e.with_us, e.role, e.at])).toEqual(
      Array.from({ length: 3 }, () => [9, true, "customer", d(0)]),
    );
    expect(renewed[0].by_name).toBeString();
    const sc = await ok(
      call(c, P.lan, "GET", `/partners/score?party=${enc("tax:0312340001")}&role=customer`),
    );
    expect(sc.breakdown.cks_renewal).toMatchObject({
      value: 100,
      detail: "3 lần gia hạn chữ ký số",
    });

    const ren2 = await ok(kcall(c, P.hoa, "POST", `/groups/${w.ba.contract_id}/renew`, {}));
    await ok(kcall(c, P.hoa, "POST", `/renewals/${ren2.id}/lost`, { reason: "mua nơi khác" }));
    const ba: Json[] = await ok(
      call(c, P.hoa, "GET", `/partner-events?party=${enc("tax:0312340002")}`),
    );
    expect(
      ba.filter((e: Json) => e.type === "cks_lapsed").map((e: Json) => [e.note, e.contract_id]),
    ).toEqual([["mua nơi khác", w.ba.contract_id]]);
  });
});

describe("HD8-AC07 · M1: thành viên không thấy, không huỷ việc trên HĐ ngoài phạm vi (chế độ org)", () => {
  it("editor chỉ thấy đối tác/sổ của HĐ mình; huỷ việc trên HĐ của người khác ⇒ 404; owner thấy hết", async () => {
    await arrangeHd8(c);
    const theirs = await deal(c.sql, {
      sale: true,
      partner: "Chung Hai Người",
      tax: "0355557777",
      number: "CH-1",
    });
    const mine = await deal(c.sql, {
      sale: true,
      partner: "Chung Hai Người",
      tax: "0355557777",
      number: "CH-2",
    });
    const solo = await deal(c.sql, { sale: true, partner: "Chỉ Của Lan", tax: "0355558888" });
    await c.sql`update contracts.contracts set owner_user_id = ${P.hoa.id} where id = ${mine}`;
    const party = "tax:0355557777";
    await record(c.sql, T.acme, party, "customer", "complaint", ago(3), {
      contract_id: theirs,
      by: P.lan.id,
    });
    await record(c.sql, T.acme, party, "customer", "appointment_kept", ago(2), {
      contract_id: mine,
      by: P.hoa.id,
    });
    await ok(call(c, P.lan, "PUT", "/visibility", { mode: "org" }));
    try {
      const evs: Json[] = await ok(call(c, P.hoa, "GET", `/partner-events?party=${enc(party)}`));
      expect(evs.map((e: Json) => e.contract_id)).toEqual([mine]);
      const [hidden] = await c.sql<{ id: string }[]>`select id::text from contracts.partner_events
        where contract_id = ${theirs}`;
      expect((await call(c, P.hoa, "POST", `/partner-events/${hidden?.id}/void`, {})).status).toBe(
        404,
      );
      const names = (await ok(call(c, P.hoa, "GET", "/partners"))).map((p: Json) => p.name);
      expect(names).toEqual(["Chung Hai Người"]);
      const all = (await ok(call(c, P.lan, "GET", "/partners"))).map((p: Json) => p.name).sort();
      expect(all).toEqual(["Chung Hai Người", "Chỉ Của Lan"].sort());
      expect((await ok(call(c, P.lan, "GET", `/partner-events?party=${enc(party)}`))).length).toBe(
        2,
      );
      expect(solo).toBeString();
    } finally {
      await c.sql`update contracts.visibility_settings set mode = 'tenant'`;
    }
  });
});
