// Review HD3 S1: luật sửa trường trong / sau flow duyệt (thuần).
import { describe, expect, test } from "bun:test";
import { editVerdict, needsRunPhase, DEFAULT_EDIT_POLICY as P } from "./approval-edit.rules";

const v = (
  status: string,
  changed: string[],
  phase: "none" | "level1" | "later" = "none",
  policy = P,
) => editVerdict({ status, changed, phase, policy });

describe("editVerdict [S1]", () => {
  test("Đã duyệt: trường tiền ⇒ reopen (D3-13, mặc định), locked khi chính sách khoá; trường khác ⇒ ok", () => {
    expect(v("active", ["total_value"])).toBe("reopen");
    expect(v("expiring", ["vat_rate"])).toBe("reopen");
    expect(v("active", ["payment_terms"])).toBe("ok");
    expect(v("active", ["total_value"], "none", { ...P, confirmed: "lock" })).toBe("locked");
  });
  test("trong flow: total_value sau cấp 1 ⇒ in_approval; ở cấp 1 ⇒ ok; run đã kết thúc ⇒ ok", () => {
    expect(v("needs_review", ["total_value"], "later")).toBe("in_approval");
    expect(v("needs_review", ["total_value"], "level1")).toBe("ok");
    expect(v("needs_review", ["total_value"], "level1", { ...P, allowLevel1: false })).toBe(
      "in_approval",
    );
    expect(v("needs_review", ["total_value"], "none")).toBe("ok");
    expect(v("needs_review", ["payment_terms"], "later")).toBe("ok");
  });
  test("chỉ hỏi engine khi có run + trạng thái flow + đổi trường rẽ nhánh", () => {
    expect(needsRunPhase("needs_review", true, ["total_value"])).toBe(true);
    expect(needsRunPhase("needs_review", false, ["total_value"])).toBe(false);
    expect(needsRunPhase("needs_review", true, ["title"])).toBe(false);
    expect(needsRunPhase("active", true, ["total_value"])).toBe(false);
  });
});
