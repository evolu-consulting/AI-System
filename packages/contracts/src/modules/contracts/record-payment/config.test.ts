// CR-140 · luật thuần của node «Ghi thanh toán vào HĐ».
import { describe, expect, test } from "bun:test";
import { planRecordPayment, RECORD_PAYMENT_BAD_AMOUNT, RECORD_PAYMENT_NO_CONTRACT } from "./config";

const ID = "0c140000-0000-4000-8000-000000000001";

describe("planRecordPayment", () => {
  test("không có HĐ (đơn mua nhỏ) ⇒ bỏ qua, không lỗi", () => {
    expect(planRecordPayment({})).toEqual({ ok: true, plan: null });
    expect(planRecordPayment({ contract_id: "  " })).toEqual({ ok: true, plan: null });
  });
  test("mã HĐ không phải uuid ⇒ lỗi nghiệp vụ", () => {
    expect(planRecordPayment({ contract_id: "abc" })).toEqual({
      ok: false,
      code: RECORD_PAYMENT_NO_CONTRACT,
    });
  });
  test("số tiền làm tròn đồng, ngày lấy YYYY-MM-DD; vắng ⇒ null (lấy giá trị HĐ / hôm nay)", () => {
    expect(
      planRecordPayment({
        contract_id: ID.toUpperCase(),
        amount: "12000000.4",
        paid_at: "2026-11-05T00:00:00Z",
      }),
    ).toEqual({
      ok: true,
      plan: { contractId: ID, amount: 12_000_000, paidAt: "2026-11-05" },
    });
    expect(planRecordPayment({ contract_id: ID })).toEqual({
      ok: true,
      plan: { contractId: ID, amount: null, paidAt: null },
    });
    expect(planRecordPayment({ contract_id: ID, paid_at: "05/11/2026" })).toMatchObject({
      plan: { paidAt: null },
    });
  });
  test("số tiền âm hoặc không phải số ⇒ lỗi", () => {
    for (const amount of [-1, "abc"])
      expect(planRecordPayment({ contract_id: ID, amount })).toEqual({
        ok: false,
        code: RECORD_PAYMENT_BAD_AMOUNT,
      });
  });
});
