// CR-110 · HT-75/76 · trang Đăng nhập hiện trước khi biết vai (đối tác hay chủ quản) ⇒ thương hiệu tĩnh không được nhắc Sổ Hợp Tác.
import { describe, expect, it } from "bun:test";
import en from "../../../../../../packages/i18n/locales/community/en.json";
import vi from "../../../../../../packages/i18n/locales/community/vi.json";

describe("community.brand (trang Đăng nhập)", () => {
  it("không chứa tên Sổ Hợp Tác ở cả vi và en", () => {
    for (const loc of [vi, en]) {
      const text = JSON.stringify(loc.community.brand);
      expect(text).not.toContain("Sổ Hợp Tác");
      expect(text.toLowerCase()).not.toContain("so hop tac");
    }
  });
});
