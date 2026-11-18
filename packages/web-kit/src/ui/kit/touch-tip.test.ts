// CR-185 · TouchTip: lệnh đóng ngay sau chạm là `click` đi kèm ⇒ bỏ qua.
import { describe, expect, test } from "bun:test";
import { ignoreClose } from "./touch-tip";

describe("TouchTip", () => {
  test("đóng ngay sau chạm bị bỏ qua, đóng muộn hơn thì cho phép", () => {
    expect(ignoreClose(1000, 900)).toBe(true);
    expect(ignoreClose(2000, 900)).toBe(false);
    expect(ignoreClose(1000, 0)).toBe(false);
  });
});
