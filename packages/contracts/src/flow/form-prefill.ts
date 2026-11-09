// CR-126 · «Chọn đối tác & người nhận» · giá trị điền sẵn của stage form trong node module (máy chủ tính, gửi kèm task form).
// MỘT hình dạng dùng chung: hub (resolver) ghi vào payload task; web (FormStep) đọc để đặt mặc định + danh sách chọn.
// Chỉ zod, không I/O (luật `contracts-only-zod`).
import { z } from "zod";

/** Nguồn danh sách chọn máy chủ hiểu (`options_from` của trường select). */
export const FORM_OPTIONS_SOURCES = ["company_partners"] as const;
export type FormOptionsSource = (typeof FORM_OPTIONS_SOURCES)[number];

/** Trần số lựa chọn máy chủ trả cho một nguồn (một câu SQL, `limit`). */
export const FORM_PREFILL_OPTIONS_MAX = 200;

export const FormPrefillOptionSchema = z.strictObject({
  value: z.string().max(200),
  label: z.string().max(400),
});
export type FormPrefillOption = z.infer<typeof FormPrefillOptionSchema>;

/** Giá trị mặc định theo khoá trường (chuỗi/số/bool/null như FlowFormValue). */
export const FormPrefillDefaultSchema = z.union([
  z.string().max(4000),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const FormPrefillSchema = z.strictObject({
  /** khoá trường ⇒ giá trị điền sẵn (vd partner_tax_code = MST đối tác của HĐ, partner_email = email liên hệ). */
  field_defaults: z.record(z.string(), FormPrefillDefaultSchema),
  /** khoá trường ⇒ lựa chọn (trường select có `options_from`); cap {@link FORM_PREFILL_OPTIONS_MAX}. */
  field_options: z.record(
    z.string(),
    z.array(FormPrefillOptionSchema).max(FORM_PREFILL_OPTIONS_MAX),
  ),
});
export type FormPrefill = z.infer<typeof FormPrefillSchema>;

export const EMPTY_FORM_PREFILL: FormPrefill = { field_defaults: {}, field_options: {} };
