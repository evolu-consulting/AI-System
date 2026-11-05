// CR-121 · hồ sơ công ty: kiểm từng ô khi sửa tại chỗ (thuần). Lỗi là KHOÁ i18n; ô trống = xoá giá trị (trừ tên công ty).
import {
  EMAIL_MAX,
  NAME_MAX,
  TENANT_PROFILE_PHONE_RE,
  TENANT_PROFILE_TAX_CODE_RE,
  TENANT_STAFF_SIZE_MAX,
} from "@ai/contracts";
import { z } from "zod";

export type ProfileTextField =
  | "name"
  | "legal_name"
  | "tax_code"
  | "address"
  | "staff_size"
  | "contact_name"
  | "contact_email"
  | "contact_phone";

export type FieldResult =
  | { ok: true; value: string | number | null }
  | { ok: false; error: string };

const MAX: Record<"legal_name" | "address" | "contact_name", number> = {
  legal_name: 256,
  address: 512,
  contact_name: 128,
};

const good = (value: string | number): FieldResult => ({ ok: true, value });
const bad = (error: string): FieldResult => ({ ok: false, error });

/** Kiểm riêng từng trường có định dạng; `v` đã trim, không rỗng. */
const FORMAT: Record<string, (v: string) => FieldResult> = {
  tax_code: (v) =>
    TENANT_PROFILE_TAX_CODE_RE.test(v) ? good(v) : bad("tenants.company.error.taxCode"),
  contact_phone: (v) =>
    TENANT_PROFILE_PHONE_RE.test(v) ? good(v) : bad("tenants.company.error.phone"),
  contact_email: (v) =>
    v.length <= EMAIL_MAX && z.email().safeParse(v).success
      ? good(v.toLowerCase())
      : bad("tenants.company.error.email"),
  staff_size: (v) =>
    /^\d+$/.test(v) && Number(v) <= TENANT_STAFF_SIZE_MAX
      ? good(Number(v))
      : bad("tenants.company.error.staffSize"),
};

/** `raw` = nội dung ô nhập. Trả giá trị gửi lên API (`null` = xoá) hoặc khoá lỗi. */
export function validateField(field: ProfileTextField, raw: string): FieldResult {
  const v = raw.trim();
  if (field === "name")
    return v === "" || v.length > NAME_MAX ? bad("tenants.error.nameRequired") : good(v);
  if (v === "") return { ok: true, value: null };
  const format = FORMAT[field];
  if (format) return format(v);
  const max = MAX[field as keyof typeof MAX] ?? 256;
  return v.length <= max ? good(v) : bad("tenants.company.error.tooLong");
}
