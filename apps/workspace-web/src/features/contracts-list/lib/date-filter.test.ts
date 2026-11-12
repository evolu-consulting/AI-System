// Gap #10 · CR-127 K6: phân tích/dựng tham số của lọc ngày (chỉ còn cột "Hiệu lực đến" — `action_deadline` đã gỡ).
import { describe, expect, test } from "bun:test";
import {
  applyDateAction,
  dateFilterOf,
  dateParams,
  isDateActive,
  parseDateSearch,
  toDateSearch,
} from "./date-filter";

describe("lọc ngày · URL ↔ bộ lọc ↔ tham số API", () => {
  test("parse: giữ khoá hợp lệ, bỏ rác; due thắng khoảng; ngày sai bị bỏ; cột đã gỡ bị bỏ", () => {
    expect(parseDateSearch({ due: "30", df: "2026-01-01" })).toEqual({ due: "30" });
    expect(parseDateSearch({ df: "2026-01-01", dt: "2026-02-30x" })).toEqual({ df: "2026-01-01" });
    expect(parseDateSearch({ due: "7", dfield: "x", dt: "2026-13-45" })).toEqual({});
    expect(parseDateSearch({ dfield: "action_deadline" })).toEqual({});
    expect(parseDateSearch({ dfield: "end_date" })).toEqual({});
  });
  test("không lọc ⇒ không tham số; due ⇒ date_field + due; khoảng ⇒ from/to", () => {
    expect(dateParams(dateFilterOf({}))).toEqual([]);
    expect(dateParams(dateFilterOf({ due: "overdue" }))).toEqual([
      ["date_field", "end_date"],
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
  test("hai thao tác liên tiếp trên CÙNG search cũ: giữ cả hai; khoá khác giữ nguyên", () => {
    const start = { type: "deal" };
    const a = applyDateAction(applyDateAction(start, { type: "mode", mode: "overdue" }), {
      type: "field",
      field: "end_date",
    });
    expect(dateFilterOf(parseDateSearch(a))).toEqual({ field: "end_date", due: "overdue" });
    expect((a as { type: string }).type).toBe("deal");
    const r = applyDateAction(applyDateAction({}, { type: "from", value: "2026-01-01" }), {
      type: "to",
      value: "2026-03-31",
    });
    expect(dateFilterOf(parseDateSearch(r))).toEqual({
      field: "end_date",
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(parseDateSearch(applyDateAction(r, { type: "mode", mode: "60" }))).toEqual({
      due: "60",
    });
    expect(parseDateSearch(applyDateAction(r, { type: "mode", mode: "" }))).toEqual({});
  });
});
