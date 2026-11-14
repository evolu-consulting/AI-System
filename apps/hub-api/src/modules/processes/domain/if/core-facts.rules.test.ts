import { describe, expect, it } from "bun:test";
import { mergeFacts, splitFactKeys, starterIsTop } from "./core-facts.rules";

const ROOT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const NGAN = "33333333-3333-4333-8333-333333333333";

describe("CR-160 · starterIsTop", () => {
  it("người gửi là trưởng phòng gốc ⇒ Đúng", () => {
    expect(starterIsTop(ROOT, [ROOT])).toBe(true);
  });
  it("trưởng phòng con (không có trong danh sách trưởng gốc) ⇒ Sai", () => {
    expect(starterIsTop(CHILD, [ROOT])).toBe(false);
  });
  it("thành viên phòng gốc không phải trưởng ⇒ Sai", () => {
    expect(starterIsTop(NGAN, [ROOT])).toBe(false);
  });
  it("không người gửi (hệ thống) ⇒ Sai, kể cả khi phòng gốc chưa có trưởng", () => {
    expect(starterIsTop(null, [ROOT])).toBe(false);
    expect(starterIsTop(null, [null])).toBe(false);
  });
  it("phòng gốc chưa có trưởng ⇒ Sai", () => {
    expect(starterIsTop(NGAN, [null])).toBe(false);
    expect(starterIsTop(NGAN, [])).toBe(false);
  });
  it("nhiều phòng gốc: trưởng của một trong số đó ⇒ Đúng", () => {
    expect(starterIsTop(CHILD, [ROOT, CHILD])).toBe(true);
  });
});

describe("CR-160 · tách khoá + gộp dữ kiện", () => {
  it("starter_is_top đi về engine, khoá khác về app", () => {
    expect(splitFactKeys(["total_value", "starter_is_top"])).toEqual({
      core: ["starter_is_top"],
      app: ["total_value"],
    });
    expect(splitFactKeys([])).toEqual({ core: [], app: [] });
  });
  it("gộp: cả hai trống ⇒ null; lõi thắng khi trùng", () => {
    expect(mergeFacts(null, null)).toBeNull();
    expect(mergeFacts({ a: 1 }, null)).toEqual({ a: 1 });
    expect(mergeFacts(null, { starter_is_top: true })).toEqual({ starter_is_top: true });
    expect(mergeFacts({ starter_is_top: false, a: 1 }, { starter_is_top: true })).toEqual({
      starter_is_top: true,
      a: 1,
    });
  });
});
