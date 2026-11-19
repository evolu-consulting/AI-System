// CR-187 BR-187-5 · công tắc «Cho công ty khác tìm thấy công ty mình»: ai thấy, khi nào bật được.
import { describe, expect, test } from "bun:test";
import { canSeeDiscoverable, discoverableView } from "./discoverable";

const base = { legal_name: "Công ty Acme", tax_code: "0312345678", directory_listed: false };

describe("CR-187 · discoverableView", () => {
  test("vai khác quản trị công ty không thấy thẻ", () => {
    expect(canSeeDiscoverable("tenant_admin")).toBe(true);
    for (const r of ["member", "platform_admin", undefined])
      expect(canSeeDiscoverable(r)).toBe(false);
  });

  test("đủ tên pháp lý + MST ⇒ bật được", () => {
    expect(discoverableView(base)).toEqual({ checked: false, enabled: true, needProfile: false });
  });

  test("thiếu MST hoặc tên pháp lý ⇒ khoá + báo lý do", () => {
    expect(discoverableView({ ...base, tax_code: null })).toEqual({
      checked: false,
      enabled: false,
      needProfile: true,
    });
    expect(discoverableView({ ...base, legal_name: null }).needProfile).toBe(true);
  });

  test("đang bật mà hồ sơ thiếu ⇒ vẫn tắt được", () => {
    expect(discoverableView({ ...base, tax_code: null, directory_listed: true })).toEqual({
      checked: true,
      enabled: true,
      needProfile: false,
    });
  });
});
