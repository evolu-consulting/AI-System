// CR-121 Q-1 · unit: nhãn HĐ hiển thị ở trang chi tiết lượt chạy.
import { describe, expect, it } from "bun:test";
import { contractRecordLabel } from "./record-label.repo";

describe("contractRecordLabel", () => {
  it("có số + tên ⇒ HĐ <số> · <tên>", () =>
    expect(contractRecordLabel({ number: "HĐ-2026/01", title: "Thuê kho" })).toBe(
      "HĐ HĐ-2026/01 · Thuê kho",
    ));
  it("thiếu số ⇒ HĐ <tên>", () =>
    expect(contractRecordLabel({ number: null, title: "Thuê kho" })).toBe("HĐ Thuê kho"));
});
