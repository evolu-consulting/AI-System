// Review HD3 S1: luật sửa trường trong flow duyệt (thuần). CR-097 K1: HĐ đã duyệt do `lock.rules` khoá (D3-13 reopen bỏ).
import { describe, expect, test } from "bun:test";
import { editVerdict, needsRunPhase, DEFAULT_EDIT_POLICY as P } from "./approval-edit.rules";

const v = (
  status: string,
  changed: string[],
  phase: "none" | "level1" | "later" = "none",
  policy = P,
) => editVerdict({ status, changed, phase, policy });

describe("editVerdict [S1]", () => {
  test("CR-097 · HĐ đã duyệt: luật duyệt không còn mở lại (khoá cứng ở lock.rules) ⇒ ok", () => {
    expect(v("active", ["total_value"])).toBe("ok");
    expect(v("terminated", ["payment_terms", "buyer_tax_id"])).toBe("ok");
    expect(v("needs_review", ["buyer_tax_id"], "later")).toBe("ok");
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
