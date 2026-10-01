import { describe, expect, test } from "bun:test";
import {
  foldKeyInput,
  normalizeCommandName,
  normalizeCompanyKey,
  normalizeSecretName,
  normalizeUsername,
} from "./normalize";

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

describe("ADM-FR-50, ADM-FR-20 · normalizeSecretName / normalizeCommandName", () => {
  test("secret: trim + HOA", () => {
    expect(normalizeSecretName("  dify_translate_key ")).toBe("DIFY_TRANSLATE_KEY");
    expect(normalizeSecretName("a")).toBe("A");
  });

  test("command: bỏ '/', trim, chữ thường, bỏ dấu", () => {
    expect(normalizeCommandName("/Dịch")).toBe("dich");
    expect(normalizeCommandName("  /Xuất-Báo-Cáo ")).toBe("xuat-bao-cao");
    expect(normalizeCommandName("tr")).toBe("tr");
    expect(normalizeCommandName("//")).toBe("");
  });
});
