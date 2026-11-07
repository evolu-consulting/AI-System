// CR-125 · x11 · luật "vừa khung" duy nhất: cả flow (kể cả cột Kết thúc ở cuối) nằm trọn trong vùng thấy được.
import { describe, expect, test } from "bun:test";
import { type FitBounds, fitViewport, insideView } from "./fit";

const size = { w: 1100, h: 520 };
/** Hộp bao flow demo: Bắt đầu khi → … → Ký số → Kế toán duyệt chi → cột Kết thúc (≈ 1850 × 440 đơn vị). */
const demo: FitBounds = { x: 12, y: 12, w: 1850, h: 440 };

describe("fitViewport", () => {
  test("flow demo rộng hơn khung: thu nhỏ tới mức cần, TOÀN BỘ node (kể cả cột cuối) nằm trong khung", () => {
    const v = fitViewport(demo, { size, minZoom: 0.15 });
    expect(v.zoom).toBeLessThan(0.55);
    expect(v.zoom).toBeGreaterThan(0.15);
    expect(insideView(demo, v, { size })).toBe(true);
    // đầu phải của cột Kết thúc cũng thấy
    const endRight = (demo.x + demo.w) * v.zoom + v.x;
    expect(endRight).toBeLessThanOrEqual(size.w);
  });
  test("không còn sàn 'đọc được': flow rộng 3000 vẫn vừa khung ở zoom ≈ 0.3", () => {
    const wide: FitBounds = { x: 0, y: 0, w: 3000, h: 400 };
    const v = fitViewport(wide, { size, minZoom: 0.15 });
    expect(v.zoom).toBeCloseTo((1100 * 0.84) / 3000, 3);
    expect(insideView(wide, v, { size })).toBe(true);
  });
  test("flow nhỏ: không phóng to quá cỡ thật, nằm giữa khung", () => {
    const small: FitBounds = { x: 0, y: 0, w: 400, h: 200 };
    const v = fitViewport(small, { size, minZoom: 0.15 });
    expect(v.zoom).toBe(1);
    expect(v.x + (400 * v.zoom) / 2).toBeCloseTo(550, 1);
    expect(v.y + (200 * v.zoom) / 2).toBeCloseTo(260, 1);
  });
  test("ngăn chi tiết mở: fit vào phần còn lại bên trái ngăn", () => {
    const v = fitViewport(demo, { size, inset: 460, minZoom: 0.15 });
    expect(insideView(demo, v, { size, inset: 460 })).toBe(true);
    expect(fitViewport(demo, { size, minZoom: 0.15 }).zoom).toBeGreaterThan(v.zoom);
  });
  test("cao hơn rộng (Dọc): theo chiều cao", () => {
    const tall: FitBounds = { x: 0, y: 0, w: 600, h: 1800 };
    const v = fitViewport(tall, { size, minZoom: 0.15 });
    expect(v.zoom).toBeCloseTo((520 * 0.84) / 1800, 3);
    expect(insideView(tall, v, { size })).toBe(true);
  });
  test("quá lớn cho cả mức tối thiểu của canvas: giữ mức tối thiểu, neo mép trái/trên", () => {
    const huge: FitBounds = { x: 100, y: 50, w: 20000, h: 400 };
    const v = fitViewport(huge, { size, minZoom: 0.15 });
    expect(v.zoom).toBe(0.15);
    expect(v.x).toBeCloseTo(16 - 100 * 0.15, 5);
    expect(v.y).toBeCloseTo(16 - 50 * 0.15, 5);
  });
});
