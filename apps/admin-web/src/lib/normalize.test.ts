import { describe, expect, test } from "bun:test";
import { foldKeyInput, normalizeCompanyKey, normalizeUsername } from "./normalize";

describe("ADM-FR-60 · normalize mã công ty / tên đăng nhập", () => {
  test("bỏ dấu, đ → d, chữ thường", () => {
    expect(normalizeCompanyKey("  Đông-Á  ")).toBe("dong-a");
    expect(normalizeCompanyKey("ACME")).toBe("acme");
    expect(normalizeCompanyKey("Công Ty")).toBe("cong ty");
  });

  test("foldKeyInput không trim và không xoá ký tự lạ", () => {
    expect(foldKeyInput("Ab c_")).toBe("ab c_");
  });

  test("normalizeUsername chỉ trim và lowercase", () => {
    expect(normalizeUsername("  Lan.Tran ")).toBe("lan.tran");
    expect(normalizeUsername("Trần")).toBe("trần");
  });
});
