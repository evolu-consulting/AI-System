// V2-L · luật thuần của hộp thoại Cài đặt: so mặc định/đã lưu, kiểm sơ bộ, CSS màu. (Cách tính điểm uy tín: `partner-score.test.ts`.)
import { describe, expect, test } from "bun:test";
import { brandCss, effectiveTheme } from "./brand";
import { anyChanged, buildState, changedParts, firstIssue } from "./data";

const biz = {
  w: { rot: 40, margin: 35, trend: 25 },
  buyDays: 45,
  dumpDays: 150,
  quotaBuy: 120,
  quotaDump: 70,
  hi: 70,
  lo: 45,
  vol: 6,
  soon: 60,
};
const co = {
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo" as const,
  theme: "auto" as const,
  own_names: [] as string[],
  own_tax_ids: [] as string[],
};
const state = () =>
  buildState(
    {
      company: co,
      approval_enabled: true,
      allow_negative_stock: false,
      legal_warn_threshold: 5_000_000,
      defaults: {
        ...co,
        approval_enabled: true,
        allow_negative_stock: false,
        legal_warn_threshold: 5_000_000,
      },
      version: 0,
      updated_at: null,
    },
    { config: biz, defaults: biz, version: 0, updated_at: null },
  );

describe("V2-L · dữ liệu cài đặt", () => {
  test("đổi điểm kinh doanh ⇒ khác mặc định; khôi phục ⇒ không đổi", () => {
    const s = state();
    expect(anyChanged(changedParts(s.saved, s.defaults))).toBe(false);
    const d = structuredClone(s.saved);
    d.biz.hi = 80;
    expect(changedParts(d, s.defaults)).toEqual({ company: false, biz: true });
  });
  test("MST của công ty sai ⇒ chặn lưu; chỉ xét khi phần công ty đổi", () => {
    const d = structuredClone(state().saved);
    d.company.own_tax_ids = ["abc"];
    expect(firstIssue(d, { company: true, biz: false })).toBe("co.taxInvalid");
    expect(firstIssue(d, { company: false, biz: true })).toBeNull();
  });
});
describe("V2-L · nhận diện", () => {
  test("chàm = không đè; màu khác đè cả sáng và tối", () => {
    expect(brandCss("indigo")).toBe("");
    const css = brandCss("teal");
    expect(css).toContain("--primary:#0d9488");
    expect(css).toContain("--primary:#2dd4bf");
  });
  test("giao diện: xem thử > riêng > công ty", () => {
    const b = { name: null, app_name: null, logo: null, accent: "indigo", theme: "dark" } as const;
    expect([
      effectiveTheme(b, true, "light"),
      effectiveTheme(b, false, "light"),
      effectiveTheme(b, false, null),
    ]).toEqual(["dark", "light", "dark"]);
  });
});
