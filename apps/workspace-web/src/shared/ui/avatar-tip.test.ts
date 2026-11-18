// CR-182 · fix-cr182-ui · lỗi 3: chạm avatar (điện thoại) hiện tên, không bị `click` đi kèm đóng ngay.
import { describe, expect, test } from "bun:test";
import { ignoreClose } from "./AvatarTip";

describe("AvatarTip · chạm", () => {
  test("đóng ngay sau chạm bị bỏ qua, đóng muộn hơn thì cho phép", () => {
    expect(ignoreClose(1000, 900)).toBe(true);
    expect(ignoreClose(2000, 900)).toBe(false);
    expect(ignoreClose(1000, 0)).toBe(false);
  });
});
