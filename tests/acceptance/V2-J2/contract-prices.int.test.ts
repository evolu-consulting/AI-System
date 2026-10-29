// Giá từ HĐ đã xác nhận trong tab NCC & giá (product-prices): dòng HĐ mua (source contract, đang áp dụng) + khối pricing; bản cũ bị thay bị bỏ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BASE, type CtxJ2, P, seedProduct, startJ2, T } from "./_support/v2j2";

let c: CtxJ2;
beforeAll(async () => {
  c = await startJ2();
  await c.sql`truncate contracts.products cascade`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const fv = (value: string) => ({ value, quote: "", verified: true, edited: true });
async function contract(o: {
  deal: "buy" | "sell";
  number: string;
  product: string;
  price: number;
  other: string;
}): Promise<string> {
  const us = fv("Công ty Chúng Tôi");
  const them = fv(o.other);
  const fields = {
    number: fv(o.number),
    supplier_name: o.deal === "buy" ? them : us,
    supplier_tax_id: fv(o.deal === "buy" ? "0109999999" : "0100000000"),
    buyer_name: o.deal === "buy" ? us : them,
    buyer_tax_id: fv(o.deal === "buy" ? "0100000000" : "0108888888"),
  };
  const [k] = await c.sql<{ id: string }[]>`insert into contracts.contracts
    (tenant_id, kind, title, direction, deal, status, owner_user_id, created_by, fields, superseded_at)
    values (${T.acme}, 'contract', ${o.number}, ${o.deal === "buy" ? "purchase" : "sale"}, ${o.deal}, 'active',
      ${P.lan.id}, ${P.lan.id}, ${c.sql.json(fields)}, null) returning id`;
  await c.sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price, product_id)
    values (${T.acme}, ${k?.id as string}, 0, 'Thùng carton 5 lớp', 'cái', 100, ${o.price}, ${o.product})`;
  return k?.id as string;
}

describe("tab NCC & giá · giá từ HĐ đã xác nhận", () => {
  it("HĐ mua + HĐ bán ⇒ dòng contract đang áp dụng + pricing; bản cũ bị thay bị bỏ; chỉ bán ⇒ has_buy false", async () => {
    const pid = await seedProduct(c, { tenant: T.acme, name: "Thùng carton 5 lớp" });
    const cur = await contract({
      deal: "buy",
      number: "HDM-1",
      product: pid,
      price: 9_000,
      other: "Giấy An Phát",
    });
    const old = await contract({
      deal: "buy",
      number: "HDM-OLD",
      product: pid,
      price: 1_000,
      other: "Giấy Cũ",
    });
    await c.sql`update contracts.contracts set superseded_by = ${cur}, superseded_at = now() where id = ${old}`;
    await contract({
      deal: "sell",
      number: "HDB-1",
      product: pid,
      price: 14_500,
      other: "NitiGroup",
    });
    const r = await c.hubCall(P.tam, "GET", `${BASE}/products/${pid}/suppliers`);
    expect(r.status).toBe(200);
    const rows = r.json.rows.filter((x: { source: string }) => x.source === "contract");
    expect(rows.map((x: { contract_number: string }) => x.contract_number)).toEqual(["HDM-1"]);
    expect(rows[0]).toMatchObject({
      supplier_name: "Giấy An Phát",
      price: 9_000,
      contract_number: "HDM-1",
      current: true,
    });
    expect(r.json.pricing).toMatchObject({
      sell_price: 14_500,
      buy_cost: 9_000,
      buy_basis: "contract",
      margin: 5_500,
      has_buy: true,
    });
    expect(r.json.pricing.sales).toMatchObject([{ customer: "NitiGroup", number: "HDB-1" }]);

    const sold = await seedProduct(c, { tenant: T.acme, name: "Dịch vụ tự làm", group: "service" });
    await contract({
      deal: "sell",
      number: "HDB-2",
      product: sold,
      price: 5_000_000,
      other: "NitiGroup",
    });
    const s = await c.hubCall(P.tam, "GET", `${BASE}/products/${sold}/suppliers`);
    expect(s.json.pricing).toMatchObject({
      sell_price: 5_000_000,
      buy_cost: null,
      margin: null,
      has_buy: false,
    });
  });
});
