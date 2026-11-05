// CR-110 · COM-FR-41/42 · khoá `?sec=` → mục Cài đặt.
import { describe, expect, test } from "bun:test";
import { sectionFromKey } from "./section-key";

describe("sectionFromKey", () => {
  test("khoá hợp lệ ⇒ đúng mục", () => {
    for (const k of ["co", "rep", "biz", "scout", "flow"])
      expect(sectionFromKey(k)).toBe(k as never);
  });
  test("khoá lạ ⇒ mục mặc định co", () => {
    expect(sectionFromKey("esign")).toBe("co");
    expect(sectionFromKey("CO")).toBe("co");
  });
  test("không có / rỗng / không phải chuỗi ⇒ null (giữ hành vi cũ)", () => {
    expect(sectionFromKey(undefined)).toBeNull();
    expect(sectionFromKey("")).toBeNull();
    expect(sectionFromKey(["flow"])).toBeNull();
  });
});
