// CR-182 · fix-cr182-ui · lỗi 4: khung chứa đủ sơ đồ ở zoom 1 ⇒ chữ thẻ bước ≥ 12px (caption).
import { describe, expect, test } from "bun:test";
import { flowBox } from "./flow-box";

const nodes = [
  { position: { x: 0, y: 0 }, width: 240, height: 104 },
  { position: { x: 0, y: 200 }, width: 240, height: 104 },
  { position: { x: 400, y: 1600 }, width: 240, height: 104 },
];

describe("flowBox", () => {
  test("sơ đồ dài ⇒ khung đủ để vùng thấy được (khung × 0.84) chứa trọn sơ đồ ⇒ zoom 1, chữ 12px giữ nguyên", () => {
    const box = flowBox(nodes);
    expect(box.width * 0.84).toBeGreaterThanOrEqual(640);
    expect(box.height * 0.84).toBeGreaterThanOrEqual(1704);
    expect(box.height).toBeGreaterThan(520); // dài hơn khung nhìn ⇒ cuộn dọc, không ép vừa
  });
  test("không có node ⇒ 0", () => {
    expect(flowBox([])).toEqual({ width: 0, height: 0 });
  });
});
