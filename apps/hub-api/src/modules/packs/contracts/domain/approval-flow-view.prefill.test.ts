// CR-126 · prefill của task form: nguồn là JSON snapshot/payload ⇒ kiểm schema, sai dạng thì bỏ (form vẫn nhập tay được).
import { describe, expect, test } from "bun:test";
import { prefillOf } from "./approval-flow-view.rules";

const good = {
  field_defaults: { partner_email: "k@doitac.vn" },
  field_options: { partner: [{ value: "p1", label: "Công ty A · 0101234567" }] },
};

describe("prefillOf", () => {
  test("lấy prefill đúng dạng từ nguồn đầu tiên có", () => {
    expect(prefillOf({ prefill: good })).toEqual(good);
    expect(prefillOf(null, { x: 1 }, { prefill: good })).toEqual(good);
  });
  test("vắng / sai dạng ⇒ undefined (không ném)", () => {
    expect(prefillOf(undefined, {})).toBeUndefined();
    expect(prefillOf({ prefill: { field_defaults: 3 } })).toBeUndefined();
  });
});
