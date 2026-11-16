// CR-177 W1: mũi tên trong menu tài khoản.
import { describe, expect, test } from "bun:test";
import { menuStep } from "./Popover";

describe("menuStep", () => {
  test("con trỏ chưa ở mục nào: ↓/Home vào mục đầu, ↑/End vào mục cuối", () => {
    expect(menuStep("ArrowDown", -1, 4)).toBe(0);
    expect(menuStep("ArrowUp", -1, 4)).toBe(3);
  });
  test("đang ở một mục: ↓ tới, ↑ lui, đi vòng; ←/→ và phím khác bỏ qua", () => {
    expect(menuStep("ArrowDown", 3, 4)).toBe(0);
    expect(menuStep("ArrowUp", 0, 4)).toBe(3);
    expect(menuStep("ArrowRight", 1, 4)).toBeNull();
    expect(menuStep("a", 1, 4)).toBeNull();
  });
});
