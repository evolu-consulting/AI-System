// Gap #10: phân tích/dựng tham số của lọc ngày.
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
  test("hai thao tác liên tiếp trên CÙNG search cũ: giữ cả hai (không ghi đè theo bộ lọc đã vẽ); khoá khác giữ nguyên", () => {
    const start = { type: "deal" };
    // cột rồi cửa sổ; mỗi bước đọc search do bước trước trả về (functional update của router)
    const a = applyDateAction(start, { type: "field", field: "action_deadline" });
    const b = applyDateAction(a, { type: "mode", mode: "overdue" });
    expect(b).toEqual({
      type: "deal",
      dfield: "action_deadline",
      due: "overdue",
      df: undefined,
      dt: undefined,
    });
    // thứ tự ngược: cửa sổ rồi cột
    const c = applyDateAction(applyDateAction(start, { type: "mode", mode: "30" }), {
      type: "field",
      field: "action_deadline",
    });
    expect(dateFilterOf(parseDateSearch(c))).toEqual({ field: "action_deadline", due: "30" });
    // khoảng: từ rồi đến; chọn cửa sổ tương đối thì xoá khoảng
    const r = applyDateAction(
      applyDateAction({ dfield: "action_deadline" }, { type: "from", value: "2026-01-01" }),
      { type: "to", value: "2026-03-31" },
    );
    expect(dateFilterOf(parseDateSearch(r))).toEqual({
      field: "action_deadline",
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(parseDateSearch(applyDateAction(r, { type: "mode", mode: "60" }))).toEqual({
      dfield: "action_deadline",
      due: "60",
    });
    expect(parseDateSearch(applyDateAction(r, { type: "mode", mode: "" }))).toEqual({
      dfield: "action_deadline",
    });
  });
});
