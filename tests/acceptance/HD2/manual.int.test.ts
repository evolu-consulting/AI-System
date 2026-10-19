// HD-FR-26 · Q15 · D2-04: nhập tay HĐ không file `POST /pack/contracts/contracts/manual`. Trường `edited`, đối tác theo chiều mua/bán,
// dòng hàng, cảnh báo (MST qua cổng giả), trạng thái `needs_review`; tenant lấy từ token (thân có `tenant_id` ⇒ 400), viewer 403.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrange, CBASE, type CtxHd2, P, startHd2, T } from "./_support/hd2";

let c: CtxHd2;
beforeAll(async () => {
  c = await startHd2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
type Who = (typeof P)[keyof typeof P];
const MANUAL = `${CBASE}/manual`;
const post = (p: Who, body: unknown) => c.hubCall(p, "POST", MANUAL, body);
const BODY = {
  direction: "purchase",
  number: "HĐ-07/2026",
  title: "Cung cấp gạo 2027",
  partner_name: "Công ty TNHH Gạo Ngon",
  partner_tax_id: "0301234567",
  partner_signer: "Nguyễn Văn A – Giám đốc",
  our_signer: "Trần Thị B – Giám đốc",
  start_date: "2027-01-01",
  end_date: "2027-12-31",
  notice_days: 30,
  total_value: 91_500_000,
  payment_terms: "Chuyển khoản 30 ngày",
  items: [
    { name: "Gạo ST25", unit: "kg", qty: 1000, unit_price: 91_500 },
    { name: "Vận chuyển", unit: null, qty: null, unit_price: null },
  ],
};

describe("HD-FR-26 · nhập tay", () => {
  it("HD-FR-26 · editor ⇒ 201 {id, status needs_review, version 1}; đối tác vào bên bán (mua vào), trường edited, 2 dòng hàng", async () => {
    await arrange(c);
    c.ai.reset();
    const r = await post(P.hoa, BODY);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: "needs_review", version: 1 });
    const d = (await c.hubCall(P.lan, "GET", `${CBASE}/${r.json.id}`)).json;
    expect(d.title).toBe("Cung cấp gạo 2027");
    expect(d.direction).toBe("purchase");
    expect(d.fields.supplier_name).toEqual({
      value: "Công ty TNHH Gạo Ngon",
      quote: "",
      verified: true,
      edited: true,
    });
    expect(d.fields.buyer_representative.value).toBe("Trần Thị B – Giám đốc");
    expect(d.fields.buyer_name).toEqual({ value: null, quote: "", verified: false, edited: false });
    expect(d.items.map((i: { name: string }) => i.name)).toEqual(["Gạo ST25", "Vận chuyển"]);
    const [row] =
      await c.sql`select tenant_id, created_by, file_id from contracts.contracts where id = ${r.json.id}`;
    expect(row).toEqual({ tenant_id: T.acme, created_by: P.hoa.id, file_id: null });
    const ev =
      await c.sql`select type from contracts.contract_events where contract_id = ${r.json.id}`;
    expect(ev.map((e) => e.type)).toEqual(["created_manual"]);
  });
  it("HD-FR-23 · bán ra ⇒ đối tác vào bên mua; MST đối tác không tồn tại ⇒ cảnh báo tax_not_found", async () => {
    await arrange(c);
    c.ai.reset();
    c.ai.tax = { "0301234567": { result: "not_found" } };
    const r = await post(P.hoa, { ...BODY, direction: "sale" });
    expect(r.status).toBe(201);
    const d = (await c.hubCall(P.lan, "GET", `${CBASE}/${r.json.id}`)).json;
    expect(d.fields.buyer_name.value).toBe("Công ty TNHH Gạo Ngon");
    expect(d.warnings.map((w: { code: string }) => w.code)).toContain("tax_not_found");
  });
  it("quyền + tenant · viewer 403; thân có tenant_id (khoá lạ) ⇒ 400; thiếu title ⇒ 400; HĐ không tạo", async () => {
    await arrange(c);
    expect((await post(P.tam, BODY)).status).toBe(403);
    expect((await post(P.hoa, { ...BODY, tenant_id: T.beta })).status).toBe(400);
    expect((await post(P.hoa, { ...BODY, title: "" })).status).toBe(400);
    const [n] = await c.sql`select count(*)::int as n from contracts.contracts`;
    expect(n?.n).toBe(0);
  });
  it("cách ly tenant · owner beta tạo ⇒ hàng thuộc beta, acme không thấy (404)", async () => {
    await arrange(c);
    const r = await post(P.an, BODY);
    expect(r.status).toBe(201);
    const [row] = await c.sql`select tenant_id from contracts.contracts where id = ${r.json.id}`;
    expect(row?.tenant_id).toBe(T.beta);
    expect((await c.hubCall(P.lan, "GET", `${CBASE}/${r.json.id}`)).status).toBe(404);
  });
});
