// price-scout · test luật thuần của cấu hình dò giá.
import { describe, expect, test } from "bun:test";
import { PRICE_SCOUT_DEFAULT } from "@ai/contracts";
import {
  fromForm,
  inheritedKeys,
  legacyInstructions,
  overrideOf,
  parseCap,
  parseList,
  parsePct,
  scoutIssue,
  toForm,
  toProductForm,
  usageView,
} from "./scout";

const DEF = { ...PRICE_SCOUT_DEFAULT, keywords: ["giấy a4"], schedule: "weekly" as const };

describe("price-scout · lib", () => {
  test("parseList: tách phẩy/xuống dòng, bỏ trống & trùng", () => {
    expect(parseList("a, B\n b;; c ,")).toEqual(["a", "B", "c"]);
    expect(parseList("  ")).toEqual([]);
  });
  test("toForm/fromForm vòng tròn; trống ⇒ null; site viết thường", () => {
    const f = { ...toForm(DEF), spec: " ", include_sites: "Shopee.VN, fpt.com.vn" };
    const c = fromForm(f);
    expect(c.spec).toBeNull();
    expect(c.include_sites).toEqual(["shopee.vn", "fpt.com.vn"]);
    expect(fromForm(toForm(DEF))).toEqual(DEF);
  });
  test("overrideOf: chỉ khoá khác mặc định; trùng hết ⇒ {}", () => {
    expect(overrideOf(toForm(DEF), DEF)).toEqual({});
    const o = overrideOf({ ...toForm(DEF), schedule: "off", keywords: "x, y" }, DEF);
    expect(o).toEqual({ schedule: "off", keywords: ["x", "y"] });
    expect(inheritedKeys({ ...toForm(DEF), schedule: "off" }, DEF).has("schedule")).toBe(false);
    expect(inheritedKeys({ ...toForm(DEF), schedule: "off" }, DEF).has("vat")).toBe(true);
  });
  test("scoutIssue: >10 mục / % sai", () => {
    const many = Array.from({ length: 11 }, (_, i) => `k${i}`).join(",");
    expect(scoutIssue({ ...toForm(DEF), keywords: many })).toBe("listMax");
    expect(scoutIssue({ ...toForm(DEF), alert_pct: "150" })).toBe("pct");
    expect(scoutIssue({ ...toForm(DEF), alert_pct: "10" })).toBeNull();
    expect(parsePct("")).toBeNull();
  });
  test("usageView & parseCap", () => {
    const u = { month: "2026-10", searches: 3, tokens: 9, searches_limit: null, tokens_limit: 5 };
    expect(usageView(u)).toEqual({ used: 3, limit: null });
    expect(parseCap("")).toBeNull();
    expect(parseCap("1.000")).toBe(1000);
    expect(parseCap("-1")).toBeUndefined();
    expect(parseCap("abc")).toBeUndefined();
  });
});

describe("price-scout · yêu cầu tự do (màn SP)", () => {
  test("legacyInstructions dựng câu đọc được từ ô cũ; rỗng khi mặc định", () => {
    expect(legacyInstructions(PRICE_SCOUT_DEFAULT)).toBe("");
    const c = {
      ...PRICE_SCOUT_DEFAULT,
      keywords: ["thùng carton"],
      spec: "60x40x40",
      include_sites: ["shopee.vn"],
      exclude_sites: ["example.com"],
      region: "TP.HCM",
      vat: "incl" as const,
      watched_suppliers: ["Bao Bì Minh Phát"],
      alert_pct: 10,
    };
    expect(legacyInstructions(c)).toBe(
      "thùng carton, quy cách 60x40x40, ưu tiên shopee.vn, bỏ qua example.com, khu vực TP.HCM, giá đã gồm VAT, theo dõi Bao Bì Minh Phát, báo khi giá thấp nhất lệch giá vốn 10%",
    );
  });
  test("toProductForm: ưu tiên instructions đã lưu, không có ⇒ câu dựng; lưu giữ nguyên ô cũ", () => {
    const old = { ...PRICE_SCOUT_DEFAULT, keywords: ["a"], alert_pct: 5 };
    expect(toProductForm(old).instructions).toContain("báo khi giá thấp nhất lệch giá vốn 5%");
    const saved = { ...old, instructions: "yêu cầu mới" };
    const f = toProductForm(saved);
    expect(f.instructions).toBe("yêu cầu mới");
    expect(fromForm(f).alert_pct).toBe(5);
    expect(overrideOf(f, PRICE_SCOUT_DEFAULT)).toMatchObject({ instructions: "yêu cầu mới" });
    expect(scoutIssue({ ...f, instructions: "x".repeat(2001) })).toBe("instructions");
  });
});
