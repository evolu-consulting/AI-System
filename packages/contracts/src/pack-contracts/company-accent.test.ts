// CR-138 Q8 · luật thuần màu chủ đạo: 12 màu đặt sẵn, kiểm tương phản màu tự chọn, schema.
import { describe, expect, test } from "bun:test";
import {
  COMPANY_ACCENTS,
  CompanySchema,
  checkAccent,
  contrastRatio,
  isAccentHex,
  mixHex,
} from "./index";

const base = {
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "auto",
  own_names: [],
  own_tax_ids: [],
};

describe("CR-138 Q8 · màu chủ đạo", () => {
  test("12 màu đặt sẵn, không trùng", () => {
    expect(COMPANY_ACCENTS.length).toBe(12);
    expect(new Set(COMPANY_ACCENTS).size).toBe(12);
  });
  test("tương phản WCAG: trắng/đen = 21, trắng/trắng = 1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
  test("màu đậm đạt AA với chữ trắng, màu nhạt không đạt và có gợi ý đạt chuẩn", () => {
    expect(checkAccent("#4f46e5").ok).toBe(true);
    const yellow = checkAccent("#facc15");
    expect(yellow.ok).toBe(false);
    expect(yellow.ratio).toBeLessThan(4.5);
    const sug = yellow.suggestion;
    expect(sug).not.toBeNull();
    expect(checkAccent(sug as string).ok).toBe(true);
  });
  test("mã sai dạng ⇒ không hợp lệ", () => {
    for (const v of ["fff", "#fff", "#12345", "#12345g", "red", ""]) {
      expect(isAccentHex(v)).toBe(false);
      expect(checkAccent(v).ok).toBe(false);
    }
  });
  test("mixHex trộn đúng", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
  test("schema: khoá đặt sẵn + hex đạt ⇒ nhận (hex chuẩn hoá chữ thường), hex nhạt/sai/khoá lạ ⇒ từ chối", () => {
    expect(CompanySchema.safeParse({ ...base, accent: "slate" }).success).toBe(true);
    const ok = CompanySchema.safeParse({ ...base, accent: "#4F46E5" });
    expect(ok.success && ok.data.accent).toBe("#4f46e5");
    for (const accent of ["#facc15", "#12345", "purple", "indigo2"])
      expect(CompanySchema.safeParse({ ...base, accent }).success).toBe(false);
  });
  test("ảnh bìa: PNG/JPG/WebP nhận, SVG và > 3 MB từ chối, vắng/null nhận", () => {
    const png = `data:image/png;base64,${"A".repeat(64)}`;
    expect(CompanySchema.safeParse({ ...base, cover: png }).success).toBe(true);
    expect(CompanySchema.safeParse({ ...base, cover: null }).success).toBe(true);
    expect(CompanySchema.safeParse(base).success).toBe(true);
    expect(
      CompanySchema.safeParse({ ...base, cover: "data:image/svg+xml;base64,AAAA" }).success,
    ).toBe(false);
    const big = `data:image/jpeg;base64,${"A".repeat(4_300_000 - 30)}`;
    expect(CompanySchema.safeParse({ ...base, cover: big }).success).toBe(false);
  });
});
