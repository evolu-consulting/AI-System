// CR-118 · UW-FR-12 · cr118-flow-web · form bước `form`: client báo lỗi sớm theo ĐÚNG giới hạn Hub (flowFormValuesSchema).
import { describe, expect, test } from "bun:test";
import { type FlowForm, flowFormValuesSchema } from "@ai/contracts/flow";
import { checkForm, emptyDraft, type FormDraft } from "./form-values";

const FORM: FlowForm = {
  fields: [
    { key: "name", label: "Tên", type: "text", required: true, max_len: 10 },
    { key: "note", label: "Ghi chú", type: "textarea", required: false, max_len: 20 },
    {
      key: "qty",
      label: "Số lượng",
      type: "number",
      required: true,
      integer: true,
      min: 1,
      max: 5,
    },
    { key: "amount", label: "Tiền", type: "money", required: false, min: 1000, max: 50000 },
    { key: "due", label: "Hạn", type: "date", required: false },
    {
      key: "kind",
      label: "Loại",
      type: "select",
      required: true,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
    { key: "agree", label: "Đồng ý", type: "checkbox", required: true },
    { key: "file", label: "Tệp", type: "file_ref", required: false },
  ],
};
const OK: FormDraft = {
  name: "Công ty",
  note: "",
  qty: "3",
  amount: "",
  due: "",
  kind: "a",
  agree: true,
  file: "",
};
const errs = (d: FormDraft) => {
  const r = checkForm(FORM, { ...OK, ...d });
  return r.ok ? null : r.errors;
};

describe("checkForm", () => {
  test("hợp lệ ⇒ giá trị đã chuyển kiểu, trường tuỳ chọn trống bị bỏ khỏi thân", () => {
    expect(checkForm(FORM, OK)).toEqual({
      ok: true,
      values: { name: "Công ty", qty: 3, kind: "a", agree: true },
    });
    const full = checkForm(FORM, {
      ...OK,
      amount: "1.500",
      due: "2026-11-04",
      file: "4d400000-0000-4000-8000-000000000001",
    });
    expect(full).toEqual({
      ok: true,
      values: {
        name: "Công ty",
        qty: 3,
        kind: "a",
        agree: true,
        amount: 1500,
        due: "2026-11-04",
        file: "4d400000-0000-4000-8000-000000000001",
      },
    });
  });

  test("giá trị client chấp nhận cũng qua validator của contract (cùng luật với Hub)", () => {
    const r = checkForm(FORM, OK);
    expect(r.ok && flowFormValuesSchema(FORM).safeParse(r.values).success).toBe(true);
  });

  test("bắt buộc: trống / checkbox chưa tích ⇒ required", () => {
    expect(errs({ name: "  ", kind: "", agree: false })).toEqual({
      name: "required",
      kind: "required",
      agree: "required",
    });
  });

  test("giới hạn: text > max_len ⇒ tooLong · số ngoài khoảng ⇒ range · không nguyên ⇒ integer · chữ ⇒ invalid", () => {
    expect(errs({ name: "x".repeat(11) })).toEqual({ name: "tooLong" });
    expect(errs({ qty: "6" })).toEqual({ qty: "range" });
    expect(errs({ qty: "0" })).toEqual({ qty: "range" });
    expect(errs({ qty: "2.5" })).toEqual({ qty: "integer" });
    expect(errs({ qty: "abc" })).toEqual({ qty: "invalid" });
    expect(errs({ amount: "999" })).toEqual({ amount: "range" });
    expect(errs({ amount: "50001" })).toEqual({ amount: "range" });
  });

  test("select ngoài tập lựa chọn, ngày sai dạng, file_ref không phải uuid ⇒ invalid", () => {
    expect(errs({ kind: "z" })).toEqual({ kind: "invalid" });
    expect(errs({ due: "04/11/2026" })).toEqual({ due: "invalid" });
    expect(errs({ file: "not-a-uuid" })).toEqual({ file: "invalid" });
  });

  test("ký tự điều khiển trong text bị chặn (NUL ⇒ Postgres 22021)", () => {
    expect(errs({ name: "a\u0000b" })).toEqual({ name: "invalid" });
  });

  test("emptyDraft: ô chuỗi rỗng, checkbox false", () => {
    expect(emptyDraft(FORM)).toMatchObject({ name: "", agree: false, kind: "" });
  });
});
