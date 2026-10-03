// ADM-FR-42, ADM-FR-43 · M4-R03, R07…R09 · contract /admin/usage* (plan-contract §2.2).
// Bản Tenant là schema riêng: KHÔNG có khoá cost_usd / margin_usd / tenants (strict → từ chối nếu thừa).
import { z } from "zod";
import { CountSchema, FEATURE_NAME_MAX, LocalizedTextSchema, UuidSchema } from "./common";
import {
  DateOnlySchema,
  MoneyNonNegSchema,
  MoneySchema,
  QuotaLevelSchema,
  QuotaStatusSchema,
} from "./quotas";

export const USAGE_MAX_DAYS = 366;
export const USAGE_TOP_MAX = 10;
export const USAGE_TENANTS_MAX = 200;
const DAY_MS = 86_400_000;

const spanDays = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

export const UsageQuerySchema = z
  .strictObject({
    tenant_id: UuidSchema.optional(),
    feature_id: z.union([UuidSchema, z.literal("none")]).optional(),
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: "from must be <= to",
    path: ["from"],
  })
  .refine((q) => !(q.from && q.to) || spanDays(q.from, q.to) <= USAGE_MAX_DAYS, {
    message: "range must be <= 366 days",
    path: ["to"],
  });
export type UsageQuery = z.infer<typeof UsageQuerySchema>;

const kpiBase = {
  runs: CountSchema,
  tokens: CountSchema,
  input_tokens: CountSchema,
  output_tokens: CountSchema,
  billable_usd: MoneyNonNegSchema,
  unpriced_rows: CountSchema,
  overage_runs: CountSchema,
};
const dayBase = {
  date: DateOnlySchema,
  runs: CountSchema,
  tokens: CountSchema,
  billable_usd: MoneyNonNegSchema,
  overage_billable_usd: MoneyNonNegSchema,
};
const topFeatureBase = {
  feature_id: UuidSchema.nullable(),
  feature_key: z.string().nullable(),
  feature_name: LocalizedTextSchema(FEATURE_NAME_MAX).nullable(),
  runs: CountSchema,
  tokens: CountSchema,
  billable_usd: MoneyNonNegSchema,
  overage: z.boolean(),
};
const topUserBase = {
  user_id: UuidSchema.nullable(),
  username: z.string().nullable(),
  display_name: z.string().nullable(),
  runs: CountSchema,
  tokens: CountSchema,
  billable_usd: MoneyNonNegSchema,
};
const cost = { cost_usd: MoneyNonNegSchema };

export const UsageKpiTenantSchema = z.strictObject(kpiBase);
export const UsageKpiPlatformSchema = z.strictObject({
  ...kpiBase,
  ...cost,
  margin_usd: MoneySchema,
});
export const UsageDayTenantSchema = z.strictObject(dayBase);
export const UsageDayPlatformSchema = z.strictObject({ ...dayBase, ...cost });
export const UsageTopFeatureTenantSchema = z.strictObject(topFeatureBase);
export const UsageTopFeaturePlatformSchema = z.strictObject({ ...topFeatureBase, ...cost });
export const UsageTopUserTenantSchema = z.strictObject(topUserBase);
export const UsageTopUserPlatformSchema = z.strictObject({ ...topUserBase, ...cost });
export const UsageTenantRowSchema = z.strictObject({
  tenant_id: UuidSchema,
  tenant_key: z.string(),
  tenant_name: z.string(),
  runs: CountSchema,
  tokens: CountSchema,
  billable_usd: MoneyNonNegSchema,
  cost_usd: MoneyNonNegSchema,
  quota_pct: CountSchema.nullable(),
  level: QuotaLevelSchema,
});

const reportBase = {
  range: z.strictObject({ from: DateOnlySchema, to: DateOnlySchema }),
  tenant_id: UuidSchema.nullable(),
  /** uuid | "none" (không theo feature) | null (không lọc). */
  feature_id: z.union([UuidSchema, z.literal("none")]).nullable(),
  has_data: z.boolean(),
  quotas: z.array(QuotaStatusSchema),
};
export const UsageReportTenantSchema = z.strictObject({
  ...reportBase,
  kpi: UsageKpiTenantSchema,
  previous: UsageKpiTenantSchema,
  daily: z.array(UsageDayTenantSchema),
  top_features: z.array(UsageTopFeatureTenantSchema).max(USAGE_TOP_MAX),
  top_users: z.array(UsageTopUserTenantSchema).max(USAGE_TOP_MAX),
});
/** `tenants` = [] khi đã chọn `tenant_id`. */
export const UsageReportPlatformSchema = z.strictObject({
  ...reportBase,
  kpi: UsageKpiPlatformSchema,
  previous: UsageKpiPlatformSchema,
  daily: z.array(UsageDayPlatformSchema),
  top_features: z.array(UsageTopFeaturePlatformSchema).max(USAGE_TOP_MAX),
  top_users: z.array(UsageTopUserPlatformSchema).max(USAGE_TOP_MAX),
  tenants: z.array(UsageTenantRowSchema).max(USAGE_TENANTS_MAX),
});
export type UsageReportTenant = z.infer<typeof UsageReportTenantSchema>;
export type UsageReportPlatform = z.infer<typeof UsageReportPlatformSchema>;
export type UsageKpi = z.infer<typeof UsageKpiPlatformSchema>;
