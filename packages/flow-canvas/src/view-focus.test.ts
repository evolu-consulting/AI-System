// CR-123 · u14 · khung nhìn đi theo node vừa thả / vừa nối: tính khung nhìn đích (hàm thuần).
import { describe, expect, test } from "bun:test";
import { type FocusBox, focusViewport } from "./view-focus";

const size = { w: 1100, h: 458 };
const box = (x: number, y: number): FocusBox => ({ x, y, w: 240, h: 104 });
const vp = { x: 0, y: 0, zoom: 1 };

describe("focusViewport", () => {
  test("đã nằm trọn trong khung ⇒ null (không dịch chuyển thừa)", () => {
    expect(focusViewport([box(100, 100), box(400, 100)], vp, size, 0, 0.75)).toBeNull();
  });

  test("node mới nằm nửa ngoài khung ⇒ khung nhìn đích đưa nó (cùng node vừa nối) vào trọn khung, zoom giữ nguyên", () => {
    const boxes = [box(950, 300), box(600, 100)]; // node mới tràn mép phải
    const t = focusViewport(boxes, vp, size, 0, 0.75);
    expect(t).not.toBeNull();
    const v = t as { x: number; y: number; zoom: number };
    expect(v.zoom).toBe(1);
    for (const b of boxes) {
      expect(b.x * v.zoom + v.x).toBeGreaterThanOrEqual(24 - 0.5);
      expect((b.x + b.w) * v.zoom + v.x).toBeLessThanOrEqual(size.w - 24 + 0.5);
      expect(b.y * v.zoom + v.y).toBeGreaterThanOrEqual(24 - 0.5);
      expect((b.y + b.h) * v.zoom + v.y).toBeLessThanOrEqual(size.h - 24 + 0.5);
    }
  });

  test("hai node xa nhau: thu nhỏ vừa đủ nhưng KHÔNG dưới 0.75 và không phóng to", () => {
    const t = focusViewport([box(0, 0), box(1000, 200)], vp, size, 0, 0.75) as {
      zoom: number;
    };
    expect(t.zoom).toBeLessThan(1);
    expect(t.zoom).toBeGreaterThanOrEqual(0.75);
    const zoomed = focusViewport([box(2000, 100)], { x: 0, y: 0, zoom: 0.8 }, size, 0, 0.75) as {
      zoom: number;
    };
    expect(zoomed.zoom).toBe(0.8);
  });

  test("không vừa ở 0.75 ⇒ chỉ cần thấy trọn node ĐẦU (node mới)", () => {
    const first = box(1000, 100);
    const t = focusViewport([first, box(3000, 100)], vp, size, 0, 0.75) as {
      x: number;
      zoom: number;
    };
    expect(t.zoom).toBeGreaterThanOrEqual(0.75);
    expect(first.x * t.zoom + t.x).toBeGreaterThanOrEqual(24 - 0.5);
    expect((first.x + first.w) * t.zoom + t.x).toBeLessThanOrEqual(size.w - 24 + 0.5);
  });

  test("ngăn chi tiết đè mép phải (inset) ⇒ vùng thấy được thu hẹp", () => {
    expect(focusViewport([box(700, 100)], vp, size, 400, 0.75)).not.toBeNull(); // 700+240 > 1100-400-24
    expect(focusViewport([], vp, size, 0, 0.75)).toBeNull();
  });

  test("zoom đang dưới 0.75 ⇒ đưa lên 0.75 khi node vừa khung", () => {
    const t = focusViewport([box(100, 100)], { x: 0, y: 0, zoom: 0.5 }, size, 0, 0.75) as {
      zoom: number;
    };
    expect(t.zoom).toBe(0.75);
  });
});
