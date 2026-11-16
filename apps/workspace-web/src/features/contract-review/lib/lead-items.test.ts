import { expect, test } from "bun:test";
import { bareLabel, showFileItem } from "./lead-items";

test("bareLabel bỏ dấu «:» đuôi để điện thoại tự thêm", () => {
  expect(bareLabel("File ký:")).toBe("File ký");
  expect(bareLabel("Tệp: ")).toBe("Tệp");
  expect(bareLabel("Đối tác")).toBe("Đối tác");
});

test("showFileItem: HĐ nguyên tắc không có mục File ký trừ khi đã có tệp", () => {
  expect(showFileItem("contract", true, false)).toBe(true);
  expect(showFileItem("framework", true, false)).toBe(false);
  expect(showFileItem("framework", true, true)).toBe(true);
  expect(showFileItem(undefined, false, false)).toBe(false);
});
