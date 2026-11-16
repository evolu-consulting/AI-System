// CR-179 · TruncText: hàm đo tràn (render tĩnh test ở apps/workspace-web, nơi có react-dom).
import { describe, expect, test } from "bun:test";
import { isOverflowing } from "./trunc-text";

const box = (o: Partial<Parameters<typeof isOverflowing>[0]>) => ({
  scrollWidth: 100,
  clientWidth: 100,
  scrollHeight: 20,
  clientHeight: 20,
  ...o,
});

describe("isOverflowing", () => {
  test("một dòng: so bề ngang, dung sai 1px", () => {
    expect(isOverflowing(box({ scrollWidth: 160 }))).toBe(true);
    expect(isOverflowing(box({ scrollWidth: 101 }))).toBe(false);
    expect(isOverflowing(box({}))).toBe(false);
  });
  test("hai dòng: so bề cao, bỏ qua bề ngang", () => {
    expect(isOverflowing(box({ scrollHeight: 60 }), 2)).toBe(true);
    expect(isOverflowing(box({ scrollWidth: 300 }), 2)).toBe(false);
  });
});
