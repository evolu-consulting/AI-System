// HUB-FR-124 · P-d2 · D2-44 · T20-FE: input kiểu `number` trong form `!key` — kiểm số, dựng request, lỗi server.
import { describe, expect, test } from "bun:test";
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { isNumberText, NUMBER_INPUT_INVALID_KEY } from "../../domain/number-input";
import { emptyValues, fieldErrors, serverNumberErrors, toRequestInputs } from "./inputs-rules";

const defs: ProcessInputDef[] = [
  { key: "so_tien", label: "Số tiền", type: "number", required: true },
  { key: "ten", label: "Tên", type: "text", required: false },
];
const withVal = (v: string) => ({
  ...emptyValues(defs),
  so_tien: { value: v, fileName: "", branch: "" },
});

describe("isNumberText", () => {
  test("số hữu hạn (cả âm, thập phân, mũ); rỗng/chữ/Infinity ⇒ false", () => {
    for (const s of ["0", "-3", "12.5", " 7 ", "1e3"]) expect(isNumberText(s)).toBe(true);
    for (const s of ["", "  ", "abc", "1,5", "Infinity"]) expect(isNumberText(s)).toBe(false);
    expect(NUMBER_INPUT_INVALID_KEY).toBe("process.inputs.err.number.invalid");
  });
});

describe("form !key · number", () => {
  test("không phải số ⇒ lỗi numberInvalid; rỗng/hợp lệ ⇒ không lỗi", () => {
    expect(fieldErrors(defs, withVal("abc"))).toEqual({ so_tien: "numberInvalid" });
    expect(fieldErrors(defs, withVal(""))).toEqual({});
    expect(fieldErrors(defs, withVal("20000000"))).toEqual({});
  });
  test("request mang {type:'number', value: chuỗi đã trim}; rỗng bị bỏ", () => {
    expect(toRequestInputs(defs, withVal(" 15 "))).toEqual([
      { type: "number", key: "so_tien", value: "15" },
    ]);
    expect(toRequestInputs(defs, withVal(""))).toEqual([]);
  });
  test("serverNumberErrors: path inputs.i.value theo mảng đã gửi, chỉ trường number", () => {
    const sent = toRequestInputs(defs, {
      ...withVal("1"),
      ten: { value: "x", fileName: "", branch: "" },
    });
    expect(serverNumberErrors(sent, ["inputs.0.value"])).toEqual(["so_tien"]);
    expect(serverNumberErrors(sent, ["inputs.1.value", "name", "inputs.9.value"])).toEqual([]);
  });
});
