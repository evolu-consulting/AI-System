// price-scout · test luật thuần của cấu hình dò giá.
import { describe, expect, test } from "bun:test";
import { PRICE_SCOUT_DEFAULT } from "@ai/contracts";
import {
  fromForm,
  inheritedKeys,
  overrideOf,
  parseCap,
  parseList,
  parsePct,
  scoutIssue,
  toForm,
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
