// ADM-FR-40, ADM-FR-41 · M4-R02 · contract /admin/tenants/:id/quotas, /admin/quota-banner (plan-contract §2.1).
// Thuần, không I/O: chạy được ở trình duyệt.
import { z } from "zod";
import {
  CountSchema,
  FEATURE_NAME_MAX,
  LocalizedTextSchema,
  UuidSchema,
  VersionSchema,
} from "./common";

export const QUOTA_MAX_ITEMS = 100;
export const QUOTA_MAX_RUNS = 1_000_000_000;
export const QUOTA_MAX_TOKENS = 1_000_000_000_000;
export const QUOTA_LEVELS = ["none", "warn", "over"] as const;
export const QUOTA_THRESHOLD_CHANNEL = "quota_threshold";

/** Tiền trả về: chuỗi thập phân (numeric), cho phép âm (margin). */
export const MoneySchema = z.string().regex(/^-?\d{1,10}(\.\d{1,6})?$/);
/** Tiền không âm. */
export const MoneyNonNegSchema = z.string().regex(/^\d{1,10}(\.\d{1,6})?$/);
/** Giới hạn USD nhập: > 0, tối đa 2 số lẻ. */
export const MoneyLimitSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/)
  .refine((v) => /[1-9]/.test(v), { message: "must be > 0" });
/** Ngày VN `YYYY-MM-DD`, phải là ngày có thật. */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
    message: "invalid date",
  });

export const QuotaLevelSchema = z.enum(QUOTA_LEVELS);
export type QuotaLevel = z.infer<typeof QuotaLevelSchema>;

const limitsShape = {
  max_runs: z.number().int().min(1).max(QUOTA_MAX_RUNS).nullable(),
  max_tokens: z.number().int().min(1).max(QUOTA_MAX_TOKENS).nullable(),
  max_usd: MoneyLimitSchema.nullable(),
};
export const QuotaLimitsSchema = z.strictObject(limitsShape);
export type QuotaLimits = z.infer<typeof QuotaLimitsSchema>;

export const QuotaItemInputSchema = z.strictObject({
  feature_id: UuidSchema.nullable(),
  ...limitsShape,
});
export type QuotaItemInput = z.infer<typeof QuotaItemInputSchema>;

/** `version` = version của tenant; dòng mọi giới hạn null bị bỏ (= không giới hạn). */
export const QuotaSetRequestSchema = z.strictObject({
  version: VersionSchema,
  items: z.array(QuotaItemInputSchema).max(QUOTA_MAX_ITEMS),
});
export type QuotaSetRequest = z.infer<typeof QuotaSetRequestSchema>;

export const QuotaUsageSchema = z.strictObject({
  runs: CountSchema,
  tokens: CountSchema,
  billable_usd: MoneyNonNegSchema,
  unpriced_rows: CountSchema,
});
export type QuotaUsage = z.infer<typeof QuotaUsageSchema>;

export const QuotaStatusSchema = z.strictObject({
  feature_id: UuidSchema.nullable(),
  feature_key: z.string().nullable(),
  feature_name: LocalizedTextSchema(FEATURE_NAME_MAX).nullable(),
  ...limitsShape,
  used: QuotaUsageSchema,
  pct: CountSchema.nullable(),
  level: QuotaLevelSchema,
});
export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;

/** Luôn có dòng đầu `feature_id=null`, rồi theo `feature_key` tăng. */
export const QuotaSetResponseSchema = z.strictObject({
  tenant_id: UuidSchema,
  version: VersionSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  has_usage_data: z.boolean(),
  items: z.array(QuotaStatusSchema),
});
export type QuotaSetResponse = z.infer<typeof QuotaSetResponseSchema>;

export const QuotaBannerSchema = z.strictObject({
  level: z.enum(["warn", "over"]),
  pct: CountSchema,
  feature_key: z.string().nullable(),
});
export type QuotaBanner = z.infer<typeof QuotaBannerSchema>;

export const QuotaBannerResponseSchema = z.strictObject({ banner: QuotaBannerSchema.nullable() });
export type QuotaBannerResponse = z.infer<typeof QuotaBannerResponseSchema>;

/** NOTIFY Hub → Admin khi ghi `usage_logs` (≤ 100 byte). */
export const QuotaThresholdPayloadSchema = z.strictObject({ tenant_id: UuidSchema });
export type QuotaThresholdPayload = z.infer<typeof QuotaThresholdPayloadSchema>;
