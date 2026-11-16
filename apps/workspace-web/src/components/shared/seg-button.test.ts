// CR-177 W1: mũi tên trong nhóm nút chọn một.
import { describe, expect, test } from "bun:test";
import { radioStep } from "./seg-button";

describe("radioStep", () => {
  test("→/↓ đi tới, ←/↑ đi lui, đi vòng hai đầu", () => {
    expect(radioStep("ArrowRight", 0, 3)).toBe(1);
    expect(radioStep("ArrowDown", 2, 3)).toBe(0);
    expect(radioStep("ArrowLeft", 0, 3)).toBe(2);
    expect(radioStep("ArrowUp", 2, 3)).toBe(1);
  });
  test("Home/End nhảy đầu/cuối; phím khác hoặc nhóm rỗng ⇒ null", () => {
    expect(radioStep("Home", 2, 3)).toBe(0);
    expect(radioStep("End", 0, 3)).toBe(2);
    expect(radioStep("a", 0, 3)).toBeNull();
    expect(radioStep("ArrowDown", -1, 3)).toBeNull();
    expect(radioStep("ArrowDown", 0, 0)).toBeNull();
  });
});
