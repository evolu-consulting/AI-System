// HUB-FR-132 · nhánh agent không phải CLI: bỏ tick = gỡ hết, ô chưa tick khoá, [Lưu] hiện khi dirty.
import { expect, test } from "bun:test";
import {
  applyChange,
  applyToggle,
  isDirty,
  KH_MAX,
  rowDisabled,
  showUntickNote,
} from "./knowledge-selection";

test("HUB-FR-132 · !cli: bỏ tick một ô gỡ toàn bộ (clear)", () => {
  expect(applyChange(["a", "b"], "a", false, false)).toEqual([]);
});

test("HUB-FR-132 · !cli: ô chưa tick disabled, ô đã tick vẫn bỏ tick được", () => {
  expect(rowDisabled(false, false, 1)).toBe(true);
  expect(rowDisabled(true, false, 1)).toBe(false);
});

test("HUB-FR-132 · !cli: [Lưu] hiện khi dirty sau clear, ẩn khi chưa đổi", () => {
  expect(isDirty(applyChange(["a"], "a", false, false), ["a"])).toBe(true);
  expect(isDirty(["a"], ["a"])).toBe(false);
});

test("HUB-FR-132 · chú thích gỡ toàn bộ chỉ hiện khi !cli và còn kết nối", () => {
  expect(showUntickNote(false, 2)).toBe(true);
  expect(showUntickNote(false, 0)).toBe(false);
  expect(showUntickNote(true, 2)).toBe(false);
});

test("HUB-FR-132 · cli: tick có thứ tự, tối đa KH_MAX", () => {
  expect(applyToggle(["a"], "b", true)).toEqual(["a", "b"]);
  const full = Array.from({ length: KH_MAX }, (_, i) => `k${i}`);
  expect(applyToggle(full, "x", true)).toEqual(full);
  expect(rowDisabled(false, true, KH_MAX)).toBe(true);
});
