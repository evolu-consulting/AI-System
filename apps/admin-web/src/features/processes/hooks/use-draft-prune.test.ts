// CR-127 · EO4 · lỗi theo bước là ảnh chụp lúc Lưu: sửa bước nào thì bỏ lỗi bước đó (không làm nút «Áp dụng» tắt mãi).
import { describe, expect, test } from "bun:test";
import { pruneStageErrors } from "./use-draft";

const a = { uid: "a" };
const b = { uid: "b" };
const errs = { "stages.0.after.group_id": "x", "stages.1.after.group_id": "y", name: "n" };

describe("pruneStageErrors", () => {
  test("bước 1 đổi, bước 0 giữ nguyên ⇒ chỉ bỏ lỗi bước 1; lỗi chung giữ", () => {
    expect(pruneStageErrors(errs, [a, b], [a, { uid: "b" }])).toEqual({
      "stages.0.after.group_id": "x",
      name: "n",
    });
  });
  test("không bước nào đổi ⇒ trả đúng đối tượng cũ", () => {
    expect(pruneStageErrors(errs, [a, b], [a, b])).toBe(errs);
  });
  test("thêm/xoá/đổi chỗ bước ⇒ bỏ mọi lỗi theo bước (chỉ số đã lệch), giữ lỗi chung", () => {
    expect(pruneStageErrors(errs, [a, b], [a, b, { uid: "c" }])).toEqual({ name: "n" });
    expect(pruneStageErrors(errs, [a, b], [b, a])).toEqual({ name: "n" });
  });
});
