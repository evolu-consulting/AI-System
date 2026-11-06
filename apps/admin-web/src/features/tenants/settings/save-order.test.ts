// CR-121 c14b · thứ tự lưu của thanh lưu chung (Thông tin trước Quota; chỉ form đang thay đổi).
import { describe, expect, it } from "bun:test";
import { saveOrder } from "./save-order";

describe("CR-121 c14b · saveOrder", () => {
  it("chỉ form đang đổi; cả hai ⇒ Thông tin trước Quota", () => {
    expect(saveOrder({ info: false, quota: false })).toEqual([]);
    expect(saveOrder({ info: false, quota: true })).toEqual(["quota"]);
    expect(saveOrder({ info: true, quota: false })).toEqual(["info"]);
    expect(saveOrder({ info: true, quota: true })).toEqual(["info", "quota"]);
  });
});
