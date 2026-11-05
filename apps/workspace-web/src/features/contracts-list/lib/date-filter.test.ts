// Gap #10: phân tích/dựng tham số của lọc ngày.
import { describe, expect, test } from "bun:test";
import {
  dateFilterOf,
  dateParams,
  isDateActive,
  parseDateSearch,
  toDateSearch,
} from "./date-filter";

describe("lọc ngày · URL ↔ bộ lọc ↔ tham số API", () => {
  test("parse: giữ khoá hợp lệ, bỏ rác; due thắng khoảng; ngày sai bị bỏ", () => {
    expect(parseDateSearch({ due: "30", df: "2026-01-01" })).toEqual({ due: "30" });
    expect(
      parseDateSearch({ dfield: "action_deadline", df: "2026-01-01", dt: "2026-02-30x" }),
    ).toEqual({
      dfield: "action_deadline",
      df: "2026-01-01",
    });
    expect(parseDateSearch({ due: "7", dfield: "x", dt: "2026-13-45" })).toEqual({});
    expect(parseDateSearch({ dfield: "end_date" })).toEqual({});
  });
  test("không lọc ⇒ không tham số; due ⇒ date_field + due; khoảng ⇒ from/to", () => {
    expect(dateParams(dateFilterOf({}))).toEqual([]);
    expect(dateParams(dateFilterOf({ dfield: "action_deadline", due: "overdue" }))).toEqual([
      ["date_field", "action_deadline"],
      ["due", "overdue"],
    ]);
    expect(dateParams(dateFilterOf({ df: "2026-01-01", dt: "2026-03-31" }))).toEqual([
      ["date_field", "end_date"],
      ["date_from", "2026-01-01"],
      ["date_to", "2026-03-31"],
    ]);
  });
  test("toDateSearch: mặc định ⇒ xoá khoá; chọn due ⇒ xoá khoảng", () => {
    expect(toDateSearch({ field: "end_date", due: "60", from: "2026-01-01" })).toEqual({
      dfield: undefined,
      due: "60",
      df: undefined,
      dt: undefined,
    });
    expect(isDateActive({ field: "end_date" })).toBe(false);
    expect(isDateActive({ field: "end_date", to: "2026-01-01" })).toBe(true);
  });
});
