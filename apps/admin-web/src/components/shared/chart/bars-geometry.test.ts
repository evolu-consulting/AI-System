import { describe, expect, test } from "bun:test";
import { layoutBars } from "./bars-geometry";

describe("ADM-FR-42 · layoutBars", () => {
  test("rỗng → không cột, không peak", () => {
    const l = layoutBars([], 600, 100);
    expect(l.bars).toEqual([]);
    expect(l.peak).toBeNull();
    expect(l.sum).toBe(0);
  });

  test("ngày cao nhất đầy chiều cao, tỉ lệ các ngày khác", () => {
    const l = layoutBars(
      [
        { date: "2026-10-01", total: "10.00", over: "0" },
        { date: "2026-10-02", total: "20.00", over: "5.00" },
      ],
      600,
      100,
    );
    expect(l.peak).toEqual({ date: "2026-10-02", total: 20 });
    expect(l.sum).toBe(30);
    const [a, b] = l.bars;
    expect(a?.hIn).toBeCloseTo(50);
    expect(b?.hIn).toBeCloseTo(75);
    expect(b?.hOver).toBeCloseTo(25);
    expect(b?.yOver).toBeCloseTo(0);
    expect(b?.yIn).toBeCloseTo(25);
  });

  test("over bị chặn ≤ total; giá trị lạ/âm → 0; ngày >0 luôn ≥ 1px", () => {
    const l = layoutBars(
      [
        { date: "a", total: 1, over: 99 },
        { date: "b", total: "x", over: -1 },
        { date: "c", total: 0.0001, over: 0 },
        { date: "d", total: 1000000, over: 0 },
      ],
      400,
      100,
    );
    expect(l.bars[0]?.over).toBe(1);
    expect(l.bars[1]?.total).toBe(0);
    expect(l.bars[1]?.hIn).toBe(0);
    expect(l.bars[2]?.hIn).toBeGreaterThanOrEqual(1);
  });

  test("mọi ngày bằng 0 → không peak", () => {
    expect(layoutBars([{ date: "a", total: 0, over: 0 }], 100, 50).peak).toBeNull();
  });
});
