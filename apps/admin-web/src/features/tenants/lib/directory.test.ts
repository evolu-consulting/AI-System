// CR-124 q2 · luật công tắc danh bạ (FLOW4-FR-03/05).
import { describe, expect, test } from "bun:test";
import { directoryView } from "./directory";

const base = {
  legal_name: "Công ty Acme",
  tax_code: "0312345678",
  directory_listed: false,
  directory_verified: null,
};

describe("CR-124 q2 · directoryView", () => {
  test("quản trị công ty: bật được khi đủ tên pháp lý + MST, không thấy công tắc xác minh", () => {
    const v = directoryView(base, false);
    expect(v.listed).toEqual({ checked: false, enabled: true, needProfile: false });
    expect(v.verified.visible).toBe(false);
  });

  test("thiếu MST/tên pháp lý ⇒ khoá công tắc và báo cần điền hồ sơ; đang bật vẫn tắt được", () => {
    expect(directoryView({ ...base, tax_code: null }, false).listed).toEqual({
      checked: false,
      enabled: false,
      needProfile: true,
    });
    expect(
      directoryView({ ...base, tax_code: null, directory_listed: true }, false).listed,
    ).toEqual({
      checked: true,
      enabled: true,
      needProfile: false,
    });
  });

  test("quản trị nền tảng: không bật hộ công ty, xác minh cần MST, hiện ngày + người xác minh", () => {
    const v = directoryView(base, true);
    expect(v.listed.enabled).toBe(false);
    expect(v.verified).toMatchObject({ visible: true, checked: false, enabled: true });
    expect(directoryView({ ...base, tax_code: null }, true).verified.enabled).toBe(false);
    const done = directoryView(
      { ...base, directory_verified: { at: "2026-11-07T01:00:00.000Z", by_name: "Admin" } },
      true,
    );
    expect(done.verified).toMatchObject({
      checked: true,
      at: "2026-11-07T01:00:00.000Z",
      by: "Admin",
    });
  });
});
