// CR-126 · «Chọn đối tác & người nhận» · trường form có `default` / `options_from` / `format: email`; form cũ vẫn hợp lệ.
import { describe, expect, test } from "bun:test";
import { FlowTaskSchema, flowFormValuesSchema } from "../flow";
import { FORM_OPTIONS_FROM_MAX, FORM_OPTIONS_MAX, FormFieldsSchema } from "./process-form";

const partner = {
  key: "partner",
  type: "select",
  label: "Đối tác",
  required: true,
  options_from: "company_partners",
};
const email = {
  key: "partner_email",
  type: "text",
  label: "Email người nhận",
  required: true,
  format: "email",
  default: "a@b.vn",
};
const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Mục ${i}` }));

describe("process-form · trường mới", () => {
  test("form cũ (không default/options_from) vẫn hợp lệ", () => {
    const ok = FormFieldsSchema.safeParse([
      { key: "ten", type: "text", label: "Tên" },
      { key: "loai", type: "select", label: "Loại", options: opts(2) },
    ]);
    expect(ok.success).toBe(true);
  });

  test("options_from: bỏ trống options được; nguồn lạ bị từ chối", () => {
    expect(FormFieldsSchema.safeParse([partner]).success).toBe(true);
    expect(FormFieldsSchema.safeParse([{ ...partner, options_from: "users" }]).success).toBe(false);
  });

  test("trần 30 lựa chọn giữ nguyên cho danh sách gõ tay, nâng lên 200 chỉ cho options_from", () => {
    const hand = (n: number) => [{ key: "x", type: "select", label: "X", options: opts(n) }];
    expect(FormFieldsSchema.safeParse(hand(FORM_OPTIONS_MAX)).success).toBe(true);
    expect(FormFieldsSchema.safeParse(hand(FORM_OPTIONS_MAX + 1)).success).toBe(false);
    expect(FormFieldsSchema.safeParse(hand(0)).success).toBe(false);
    const from = (n: number) => [{ ...partner, options: opts(n) }];
    expect(FormFieldsSchema.safeParse(from(FORM_OPTIONS_FROM_MAX)).success).toBe(true);
    expect(FormFieldsSchema.safeParse(from(FORM_OPTIONS_FROM_MAX + 1)).success).toBe(false);
  });

  test("default là chuỗi thuần; format chỉ nhận email", () => {
    expect(FormFieldsSchema.safeParse([email]).success).toBe(true);
    expect(FormFieldsSchema.safeParse([{ ...email, default: 5 }]).success).toBe(false);
    expect(FormFieldsSchema.safeParse([{ ...email, default: "a\u0000b" }]).success).toBe(false);
    expect(FormFieldsSchema.safeParse([{ ...email, format: "phone" }]).success).toBe(false);
  });
});

describe("flowFormValuesSchema · options_from + email", () => {
  const form = { fields: FormFieldsSchema.parse([partner, email]) };
  const schema = flowFormValuesSchema(form);
  test("đối tác bất kỳ khác rỗng + email đúng dạng ⇒ hợp lệ (máy chủ kiểm đối tác thuộc công ty)", () => {
    expect(
      schema.safeParse({ partner: "0101234567-001", partner_email: "k@doitac.vn" }).success,
    ).toBe(true);
  });
  test("email sai dạng / thiếu đối tác ⇒ lỗi đúng trường", () => {
    const r = schema.safeParse({ partner: "", partner_email: "khong-phai-email" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toContain("partner");
    expect(paths).toContain("partner_email");
  });
});

describe("FlowTask · prefill", () => {
  const task = {
    task_id: "00000000-0000-4000-8000-000000000001",
    step_key: "send",
    kind: "form",
    actions: [],
  };
  test("prefill tuỳ chọn; có thì đúng hình dạng {field_defaults, field_options}", () => {
    expect(FlowTaskSchema.safeParse(task).success).toBe(true);
    const prefill = {
      field_defaults: { partner: "p1", partner_email: "k@doitac.vn" },
      field_options: { partner: [{ value: "p1", label: "Công ty A · 0101234567" }] },
    };
    expect(FlowTaskSchema.safeParse({ ...task, prefill }).success).toBe(true);
    expect(FlowTaskSchema.safeParse({ ...task, prefill: { field_defaults: {} } }).success).toBe(
      false,
    );
  });
});
