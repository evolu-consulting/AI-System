// CR-123 · p25 · FLOW3-FR-06 · hoàn tác / làm lại: tối đa 100 bước, ghi mới xoá nhánh làm lại, gộp sửa liên tiếp cùng ô.
import { describe, expect, test } from "bun:test";
import { COALESCE_MS, emptyHistory, HISTORY_MAX, record, redo, undo } from "./edit-history";

describe("edit-history", () => {
  test("ghi 3 bước, lùi 2, tiến 1", () => {
    let h = emptyHistory<number>();
    let cur = 0;
    for (const next of [1, 2, 3]) {
      h = record(h, cur, undefined, 0);
      cur = next;
    }
    const u1 = undo(h, cur);
    expect(u1?.value).toBe(2);
    const u2 = undo(u1?.h ?? h, 2);
    expect(u2?.value).toBe(1);
    const r1 = redo(u2?.h ?? h, 1);
    expect(r1?.value).toBe(2);
  });

  test("hết lịch sử ⇒ null", () => {
    expect(undo(emptyHistory<number>(), 1)).toBeNull();
    expect(redo(emptyHistory<number>(), 1)).toBeNull();
  });

  test("thao tác mới sau khi lùi ⇒ xoá nhánh làm lại", () => {
    let h = record(emptyHistory<number>(), 0, undefined, 0);
    const u = undo(h, 1);
    h = record(u?.h ?? h, 0, undefined, 0);
    expect(h.future).toEqual([]);
  });

  test("tối đa 100 bước: bước cũ nhất rớt", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_MAX + 20; i++) h = record(h, i, undefined, 0);
    expect(h.past).toHaveLength(HISTORY_MAX);
    expect(h.past[0]).toBe(20);
  });

  test("sửa liên tiếp cùng ô trong thời gian ngắn gộp một bước; khác ô hoặc quá lâu thì tách", () => {
    let h = record(emptyHistory<string>(), "a", "stage:0", 0);
    h = record(h, "ab", "stage:0", 100);
    expect(h.past).toEqual(["a"]);
    h = record(h, "abc", "stage:1", 200);
    expect(h.past).toEqual(["a", "abc"]);
    h = record(h, "abcd", "stage:1", 200 + COALESCE_MS + 1);
    expect(h.past).toHaveLength(3);
  });
});
