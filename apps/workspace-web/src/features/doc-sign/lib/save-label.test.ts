// CR-182 · nhãn nút Lưu của màn ký trên điện thoại: bản gọn khi còn chỗ chưa ký.
import { describe, expect, test } from "bun:test";
import { saveKeys } from "./save-label";

describe("nhãn nút Lưu của màn ký", () => {
  test("ký còn chỗ chưa ký thì có nhãn gọn cho điện thoại", () => {
    expect(saveKeys("sign", 1)).toEqual({ full: "saveLeft", short: "saveLeftShort" });
  });
  test("ký đủ hoặc chuẩn bị chỗ ký thì nhãn đã ngắn, không cần bản gọn", () => {
    expect(saveKeys("sign", 0)).toEqual({ full: "saveSign", short: undefined });
    expect(saveKeys("prep", 3)).toEqual({ full: "savePlaces", short: undefined });
  });
});
