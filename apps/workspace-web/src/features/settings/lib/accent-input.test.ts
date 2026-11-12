// CR-138 Q8 · luật ô «Màu tự chọn».
import { describe, expect, test } from "bun:test";
import { COMPANY_ACCENTS } from "@ai/contracts/pack-contracts";
import { accentIssue, normalizeHex } from "./accent-input";
import { ACCENTS, accentPalette, accentSwatch, brandCss, customPalette } from "./brand";

describe("normalizeHex / accentIssue", () => {
  test("thiếu # ⇒ thêm; chữ hoa ⇒ thường; sai dạng giữ nguyên", () => {
    expect(normalizeHex(" 4F46E5 ")).toBe("#4f46e5");
    expect(normalizeHex("#1D4ED8")).toBe("#1d4ed8");
    expect(normalizeHex("#12")).toBe("#12");
  });
  test("preset ⇒ không lỗi; hex đậm ⇒ không lỗi; hex nhạt ⇒ low; sai dạng ⇒ invalid", () => {
    expect(accentIssue("teal")).toBeNull();
    expect(accentIssue("#1d4ed8")).toBeNull();
    expect(accentIssue("#ffee00")).toBe("low");
    expect(accentIssue("#fffffff")).toBe("invalid");
    expect(accentIssue("purple")).toBe("invalid");
  });
});

describe("12 màu đặt sẵn + màu tự chọn trong brand", () => {
  test("đủ 12 màu, mỗi màu có bảng sáng + tối 5 phần tử và mã hex hợp lệ", () => {
    expect(COMPANY_ACCENTS.length).toBe(12);
    for (const k of COMPANY_ACCENTS) {
      const p = ACCENTS[k];
      expect(p.l.length).toBe(5);
      expect(p.d.length).toBe(5);
      for (const c of [...p.l, ...p.d]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  test("màu đậm sáng: chữ trắng ≥ 4.5 trên mọi màu đặt sẵn mới (trừ 6 màu gốc của mockup)", () => {
    for (const k of ["violet", "magenta", "amber", "lime", "sky", "slate"] as const)
      expect(accentIssue(accentSwatch(k))).toBeNull();
  });
  test("customPalette: sáng = màu gốc, tối sáng hơn gốc khi gốc tối", () => {
    const p = customPalette("#1D4ED8");
    expect(p.l[0]).toBe("#1d4ed8");
    expect(p.d[0]).not.toBe("#1d4ed8");
  });
  test("brandCss: chàm/giá trị lạ ⇒ rỗng; preset và hex ⇒ có --primary cả sáng lẫn tối", () => {
    expect(brandCss("indigo")).toBe("");
    expect(brandCss("khong-co")).toBe("");
    expect(brandCss("#12")).toBe("");
    for (const a of ["slate", "#1d4ed8"]) {
      const css = brandCss(a);
      expect(css).toContain(`--primary:${accentPalette(a).l[0]}`);
      expect(css).toContain(`--primary:${accentPalette(a).d[0]}`);
      expect(css).toContain('data-theme="dark"');
    }
  });
});
