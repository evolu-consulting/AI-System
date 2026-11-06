import { describe, expect, test } from "bun:test";
import { isCompanyCopy, usesStepForm } from "./company-copy";

describe("CR-121 c17b · bản riêng dùng Form bước dọc chung", () => {
  const copy = { source_template_id: "s1", slot_body: { steps: [] } };
  test("bản riêng có slot_body ⇒ dùng Form; editor thư viện (lib) ⇒ không", () => {
    expect(isCompanyCopy(copy, null)).toBe(true);
    expect(usesStepForm(copy, null)).toBe(copy);
    expect(usesStepForm(copy, {})).toBeNull();
  });
  test("không nguồn thư viện, hoặc chưa có slot_body ⇒ chỉ Sơ đồ (không Form)", () => {
    expect(usesStepForm({ source_template_id: null, slot_body: {} }, null)).toBeNull();
    expect(usesStepForm({ source_template_id: "s1" }, null)).toBeNull();
    expect(usesStepForm(undefined, null)).toBeNull();
  });
});
