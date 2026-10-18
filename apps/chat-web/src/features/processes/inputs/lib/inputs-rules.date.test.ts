// HUB-FR-143 · P-d1 T11c · trường `date` của form `!key`: validate client, dựng request, ánh xạ 400 theo trường.
import { describe, expect, test } from "bun:test";
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { emptyValues, fieldErrors, serverDateErrors, toRequestInputs } from "./inputs-rules";

const defs = [
  { key: "due", label: "Ngày giao", type: "date", required: true },
  { key: "note", label: "Ghi chú", type: "text", required: false },
] as unknown as ProcessInputDef[];

const withDate = (value: string) => ({
  ...emptyValues(defs),
  due: { value, fileName: "", branch: "" },
});

describe("HUB-FR-143 · input date", () => {
  test("ngày không có thật ⇒ lỗi dateInvalid; rỗng/hợp lệ ⇒ không lỗi", () => {
    expect(fieldErrors(defs, withDate("2026-02-30"))).toEqual({ due: "dateInvalid" });
    expect(fieldErrors(defs, withDate("2026-12-14"))).toEqual({});
    expect(fieldErrors(defs, withDate(""))).toEqual({});
  });

  test("toRequestInputs: nhánh date không bị bỏ lặng lẽ", () => {
    expect(toRequestInputs(defs, withDate("2026-12-14"))).toEqual([
      { type: "date", key: "due", value: "2026-12-14" },
    ]);
    expect(toRequestInputs(defs, withDate(""))).toEqual([]);
  });

  test("serverDateErrors: path inputs.i.value theo mảng đã gửi, chỉ trường date", () => {
    const sent = toRequestInputs(defs, {
      ...withDate("2026-12-14"),
      note: { value: "x", fileName: "", branch: "" },
    });
    expect(serverDateErrors(sent, ["inputs.0.value"])).toEqual(["due"]);
    expect(serverDateErrors(sent, ["inputs.1.value", "name", "inputs.9.value"])).toEqual([]);
  });
});
