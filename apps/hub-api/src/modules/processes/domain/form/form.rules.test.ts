// CR-118 · cr118-form-node · unit: kiểm giá trị form theo trường snapshot (tập con cố định, giới hạn zod, bỏ trường lạ)
// + hình def form (key/option trùng, nhãn có thẻ, quá 20 trường) + ép stage khi lưu.
import { describe, expect, test } from "bun:test";
import { FORM_FIELDS_MAX, FormExecutorSchema, type FormField } from "@ai/contracts/hub-admin";
import { canonicalFormValues, formOutputFields, validateFormValues } from "./form.rules";

const parse = (fields: unknown[]) => FormExecutorSchema.parse({ kind: "form", fields }).fields;
const FIELDS: FormField[] = parse([
  { key: "ten", label: "Tên", type: "text", required: true, max_len: 10 },
  { key: "mo_ta", label: "Mô tả", type: "textarea", max_len: 20 },
  { key: "so", label: "Số", type: "number", min: 0, max: 100, integer: true },
  { key: "tien", label: "Tiền", type: "money", max: 1_000_000 },
  { key: "ngay", label: "Ngày", type: "date" },
  { key: "muc", label: "Mức", type: "select", options: [{ value: "a", label: "A" }] },
  { key: "dong_y", label: "Đồng ý", type: "checkbox" },
  { key: "tep", label: "Tệp", type: "file_ref" },
]);
const UUID = "a5a00000-0000-4000-8000-000000000001";

describe("CR-118 · validateFormValues", () => {
  test("hợp lệ đủ loại ⇒ giá trị chuẩn hoá theo thứ tự trường, trường lạ bị bỏ", () => {
    const r = validateFormValues(FIELDS, {
      la: "<script>",
      tep: UUID,
      dong_y: true,
      muc: "a",
      ngay: "2026-02-28",
      tien: 500_000,
      so: 7,
      mo_ta: "dòng 1\ndòng 2",
      ten: "  An  ",
    });
    expect(r).toEqual({
      ok: true,
      values: {
        ten: "An",
        mo_ta: "dòng 1\ndòng 2",
        so: 7,
        tien: 500_000,
        ngay: "2026-02-28",
        muc: "a",
        dong_y: "true",
        tep: UUID,
      },
    });
  });

  test("thiếu bắt buộc / rỗng ⇒ lỗi path; trường không bắt buộc vắng ⇒ bỏ", () => {
    expect(validateFormValues(FIELDS, {})).toEqual({ ok: false, paths: ["ten"] });
    expect(validateFormValues(FIELDS, { ten: "   " })).toEqual({ ok: false, paths: ["ten"] });
    expect(validateFormValues(FIELDS, { ten: "x" })).toEqual({ ok: true, values: { ten: "x" } });
  });

  test("giới hạn từng loại", () => {
    const bad = (v: Record<string, unknown>) => validateFormValues(FIELDS, { ten: "x", ...v });
    expect(bad({ ten: "12345678901" })).toEqual({ ok: false, paths: ["ten"] }); // > max_len
    expect(bad({ ten: "a\u0007b" })).toEqual({ ok: false, paths: ["ten"] }); // ký tự điều khiển
    expect(bad({ ten: "a\nb" })).toEqual({ ok: false, paths: ["ten"] }); // text một dòng
    expect(bad({ mo_ta: "x".repeat(21) })).toEqual({ ok: false, paths: ["mo_ta"] });
    expect(bad({ so: 101 })).toEqual({ ok: false, paths: ["so"] });
    expect(bad({ so: 1.5 })).toEqual({ ok: false, paths: ["so"] }); // integer
    expect(bad({ so: "5" })).toEqual({ ok: false, paths: ["so"] }); // không ép chuỗi
    expect(bad({ so: Number.NaN })).toEqual({ ok: false, paths: ["so"] });
    expect(bad({ tien: -1 })).toEqual({ ok: false, paths: ["tien"] });
    expect(bad({ tien: 10.5 })).toEqual({ ok: false, paths: ["tien"] });
    expect(bad({ tien: 2_000_000 })).toEqual({ ok: false, paths: ["tien"] });
    expect(bad({ ngay: "2026-02-30" })).toEqual({ ok: false, paths: ["ngay"] });
    expect(bad({ muc: "b" })).toEqual({ ok: false, paths: ["muc"] });
    expect(bad({ dong_y: "true" })).toEqual({ ok: false, paths: ["dong_y"] });
    expect(bad({ tep: "../etc/passwd" })).toEqual({ ok: false, paths: ["tep"] });
    expect(bad({ ten: { $gt: "" } })).toEqual({ ok: false, paths: ["ten"] });
  });

  test("checkbox bắt buộc phải được tick", () => {
    const f = parse([{ key: "ok", label: "OK", type: "checkbox", required: true }]);
    expect(validateFormValues(f, { ok: false })).toEqual({ ok: false, paths: ["ok"] });
    expect(validateFormValues(f, { ok: true })).toEqual({ ok: true, values: { ok: "true" } });
  });

  test("values không phải object ⇒ mọi trường bắt buộc lỗi", () => {
    expect(validateFormValues(FIELDS, null)).toEqual({ ok: false, paths: ["ten"] });
    expect(validateFormValues(FIELDS, ["x"])).toEqual({ ok: false, paths: ["ten"] });
  });

  test("canonical ổn định theo thứ tự trường (idempotent so sánh được)", () => {
    expect(canonicalFormValues({ b: 1, a: "x" })).toBe('{"b":1,"a":"x"}');
  });
});

describe("CR-118 · FormExecutorSchema (def)", () => {
  const one = { key: "a", label: "A", type: "text" };
  test("tối đa 20 trường, ít nhất 1", () => {
    const many = Array.from({ length: FORM_FIELDS_MAX + 1 }, (_, i) => ({ ...one, key: `k${i}` }));
    expect(FormExecutorSchema.safeParse({ kind: "form", fields: many }).success).toBe(false);
    expect(FormExecutorSchema.safeParse({ kind: "form", fields: [] }).success).toBe(false);
  });
  test("nhãn có thẻ HTML / loại lạ / thuộc tính lạ ⇒ từ chối", () => {
    const bad = (f: object) => FormExecutorSchema.safeParse({ kind: "form", fields: [f] }).success;
    expect(bad({ ...one, label: "<b>x</b>" })).toBe(false);
    expect(bad({ ...one, type: "html" })).toBe(false);
    expect(bad({ ...one, type: "expression" })).toBe(false);
    expect(bad({ ...one, default: "{{1+1}}" })).toBe(false);
    expect(bad({ ...one, max_len: 501 })).toBe(false);
  });
  test("key trùng / option trùng / min > max ⇒ từ chối", () => {
    const p = (fields: object[]) => FormExecutorSchema.safeParse({ kind: "form", fields }).success;
    expect(p([one, one])).toBe(false);
    const opt = { value: "a", label: "A" };
    expect(p([{ key: "s", label: "S", type: "select", options: [opt, opt] }])).toBe(false);
    expect(p([{ key: "n", label: "N", type: "number", min: 5, max: 1 }])).toBe(false);
  });
  test("formOutputFields: kiểu output theo loại, không bắt buộc", () => {
    expect(formOutputFields(FIELDS).map((f) => `${f.key}:${f.type}:${f.required}`)).toEqual([
      "ten:string:false",
      "mo_ta:string:false",
      "so:number:false",
      "tien:number:false",
      "ngay:date:false",
      "muc:string:false",
      "dong_y:string:false",
      "tep:string:false",
    ]);
  });
});
