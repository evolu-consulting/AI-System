// HD-FR-26 (ngừng — CR-097) · Q15 · D2-04: nhập tay HĐ không file `POST /pack/contracts/contracts/manual`. Trường `edited`, đối tác theo chiều mua/bán,
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

// CR-097 decision 1 (qc, thay HD-FR-26): tạo HĐ nhập tay mới đã NGỪNG ⇒ 410 `MANUAL_CONTRACT_DISABLED` (sau guard quyền, trước đọc
// thân), không tạo hàng — mọi người có quyền ghi, mọi tenant. Đường code nhập tay giữ cho lát Giao dịch (G1).
describe("HD-FR-26 (ngừng theo CR-097) · nhập tay", () => {
  it("editor / owner acme / owner beta ⇒ 410 MANUAL_CONTRACT_DISABLED; không HĐ nào được tạo", async () => {
    await arrange(c);
    for (const p of [P.hoa, P.lan, P.an]) {
      const r = await post(p, BODY);
      expect({ who: p.id, status: r.status, code: r.json?.error?.code }).toEqual({
        who: p.id,
        status: 410,
        code: "MANUAL_CONTRACT_DISABLED",
      });
    }
    const [n] = await c.sql`select count(*)::int as n from contracts.contracts`;
    expect(n?.n).toBe(0);
  });
  it("quyền · viewer 403 (guard trước khi báo ngừng); thân rác vẫn 410 (không đọc thân)", async () => {
    await arrange(c);
    expect((await post(P.tam, BODY)).status).toBe(403);
    expect((await post(P.hoa, { ...BODY, tenant_id: T.beta })).status).toBe(410);
  });
});
