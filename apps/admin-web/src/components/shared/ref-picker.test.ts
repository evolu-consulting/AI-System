// ADM-FR-20, ADM-FR-30 · M2 · RefPicker: lọc, giới hạn 50, di chuyển bằng phím.
import { describe, expect, test } from "bun:test";
import { moveActive, type PickerOption, visibleOptions } from "./ref-picker";

const opts = (n: number): PickerOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `id${i}`, label: `Mục ${i}` }));

describe("ADM-FR-20 · RefPicker · visibleOptions", () => {
  test("cắt còn 50 mục và báo số còn lại", () => {
    const r = visibleOptions(opts(120), undefined, "");
    expect(r.shown).toHaveLength(50);
    expect(r.more).toBe(70);
  });

  test("bỏ mục đã chọn", () => {
    const r = visibleOptions(opts(3), ["id1"], "");
    expect(r.shown.map((o) => o.id)).toEqual(["id0", "id2"]);
    expect(r.more).toBe(0);
  });

  test("lọc không phân biệt hoa thường và dấu, tìm cả trong hint", () => {
    const list: PickerOption[] = [
      { id: "a", label: "Dịch thuật", hint: "dich" },
      { id: "b", label: "Kế toán", hint: "ke-toan" },
    ];
    expect(visibleOptions(list, [], "DỊCH").shown.map((o) => o.id)).toEqual(["a"]);
    expect(visibleOptions(list, [], "ke-t").shown.map((o) => o.id)).toEqual(["b"]);
    expect(visibleOptions(list, [], "zzz").shown).toEqual([]);
  });

  test("moveActive không vòng và xử lý danh sách rỗng", () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(2, 1, 3)).toBe(2);
    expect(moveActive(0, -1, 3)).toBe(0);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
