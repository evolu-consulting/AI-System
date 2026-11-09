// CR-126 · nháp điền sẵn + lọc danh sách chọn + lỗi email của form (thuần).
import { describe, expect, test } from "bun:test";
import type { FlowForm } from "@ai/contracts/flow";
import { FormFieldsSchema } from "@ai/contracts/hub-admin";
import { checkForm, filterOptions, initialDraft, selectOptions } from "./form-values";

const form: FlowForm = {
  fields: FormFieldsSchema.parse([
    {
      key: "partner",
      type: "select",
      label: "Đối tác",
      required: true,
      options_from: "company_partners",
    },
    {
      key: "partner_email",
      type: "text",
      label: "Email người nhận",
      required: true,
      format: "email",
    },
    { key: "note", type: "text", label: "Ghi chú", default: "Gửi theo hợp đồng" },
  ]),
};
const prefill = {
  field_defaults: { partner: "p1", partner_email: "k@doitac.vn" },
  field_options: {
    partner: [
      { value: "p1", label: "Công ty Đại Phát · 0101234567" },
      { value: "p2", label: "Công ty Thành Công · 0309876543-001" },
    ],
  },
};

describe("initialDraft", () => {
  test("giá trị máy chủ tính thắng default của trường, không prefill thì dùng default hoặc trống", () => {
    expect(initialDraft(form, prefill)).toEqual({
      partner: "p1",
      partner_email: "k@doitac.vn",
      note: "Gửi theo hợp đồng",
    });
    expect(initialDraft(form)).toEqual({
      partner: "",
      partner_email: "",
      note: "Gửi theo hợp đồng",
    });
  });
});

describe("selectOptions + filterOptions", () => {
  const f = form.fields[0] as Extract<FlowForm["fields"][number], { type: "select" }>;
  test("options_from ⇒ danh sách của máy chủ; thiếu ⇒ rỗng", () => {
    expect(selectOptions(f, prefill)).toHaveLength(2);
    expect(selectOptions(f)).toEqual([]);
  });
  test("lọc theo tên hoặc MST, không phân biệt dấu hoa thường, giữ mục đang chọn", () => {
    const all = selectOptions(f, prefill);
    expect(filterOptions(all, "dai phat").map((o) => o.value)).toEqual(["p1"]);
    expect(filterOptions(all, "0309876543").map((o) => o.value)).toEqual(["p2"]);
    expect(filterOptions(all, "ĐẠI").map((o) => o.value)).toEqual(["p1"]);
    expect(filterOptions(all, "thanh cong", "p1").map((o) => o.value)).toEqual(["p1", "p2"]);
    expect(filterOptions(all, "  ")).toHaveLength(2);
  });
});

describe("checkForm · email", () => {
  test("email sai dạng thì mã email nằm trên đúng trường, sửa lại thì gửi được", () => {
    const bad = checkForm(form, { partner: "p1", partner_email: "k@doitac", note: "" });
    expect(bad).toEqual({ ok: false, errors: { partner_email: "email" } });
    const ok = checkForm(form, { partner: "p1", partner_email: "k@doitac.vn", note: "" });
    expect(ok).toEqual({ ok: true, values: { partner: "p1", partner_email: "k@doitac.vn" } });
  });
  test("chưa chọn đối tác ⇒ required", () => {
    const r = checkForm(form, { partner: "", partner_email: "k@doitac.vn", note: "" });
    expect(r).toEqual({ ok: false, errors: { partner: "required" } });
  });
});
