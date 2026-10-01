// ADM-FR-60 · schema form tenant; hằng số lấy từ @ai/contracts, thông điệp là KEY i18n (resolve khi render).
import {
  COMPANY_KEY_RE,
  DISPLAY_NAME_MAX,
  EMAIL_MAX,
  MAX_CONCURRENT_SUB_MAX,
  NAME_MAX,
  USERNAME_RE,
} from "@ai/contracts";
import { z } from "zod";

/** Ô số lượng slot: trống = không giới hạn (null); còn lại số nguyên 1…MAX. */
export const slotsInput = z
  .string()
  .trim()
  .refine(
    (v) => v === "" || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= MAX_CONCURRENT_SUB_MAX),
    {
      message: "quota.error.positive",
    },
  );

export function slotsToValue(input: string): number | null {
  const v = input.trim();
  return v === "" ? null : Number(v);
}

export const tenantNameField = z
  .string()
  .trim()
  .min(1, "tenants.error.nameRequired")
  .max(NAME_MAX, "tenants.error.nameRequired");

export const tenantInfoSchema = z.object({ name: tenantNameField, slots: slotsInput });
export type TenantInfoValues = z.infer<typeof tenantInfoSchema>;

export const tenantCreateSchema = z.object({
  key: z.string().trim().toLowerCase().regex(COMPANY_KEY_RE, "tenants.error.keyFormat"),
  name: tenantNameField,
  slots: slotsInput,
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, "users.error.usernameFormat"),
  display_name: z
    .string()
    .trim()
    .min(1, "users.error.displayNameRequired")
    .max(DISPLAY_NAME_MAX, "users.error.displayNameMax"),
  email: z
    .string()
    .trim()
    .min(1, "users.error.emailRequired")
    .max(EMAIL_MAX, "users.error.emailFormat")
    .pipe(z.email("users.error.emailFormat")),
  locale: z.enum(["vi", "en"]),
});
export type TenantCreateValues = z.infer<typeof tenantCreateSchema>;
