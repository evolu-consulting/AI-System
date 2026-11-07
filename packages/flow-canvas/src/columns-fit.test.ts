// CR-123 · u11: zoom mở đầu của canvas `columns` — flow dài KHÔNG thu nhỏ dưới mức đọc được, hiện trọn số cột nguyên (không cắt node ở mép phải).
import { describe, expect, test } from "bun:test";
import { snapColumnsZoom } from "./columns-fit";
import { COL_W, NODE_W } from "./layout/columns";

describe("snapColumnsZoom", () => {
  test("khung 1100px ⇒ 4 cột trọn, chữ ≥ 0.75, cột thứ 5 bắt đầu ở/ngoài mép phải", () => {
    const { cols, zoom } = snapColumnsZoom(1100, 0.75);
    expect(cols).toBe(4);
    expect(zoom).toBeGreaterThanOrEqual(0.75);
    expect(16 + cols * COL_W * zoom).toBeGreaterThanOrEqual(1100 - 0.001);
    expect(16 + ((cols - 1) * COL_W + NODE_W) * zoom).toBeLessThan(1100);
  });

  test("khung 940px ⇒ 3 cột; khung rất hẹp ⇒ ít nhất 1 cột", () => {
    expect(snapColumnsZoom(940, 0.75).cols).toBe(3);
    expect(snapColumnsZoom(100, 0.75).cols).toBe(1);
  });

  test("khung rộng ⇒ không phóng quá 1", () => {
    expect(snapColumnsZoom(5000, 0.75).zoom).toBeLessThanOrEqual(1);
  });
});
