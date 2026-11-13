// CR-140 · luật thuần của node «Ghi thanh toán vào HĐ».
import { describe, expect, test } from "bun:test";
import {
  pickContract,
  planRecordPayment,
  RECORD_PAYMENT_BAD_AMOUNT,
  RECORD_PAYMENT_BAD_DATE,
  RECORD_PAYMENT_NO_CONTRACT,
} from "./config";

const ID = "0c140000-0000-4000-8000-000000000001";
const OTHER = "0c140000-0000-4000-8000-000000000002";

describe("planRecordPayment", () => {
  test("số tiền nguyên 1…1e15; rỗng/vắng ⇒ null (không ép thành 0); sai ⇒ lỗi", () => {
    const ok = (amount: unknown) => planRecordPayment({ amount, paid_at: "2026-11-05" });
    expect(ok("12000000")).toMatchObject({ ok: true, plan: { amount: 12_000_000 } });
    expect(ok(5)).toMatchObject({ plan: { amount: 5 } });
    expect(ok("")).toMatchObject({ plan: { amount: null } });
    expect(ok(undefined)).toMatchObject({ plan: { amount: null } });
    for (const bad of [0, -1, "0", "abc", 1.5, "12.5", 1e15 + 1, "1e3"])
      expect(ok(bad)).toEqual({ ok: false, code: RECORD_PAYMENT_BAD_AMOUNT });
    expect(ok(1e15)).toMatchObject({ ok: true });
  });
  test("ngày phải là ngày lịch hợp lệ YYYY-MM-DD; sai/vắng ⇒ lỗi (không âm thầm lấy hôm nay)", () => {
    expect(planRecordPayment({ paid_at: "2026-11-05T00:00:00Z" })).toMatchObject({
      plan: { paidAt: "2026-11-05" },
    });
    for (const bad of [undefined, "", "05/11/2026", "2026-02-30", "2026-13-01"])
      expect(planRecordPayment({ paid_at: bad })).toEqual({
        ok: false,
        code: RECORD_PAYMENT_BAD_DATE,
      });
  });
  test("mã HĐ: chuẩn hoá, rỗng ⇒ null, không phải uuid ⇒ lỗi", () => {
    expect(
      planRecordPayment({ contract_id: ID.toUpperCase(), paid_at: "2026-11-05" }),
    ).toMatchObject({ plan: { contractId: ID } });
    expect(planRecordPayment({ contract_id: " ", paid_at: "2026-11-05" })).toMatchObject({
      plan: { contractId: null },
    });
    expect(planRecordPayment({ contract_id: "abc", paid_at: "2026-11-05" })).toEqual({
      ok: false,
      code: RECORD_PAYMENT_NO_CONTRACT,
    });
  });
});

describe("pickContract (HĐ lấy từ liên kết lượt↔HĐ, args chỉ đối chiếu)", () => {
  test("lượt thật không có HĐ + args trống ⇒ bỏ qua", () => {
    expect(pickContract([], null)).toEqual({ kind: "skip" });
  });
  test("lượt không có HĐ nhưng args chỉ HĐ ⇒ lỗi (không tin args)", () => {
    expect(pickContract([], ID)).toEqual({ kind: "error", code: RECORD_PAYMENT_NO_CONTRACT });
  });
  test("có HĐ gắn lượt: args vắng hoặc khớp ⇒ dùng; lệch ⇒ lỗi; nhiều HĐ trong cây ⇒ lỗi", () => {
    expect(pickContract([ID], null)).toEqual({ kind: "use", id: ID });
    expect(pickContract([ID, ID], ID)).toEqual({ kind: "use", id: ID });
    expect(pickContract([ID], OTHER)).toMatchObject({ kind: "error" });
    expect(pickContract([ID, OTHER], null)).toMatchObject({ kind: "error" });
  });
});
