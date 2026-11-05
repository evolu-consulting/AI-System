import { describe, expect, test } from "bun:test";
import { applyFilters, buildChips, type FilterGroup, isFiltered, toggleValue } from "./list-filter";

const groups = (status?: string, app?: string): FilterGroup[] => [
  {
    id: "status",
    label: "Trạng thái",
    value: status,
    options: [
      { value: "on", label: "Bật" },
      { value: "off", label: "Tắt" },
    ],
  },
  { id: "app", label: "Ứng dụng", value: app, options: [{ value: "x", label: "X" }] },
];

describe("list-filter", () => {
  test("toggleValue: chọn mới / bấm lại thì bỏ", () => {
    expect(toggleValue(undefined, "on")).toBe("on");
    expect(toggleValue("on", "off")).toBe("off");
    expect(toggleValue("on", "on")).toBeUndefined();
  });
  test("buildChips: một chip mỗi nhóm đang chọn, bỏ giá trị lạ", () => {
    expect(buildChips(groups())).toEqual([]);
    expect(buildChips(groups("on", "x")).map((c) => `${c.groupId}:${c.label}`)).toEqual([
      "status:Bật",
      "app:X",
    ]);
    expect(buildChips(groups("zzz"))).toEqual([]);
  });
  test("isFiltered: có chip hoặc có từ khoá", () => {
    expect(isFiltered(groups())).toBe(false);
    expect(isFiltered(groups(), "  ")).toBe(false);
    expect(isFiltered(groups(), "a")).toBe(true);
    expect(isFiltered(groups("off"))).toBe(true);
  });
  test("applyFilters: AND các nhóm đang chọn", () => {
    const rows = [
      { s: "on", a: "x" },
      { s: "off", a: "x" },
      { s: "on", a: "y" },
    ];
    const pick = (r: { s: string; a: string }, id: string) => (id === "status" ? r.s : r.a);
    expect(applyFilters(rows, groups(), pick)).toHaveLength(3);
    expect(applyFilters(rows, groups("on"), pick)).toHaveLength(2);
    expect(applyFilters(rows, groups("on", "x"), pick)).toEqual([{ s: "on", a: "x" }]);
  });
});
