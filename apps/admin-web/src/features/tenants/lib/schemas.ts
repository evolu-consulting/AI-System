// ADM-FR-60 · schema form tenant; hằng số lấy từ @ai/contracts, thông điệp là KEY i18n (resolve khi render).
import {
  COMPANY_KEY_RE,
  DISPLAY_NAME_MAX,
  EMAIL_MAX,
  isSupportedTimeZone,
  MAX_CONCURRENT_SUB_MAX,
  NAME_MAX,
  TENANT_PROCESS_RUNS_MAX,
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

/** N2-FR-04 · trần run quy trình đồng thời: số nguyên 1…1000 (bắt buộc). */
export const processRunsInput = z
  .string()
  .trim()
  .refine(
    (v) =>
      /^\d+$/.test(v) &&
      Number(v) >= TENANT_PROCESS_RUNS_MAX.min &&
      Number(v) <= TENANT_PROCESS_RUNS_MAX.max,
    { message: "tenants.error.processRunsRange" },
  );

export const tenantNameField = z
  .string()
  .trim()
  .min(1, "tenants.error.nameRequired")
  .max(NAME_MAX, "tenants.error.nameRequired");

/** TZ-R02: tên IANA hợp lệ; thông điệp là khoá i18n (không dùng `TimezoneInputSchema`). */
export const tenantTimezoneField = z
  .string()
  .min(1, "tenants.error.timezoneRequired")
  .refine(isSupportedTimeZone, "tenants.error.timezoneUnsupported");

export const tenantInfoSchema = z.object({
  name: tenantNameField,
  slots: slotsInput,
  timezone: tenantTimezoneField,
  processRuns: processRunsInput,
});
export type TenantInfoValues = z.infer<typeof tenantInfoSchema>;

export const tenantCreateSchema = z.object({
  key: z.string().trim().toLowerCase().regex(COMPANY_KEY_RE, "tenants.error.keyFormat"),
  name: tenantNameField,
  slots: slotsInput,
  timezone: tenantTimezoneField,
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
