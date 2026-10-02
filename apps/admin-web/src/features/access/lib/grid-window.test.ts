// ADM-FR-35 · cửa sổ hoá lưới: biên đầu/cuối, count nhỏ hơn viewport, overscan, count = 0.
import { describe, expect, test } from "bun:test";
import { visibleRange } from "./grid-window";

const r = (scroll: number, viewport: number, count: number, overscan = 0) =>
  visibleRange({ scroll, viewport, size: 100, count, overscan });

describe("ADM-FR-35 · visibleRange", () => {
  test("đầu danh sách, giữa, cuối", () => {
    expect(r(0, 300, 50)).toEqual({ start: 0, end: 3 });
    expect(r(250, 300, 50)).toEqual({ start: 2, end: 6 });
    expect(r(4800, 300, 50)).toEqual({ start: 48, end: 50 });
  });

  test("overscan mở hai phía nhưng không vượt biên", () => {
    expect(r(250, 300, 50, 3)).toEqual({ start: 0, end: 9 });
    expect(r(0, 300, 50, 3)).toEqual({ start: 0, end: 6 });
  });

  test("count nhỏ hơn viewport, count = 0, cuộn âm", () => {
    expect(r(0, 1000, 4)).toEqual({ start: 0, end: 4 });
    expect(r(0, 300, 0)).toEqual({ start: 0, end: 0 });
    expect(r(-50, 300, 50)).toEqual({ start: 0, end: 3 });
  });

  test("200 cột × 120 px: chỉ ~ một cửa sổ nhỏ được dựng", () => {
    const { start, end } = visibleRange({ scroll: 6000, viewport: 900, size: 120, count: 200 });
    expect(end - start).toBeLessThan(20);
  });
});
