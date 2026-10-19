// HD-FR-91 · HD-FR-92 · HD-FR-93 · HD-FR-94 · HD-FR-96 · BR-1 · BR-2 · BR-8 · HD9-AC01…AC04, AC06: tiền (số nguyên đồng), tồn kho,
// số HĐ, nhật ký giá cùng tx, gia hạn, giá gói mua–bán. Số kỳ vọng = `mgmt-app/api/tests/test_cks.py` + `app/prices/cks.py`.
// Viết TRƯỚC code (làn đầy đủ, phần tiền): trước khi có route ⇒ đỏ ở 404/expect, không đỏ ở dựng dữ liệu.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeCks,
  audit,
  type CtxN1,
  customerNamed,
  d,
  kcall,
  ok,
  P,
  startHd1,
  T,
  world,
} from "./_support/hd9";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("HD-FR-91 · lô mua", () => {
  it("HD9-AC01 · tạo lô ⇒ HĐ mua LO-<nhãn> active (1 dòng hàng, tổng = qty × giá vốn), tồn = qty, nhật ký giá", async () => {
    await arrangeCks(c);
    const lot = await ok(
      kcall(c, P.hoa, "POST", "/lots", {
        ca: "Viettel-CA",
        qty: 5,
        unit_cost: 1_100_000,
        bought_at: "2026-03-02",
        device: "token",
      }),
    );
    expect(lot).toMatchObject({
      label: "2026-03",
      ca: "Viettel-CA",
      qty: 5,
      unit_cost: 1_100_000,
      years: 1,
      device: "token",
      sold: 0,
      customers: 0,
      in_stock: 5,
      margin: null,
    });
    const [k] =
      await c.sql`select tenant_id, direction, status, number, value, title from contracts.contracts
      where id = ${lot.purchase_contract_id}`;
    expect(k).toEqual({
      tenant_id: T.acme,
      direction: "purchase",
      status: "active",
      number: "LO-2026-03",
      value: "5500000",
      title: "Mua lô 5 chữ ký · 2026-03",
    });
    const items =
      await c.sql`select name, unit, qty::text, unit_price::text from contracts.contract_items
      where contract_id = ${lot.purchase_contract_id}`;
    expect(items).toEqual([
      { name: "Chữ ký số Viettel-CA 1 năm", unit: "chữ ký", qty: "5.0000", unit_price: "1100000" },
    ]);
    expect(await audit(c.sql)).toEqual([
      { entity: "lot", field: "unit_cost", old_value: null, new_value: "1100000", actor: P.hoa.id },
    ]);
  });
  it("BR-1 · tiền phải là số nguyên đồng trong [0, 10¹⁰]: số lẻ, âm, quá trần, chuỗi ⇒ 400; không ghi gì", async () => {
    await arrangeCks(c);
    const base = { ca: "Viettel-CA", qty: 5, bought_at: "2026-03-02", device: "token" };
    for (const unit_cost of [1.5, -1, 10_000_000_001, "1100000"]) {
      const r = await kcall(c, P.hoa, "POST", "/lots", { ...base, unit_cost });
      expect({ unit_cost, status: r.status }).toEqual({ unit_cost, status: 400 });
    }
    const [n] = await c.sql`select count(*)::int as n from contracts.cks_lots`;
    expect(n?.n).toBe(0);
  });
});

describe("HD-FR-92 · bán chữ ký", () => {
  it("HD9-AC02 · bán 3 người giữ ⇒ HĐ CKS-<năm>-001 bán ra (tổng 3 × giá), 3 chữ ký active, tồn giảm; số kế tiếp -002", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const year = d(-356).slice(0, 4);
    expect(w.bv.number).toBe(`CKS-${year}-001`);
    expect(w.ba.number).toBe(
      `CKS-${d(-371).slice(0, 4)}-${year === d(-371).slice(0, 4) ? "002" : "001"}`,
    );
    const [k] =
      await c.sql`select direction, status, value, end_date::text, fields -> 'buyer_name' ->> 'value' as buyer,
      fields -> 'buyer_tax_id' ->> 'value' as tax, fields -> 'notice_days' ->> 'value' as notice
      from contracts.contracts where id = ${w.bv.contract_id}`;
    expect(k).toEqual({
      direction: "sale",
      status: "active",
      value: "4950000",
      end_date: d(9),
      buyer: "Bếp Việt",
      tax: "0312340001",
      notice: "30",
    });
    const certs =
      await c.sql`select status, sale_price::text, source from contracts.cks_certificates
      where sale_contract_id = ${w.bv.contract_id}`;
    expect(certs).toHaveLength(3);
    expect(new Set(certs.map((x) => `${x.status}|${x.sale_price}|${x.source}`))).toEqual(
      new Set(["active|1650000|ours"]),
    );
    const lots = (await kcall(c, P.tam, "GET", "/lots")).json;
    expect(lots.map((l: { in_stock: number }) => l.in_stock)).toEqual([1]);
  });
  it("HD9-AC02 · quá tồn ⇒ 409 CKS_STOCK; serial đã có (khác cách viết) ⇒ 409 CKS_SERIAL_TAKEN; hạn ≤ ngày ký ⇒ 422 CKS_DATES; không ghi gì", async () => {
    await arrangeCks(c);
    const { lot } = await world(c);
    const before = await c.sql`select count(*)::int as n from contracts.contracts`;
    const sale = (holders: unknown[], extra: Record<string, unknown> = {}) =>
      kcall(c, P.hoa, "POST", "/sales", {
        company_name: "X",
        lot_id: lot.id,
        price_each: 1,
        signed_at: d(0),
        valid_to: d(365),
        holders,
        ...extra,
      });
    const two = await sale([
      { name: "A", device: "token" },
      { name: "B", device: "token" },
    ]);
    expect({ s: two.status, code: two.json?.error?.code }).toEqual({ s: 409, code: "CKS_STOCK" });
    const taken = await sale([{ name: "A", device: "token", serial: "54:01:0b:72:33:af:9e:10" }]);
    expect({ s: taken.status, code: taken.json?.error?.code }).toEqual({
      s: 409,
      code: "CKS_SERIAL_TAKEN",
    });
    const dup = await sale([{ name: "A", device: "token", serial: "FPT-1" }]);
    expect(dup.status).toBe(409);
    const dates = await sale([{ name: "A", device: "token" }], { valid_to: d(0) });
    expect({ s: dates.status, code: dates.json?.error?.code }).toEqual({
      s: 422,
      code: "CKS_DATES",
    });
    const after = await c.sql`select count(*)::int as n from contracts.contracts`;
    expect(after).toEqual(before);
  });
  it("D9-06 · hai lần bán đồng thời lấy chữ ký cuối cùng của lô ⇒ đúng một thành công, một 409 CKS_STOCK", async () => {
    await arrangeCks(c);
    const { lot } = await world(c);
    const one = (name: string) =>
      kcall(c, P.hoa, "POST", "/sales", {
        company_name: name,
        lot_id: lot.id,
        price_each: 1_700_000,
        signed_at: d(0),
        valid_to: d(365),
        holders: [{ name: "Chữ ký công ty", device: "token" }],
      });
    const rs = await Promise.all([one("Khách A"), one("Khách B")]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const [n] =
      await c.sql`select count(*)::int as n from contracts.cks_certificates where lot_id = ${lot.id}`;
    expect(n?.n).toBe(5);
  });
});

describe("HD-FR-93 · tổng quan + khách", () => {
  it("HD9-AC03 · overview {5,3,4,1,1}; lô sold 4 · khách 2 · tồn 1 · lãi 2.150.000", async () => {
    await arrangeCks(c);
    await world(c);
    expect((await kcall(c, P.tam, "GET", "/overview")).json).toEqual({
      certificates: 5,
      customers: 3,
      expiring_30: 4,
      expired: 1,
      in_stock: 1,
    });
    const [lot] = (await kcall(c, P.tam, "GET", "/lots")).json;
    expect([lot.sold, lot.customers, lot.in_stock, lot.margin]).toEqual([
      4,
      2,
      1,
      3 * (1_650_000 - 1_100_000) + (1_600_000 - 1_100_000),
    ]);
  });
  it("HD9-AC03 · khách gom theo HĐ bán, giá cộng theo nhóm, tự mua, lọc expired/elsewhere/ca/lot, thứ tự theo hạn", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const all = (await kcall(c, P.tam, "GET", "/customers")).json.items;
    expect(all.map((r: { name: string }) => r.name)).toEqual([
      "Thực phẩm Sạch Bình An",
      "Bếp Việt",
      "Cơ khí Tân Tiến",
    ]);
    const bv = await customerNamed(c, "Bếp Việt");
    expect([
      bv.cert_count,
      bv.group_count,
      bv.ca,
      bv.days_left,
      bv.sale_price,
      bv.earliest,
    ]).toEqual([3, 1, "Viettel-CA", 9, 4_950_000, d(9)]);
    expect(bv.sales).toEqual([
      {
        contract_id: w.bv.contract_id,
        number: w.bv.number,
        signed_at: d(-356),
        count: 3,
        price_each: 1_650_000,
        total: 4_950_000,
        paid: false,
        valid_to: d(9),
        renewal: null,
      },
    ]);
    expect(new Set(bv.certs.map((x: { label: string }) => x.label))).toEqual(
      new Set(["Chữ ký công ty", "Giám đốc · Lê Văn Tâm", "Kế toán trưởng · Trần Thu Hà"]),
    );
    const keeper = bv.certs.find((x: { label: string }) => x.label === "Chữ ký công ty");
    expect(keeper).toMatchObject({
      keeper: "Trần Thu Hà",
      device: "token",
      serial: "5401 0B72 33AF 9E10",
      sale_price: 1_650_000,
      signed_count: 0,
      status: "active",
      sale_contract_id: w.bv.contract_id,
    });
    const tt = await customerNamed(c, "Cơ khí Tân Tiến");
    expect([tt.elsewhere, tt.has_sale, tt.sale_price, tt.sales]).toEqual([true, false, null, []]);
    const names = async (q: string) =>
      (await kcall(c, P.tam, "GET", `/customers${q}`)).json.items.map(
        (r: { name: string }) => r.name,
      );
    expect(await names("?filter=expired")).toEqual(["Thực phẩm Sạch Bình An"]);
    // HD9-AC09: trang + tìm bỏ dấu ở server (tên, CA, người giữ, serial); `cas` cho ô lọc CA.
    const p2 = (await kcall(c, P.tam, "GET", "/customers?page=2&page_size=2")).json;
    expect([p2.items.map((r: { name: string }) => r.name), p2.total, p2.cas]).toEqual([
      ["Cơ khí Tân Tiến"],
      3,
      ["FPT-CA", "Viettel-CA"],
    ]);
    expect(p2.items[0].certs[0]).toEqual({
      id: expect.any(String),
      label: "Chữ ký công ty",
      device: "token",
      ca: "FPT-CA",
      valid_to: d(15),
      sale_price: null,
      signed_count: 0,
      sale_contract_id: null,
    });
    expect(await names("?q=le%20van%20tam")).toEqual(["Bếp Việt"]);
    expect(await names("?q=9E11")).toEqual(["Bếp Việt"]);
    expect(await names("?q=VIETTEL")).toEqual(["Thực phẩm Sạch Bình An", "Bếp Việt"]);
    expect(await names("?q=binh%20an")).toEqual(["Thực phẩm Sạch Bình An"]);
    expect(await names("?q=100%25")).toEqual([]);
    expect(await names("?filter=expiring")).toEqual(["Bếp Việt", "Cơ khí Tân Tiến"]);
    expect(await names("?filter=elsewhere")).toEqual(["Cơ khí Tân Tiến"]);
    expect(await names("?ca=FPT-CA")).toEqual(["Cơ khí Tân Tiến"]);
    expect(await names(`?lot=${w.lot.id}`)).toEqual(["Thực phẩm Sạch Bình An", "Bếp Việt"]);
    const one = await kcall(c, P.tam, "GET", `/customers/${bv.company_id}`);
    expect([one.status, one.json.name]).toEqual([200, "Bếp Việt"]);
  });
});

describe("HD-FR-94 · gia hạn cả nhóm", () => {
  it("HD9-AC04 · mở gia hạn ⇒ open (lần 2 ⇒ 409 CKS_RENEWAL_OPEN); hoàn tất 1 serial ⇒ vẫn 3 chữ ký, hạn > 300 ngày, NEW-1; overview vẫn 5; nhật ký giá", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const r = await kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, {});
    expect(r.status).toBe(201);
    const ren = r.json;
    expect(ren).toMatchObject({
      status: "open",
      price_each: 1_650_000,
      sale_contract_id: w.bv.contract_id,
    });
    expect(ren.valid_to).toBe(
      `${Number(d(9).slice(0, 4)) + 1}${d(9)
        .slice(4)
        .replace(/^-02-29$/, "-02-28")}`,
    );
    const again = await kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, {});
    expect({ s: again.status, code: again.json?.error?.code }).toEqual({
      s: 409,
      code: "CKS_RENEWAL_OPEN",
    });
    const open = await customerNamed(c, "Bếp Việt");
    expect(open.sales[0].renewal).toEqual({ id: ren.id, status: "open" });
    expect(new Set(open.certs.map((x: { status: string }) => x.status))).toEqual(
      new Set(["pending_renewal"]),
    );
    const [rk] =
      await c.sql`select status, direction, value, title from contracts.contracts where id = ${ren.new_contract_id}`;
    expect(rk).toMatchObject({ status: "active", direction: "sale", value: "4950000" });
    expect(String(rk?.title)).toStartWith("Gia hạn chữ ký số · CKS-");
    const old = ren.certificate_ids as string[];
    const done = await kcall(c, P.hoa, "POST", `/renewals/${ren.id}/complete`, {
      serials: { [old[0] as string]: "NEW-1" },
      valid_to: null,
    });
    expect([done.status, done.json.status]).toEqual([200, "done"]);
    const row = await customerNamed(c, "Bếp Việt");
    expect(row.cert_count).toBe(3);
    expect(row.days_left).toBeGreaterThan(300);
    expect(row.certs.map((x: { serial: string | null }) => x.serial)).toContain("NEW-1");
    expect((await kcall(c, P.tam, "GET", "/overview")).json.certificates).toBe(5);
    const again2 = await kcall(c, P.hoa, "POST", `/renewals/${ren.id}/complete`, {
      serials: {},
      valid_to: null,
    });
    expect({ s: again2.status, code: again2.json?.error?.code }).toEqual({
      s: 409,
      code: "CKS_RENEWAL_CLOSED",
    });
    const log = (await audit(c.sql)).filter(
      (a) => a.entity === "renewal" || a.entity === "certificate",
    );
    expect(log).toEqual([
      {
        entity: "renewal",
        field: "price_each",
        old_value: "1650000",
        new_value: "1650000",
        actor: P.hoa.id,
      },
      ...Array.from({ length: 3 }, () => ({
        entity: "certificate",
        field: "sale_price",
        old_value: "1650000",
        new_value: "1650000",
        actor: P.hoa.id,
      })),
    ]);
  });
  it("HD9-AC04 · giá gia hạn mới ⇒ HĐ gia hạn theo giá mới, nhật ký cũ → mới; serial mới trùng ⇒ 409", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const ren = await ok(
      kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, {
        price_each: 1_750_000,
        years: 2,
      }),
    );
    const [rk] =
      await c.sql`select value from contracts.contracts where id = ${ren.new_contract_id}`;
    expect(rk?.value).toBe("5250000");
    const log = await audit(c.sql);
    expect(log.at(-1)).toEqual({
      entity: "renewal",
      field: "price_each",
      old_value: "1650000",
      new_value: "1750000",
      actor: P.hoa.id,
    });
    const ids = ren.certificate_ids as string[];
    const dup = await kcall(c, P.hoa, "POST", `/renewals/${ren.id}/complete`, {
      serials: { [ids[0] as string]: "FPT-1" },
      valid_to: null,
    });
    expect({ s: dup.status, code: dup.json?.error?.code }).toEqual({
      s: 409,
      code: "CKS_SERIAL_TAKEN",
    });
  });
  it("HD9-AC04 · mất khách ⇒ lost, chữ ký về active, HĐ gia hạn terminated + handled not_renewed", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const ren = await ok(kcall(c, P.hoa, "POST", `/groups/${w.ba.contract_id}/renew`, {}));
    const lost = await kcall(c, P.hoa, "POST", `/renewals/${ren.id}/lost`, {
      reason: "gia hạn ở MISA",
    });
    expect([lost.status, lost.json.status]).toEqual([200, "lost"]);
    const [k] = await c.sql`select status, handled ->> 'outcome' as outcome from contracts.contracts
      where id = ${ren.new_contract_id}`;
    expect(k).toEqual({ status: "terminated", outcome: "not_renewed" });
    const ba = await customerNamed(c, "Thực phẩm Sạch Bình An");
    expect(ba.certs.map((x: { status: string }) => x.status)).toEqual(["active"]);
    expect(ba.sales[0].renewal).toBeNull();
  });
});

describe("HD-FR-96 · giá CKS mua–bán", () => {
  it("HD9-AC06 · gói: giá mua lô mới nhất, bán gần nhất 12 tháng, lãi, biên half-even, giá thị trường, cờ, lọc, thống kê", async () => {
    await arrangeCks(c);
    await world(c);
    await ok(
      kcall(c, P.hoa, "POST", "/lots", {
        ca: "FastCA",
        qty: 3,
        unit_cost: 900_000,
        bought_at: d(-10),
        device: "token",
      }),
    );
    const seen = d(-3);
    await c.sql`insert into contracts.cks_market_prices
      (tenant_id, ca_key, ca_name, years, kind, device, seller, tier, price_ex_vat, url, verified, seen)
      values (${T.acme}, 'viettel', 'Viettel-CA', 1, 'new', 'token', 'Đại lý A', null, 1500000, 'https://a.vn', true, ${seen}),
             (${T.acme}, 'viettel', 'Viettel-CA', 1, 'renew', null, 'Đại lý B', 'gói 1', 1400000, null, true, ${seen}),
             (${T.acme}, 'viettel', 'Viettel-CA', 1, 'new', 'token', 'Đại lý C', null, 900000, null, false, ${seen}),
             (${T.beta}, 'viettel', 'Viettel-CA', 1, 'new', 'token', 'Beta', null, 100, null, true, ${d(-1)})`;
    const p = (await kcall(c, P.tam, "GET", "/prices")).json;
    expect(p.stats).toEqual({
      sold_12m: 3,
      revenue: 4_950_000,
      gross_profit: 1_650_000,
      margin_pct: 33.3,
    });
    expect(p.market_seen).toBe(seen);
    expect(p.rows.map((r: { label: string }) => r.label)).toEqual([
      "Viettel-CA · 1 năm",
      "FastCA · 1 năm",
    ]);
    expect(p.rows[0]).toEqual({
      ca: "Viettel-CA",
      years: 1,
      device: "token",
      device_label: "USB token",
      label: "Viettel-CA · 1 năm",
      buy: 1_100_000,
      sell: 1_650_000,
      margin: 550_000,
      margin_pct: 33,
      sold: 3,
      revenue: 4_950_000,
      profit: 1_650_000,
      market: {
        min: 1_400_000,
        max: 1_500_000,
        n: 2,
        seen,
        any_device: false,
        sources: [
          { seller: "Đại lý B", tier: "gói 1", price: 1_400_000, url: null, kind: "renew" },
          { seller: "Đại lý A", tier: null, price: 1_500_000, url: "https://a.vn", kind: "new" },
        ],
      },
      flags: ["above_market"],
    });
    expect(p.rows[1]).toMatchObject({
      buy: 900_000,
      sell: null,
      margin: null,
      margin_pct: null,
      sold: 0,
      market: null,
    });
    expect(p.rows[1].flags).toEqual(["cheapest_buy"]);
    const multi = (await kcall(c, P.tam, "GET", "/prices?filter=multi")).json;
    expect(multi.rows).toEqual([]);
    expect(multi.stats).toEqual({ sold_12m: 0, revenue: 0, gross_profit: 0, margin_pct: null });
    expect((await kcall(c, P.tam, "GET", "/prices?filter=remote")).json.rows).toEqual([]);
    expect((await kcall(c, P.tam, "GET", "/prices?filter=bogus")).status).toBe(400);
  });
});
