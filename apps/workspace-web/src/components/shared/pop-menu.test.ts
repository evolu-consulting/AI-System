import { describe, expect, test } from "bun:test";
import { menuPosition } from "./pop-menu";

// CR-166: menu `fixed` — mở xuống khi đủ chỗ, lật lên gần mép dưới.
describe("menuPosition", () => {
  test("đủ chỗ phía dưới ⇒ mở xuống, canh phải theo nút", () => {
    const p = menuPosition({ top: 100, bottom: 130, right: 900 }, 90, 1000, 800);
    expect(p.top).toBe(134);
    expect(p.bottom).toBeUndefined();
    expect(p.right).toBe(100);
  });
  test("gần mép dưới màn ⇒ lật lên", () => {
    const p = menuPosition({ top: 740, bottom: 770, right: 900 }, 90, 1000, 800);
    expect(p.bottom).toBe(64);
    expect(p.top).toBeUndefined();
  });
  test("cả hai phía đều chật ⇒ chọn phía rộng hơn, có maxHeight", () => {
    const p = menuPosition({ top: 300, bottom: 330, right: 500 }, 900, 1000, 800);
    expect(p.maxHeight).toBeGreaterThan(80);
  });
});
