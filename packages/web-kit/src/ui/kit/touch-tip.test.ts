// CR-185 · TouchTip: đường xử lý chạm — lệnh đóng đi kèm chạm bị bỏ qua; ngón rung nhẹ vẫn là chạm, kéo xa mới là cuộn.
import { describe, expect, test } from "bun:test";
import { ignoreClose, MOVE_PX, movedFar, SHOW_MS } from "./touch-tip";

describe("TouchTip", () => {
  test("đóng ngay sau chạm bị bỏ qua, đóng muộn hơn thì cho phép", () => {
    expect(ignoreClose(1000, 900)).toBe(true);
    expect(ignoreClose(2000, 900)).toBe(false);
    expect(ignoreClose(1000, 0)).toBe(false);
  });
  test("ngón tay rung vài px vẫn là chạm, kéo xa là cuộn", () => {
    expect(movedFar(2, 3)).toBe(false);
    expect(movedFar(MOVE_PX, 0)).toBe(false);
    expect(movedFar(0, MOVE_PX + 1)).toBe(true);
    expect(movedFar(8, 8)).toBe(true);
  });
  test("tên hiện đủ lâu để đọc", () => {
    expect(SHOW_MS).toBeGreaterThanOrEqual(2000);
  });
});
