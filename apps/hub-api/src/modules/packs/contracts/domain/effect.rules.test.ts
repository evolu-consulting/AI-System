// CR-127 K1a · BR-07 · spec §2.1: hiệu lực dẫn xuất (thay `statusOn`). Bảng ca dùng chung với int `refresh_effect` (SQL = TS).
import { describe, expect, it } from "bun:test";
import { CONTRACT_EFFECTS, EFFECT_CASES, effectOf, noticeDaysOf } from "./effect.rules";

describe("CR-127 K1a effect.rules", () => {
  it("6 giá trị", () => {
    expect([...CONTRACT_EFFECTS]).toEqual([
      "not_started",
      "active",
      "expiring",
      "expired",
      "renewed",
      "terminated",
    ]);
  });

  for (const c of EFFECT_CASES)
    it(c.name, () => {
      expect(effectOf(c.input, c.today)).toBe(c.want);
    });

  it("N = notice_days (số nguyên 0…3650), sai/thiếu ⇒ 30", () => {
    expect(noticeDaysOf(undefined)).toBe(30);
    expect(noticeDaysOf(null)).toBe(30);
    expect(noticeDaysOf(10)).toBe(10);
    expect(noticeDaysOf("45")).toBe(45);
    expect(noticeDaysOf(0)).toBe(0);
    expect(noticeDaysOf(-1)).toBe(30);
    expect(noticeDaysOf(1.5)).toBe(30);
    expect(noticeDaysOf("abc")).toBe(30);
    expect(noticeDaysOf(4000)).toBe(30);
    expect(noticeDaysOf("3651")).toBe(30);
  });
});
