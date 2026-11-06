// CR-121 c15 · chip bước dùng chung: tên bước, tối đa 4 + "+N"; nhãn điều kiện của dòng thư viện.
import { describe, expect, test } from "bun:test";
import { libraryChips, libraryConditions, MAX_CHIPS, splitChips, stepsDisplay } from "./step-chips";

const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Bước ${i + 1}` }));

describe("splitChips", () => {
  test("≤ 4 bước ⇒ hiện hết, không +N", () => {
    expect(splitChips(steps(4))).toEqual({ shown: steps(4), rest: [] });
  });
  test("7 bước ⇒ 4 chip + 3 còn lại (+3)", () => {
    const r = splitChips(steps(7));
    expect(MAX_CHIPS).toBe(4);
    expect(r.shown.map((s) => s.name)).toEqual(["Bước 1", "Bước 2", "Bước 3", "Bước 4"]);
    expect(r.rest).toHaveLength(3);
  });
});

describe("splitChips · ngân sách ký tự (không cắt giữa chữ)", () => {
  test("tên dài ⇒ gộp sớm vào +N, nguyên chip; luôn hiện ≥ 1 chip", () => {
    const long = [
      { name: "Phân tích lỗi và kiểm tra" },
      { name: "Pháp chế duyệt" },
      { name: "Giám đốc" },
    ];
    const r = splitChips(long);
    expect(r.shown.map((s) => s.name)).toEqual(["Phân tích lỗi và kiểm tra", "Pháp chế duyệt"]);
    expect(r.rest).toHaveLength(1);
    expect(splitChips([{ name: "x".repeat(80) }, { name: "y" }]).shown).toHaveLength(1);
  });
});
describe("libraryChips / libraryConditions", () => {
  test("chip là TÊN bước theo thứ tự, khoá duy nhất kể cả tên trùng; thiếu dữ liệu ⇒ []", () => {
    const c = libraryChips({ steps: [{ name: "Duyệt" }, { name: "Duyệt" }] });
    expect(c.map((x) => x.name)).toEqual(["Duyệt", "Duyệt"]);
    expect(new Set(c.map((x) => x.key)).size).toBe(2);
    expect(c.map((x) => x.index)).toEqual([1, 2]);
    expect(libraryChips({})).toEqual([]);
  });
  test("nhãn điều kiện bằng lời, bỏ trùng; không điều kiện ⇒ []", () => {
    const when = { op: "and", conds: [{ field: "value", op: "ge", value: 500_000_000 }] };
    expect(
      libraryConditions({ steps: [{ name: "A" }, { name: "B", when }, { name: "C", when }] }),
    ).toEqual(["Chỉ khi giá trị ≥ 500 tr"]);
    expect(libraryConditions({ steps: [{ name: "A" }] })).toEqual([]);
    expect(libraryConditions({})).toEqual([]);
  });
});

describe("CR-121 f17 · cột Các bước một kiểu", () => {
  test("có tên ⇒ chip; không có tên ⇒ viên đếm 'N bước'; không có gì ⇒ none", () => {
    expect(stepsDisplay({ steps: [{ name: "A" }], stage_count: 1 }).kind).toBe("chips");
    expect(stepsDisplay({ stage_count: 7 })).toEqual({ kind: "count", n: 7 });
    expect(stepsDisplay({ steps: [], stage_count: 7 })).toEqual({ kind: "count", n: 7 });
    expect(stepsDisplay({ stage_count: 0 })).toEqual({ kind: "none" });
  });
});
