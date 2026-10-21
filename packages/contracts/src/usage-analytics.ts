// ADM-FR-42 · usage-analytics · contract `/admin/usage/analytics`, `/admin/usage/records(.csv)`, `/admin/usage/runs/:id`:
// token "đổ vào đâu" (app → agent → model), theo ngày/tuần/tháng, lọc tenant/app/agent/model/user/kết quả. `cost_usd` chỉ có
// ở bản platform_admin (tenant_admin: server xoá khoá — như M4-AC03), nên khai optional.
import { z } from "zod";
import { CountSchema, UuidSchema } from "./common";
import { DateOnlySchema, MoneyNonNegSchema } from "./quotas";
import { USAGE_MAX_DAYS } from "./usage";

export const USAGE_GRAINS = ["day", "week", "month"] as const;
export type UsageGrain = (typeof USAGE_GRAINS)[number];
export const USAGE_OUTCOMES = ["ok", "error", "cancelled"] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];
export const USAGE_BREAKDOWN_MAX = 50;
export const USAGE_RECORDS_MAX = 200;
export const USAGE_RECORDS_CSV_MAX = 50_000;

const KEY_RE = /^[a-z][a-z0-9_.-]{1,63}$/;
const DAY_MS = 86_400_000;
const spanDays = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

const filters = {
  tenant_id: UuidSchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  app: z.string().regex(KEY_RE).optional(),
  feature: z.string().regex(KEY_RE).optional(),
  agent_id: UuidSchema.optional(),
  model: z.string().min(1).max(100).optional(),
  user_id: UuidSchema.optional(),
  outcome: z.enum(USAGE_OUTCOMES).optional(),
};
const rangeOk = <T extends { from?: string; to?: string }>(s: z.ZodType<T>) =>
  s
    .refine((q) => !(q.from && q.to) || q.from <= q.to, {
      message: "from must be <= to",
      path: ["from"],
    })
    .refine((q) => !(q.from && q.to) || spanDays(q.from, q.to) <= USAGE_MAX_DAYS, {
      message: "range must be <= 366 days",
      path: ["to"],
    });

export const UsageAnalyticsQuerySchema = rangeOk(
  z.strictObject({ ...filters, grain: z.enum(USAGE_GRAINS).optional() }),
);
export type UsageAnalyticsQuery = z.infer<typeof UsageAnalyticsQuerySchema>;

export const UsageRecordsQuerySchema = rangeOk(
  z.strictObject({
    ...filters,
    run_id: UuidSchema.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(USAGE_RECORDS_MAX).optional(),
  }),
);
export type UsageRecordsQuery = z.infer<typeof UsageRecordsQuerySchema>;

const cost = { cost_usd: MoneyNonNegSchema.optional() };
const measures = {
  input_tokens: CountSchema,
  output_tokens: CountSchema,
  cache_tokens: CountSchema,
  tokens: CountSchema,
  calls: CountSchema,
  runs: CountSchema,
  errors: CountSchema,
  ...cost,
};

export const UsageAnalyticsKpiSchema = z.strictObject({
  ...measures,
  unpriced: CountSchema,
  /** null = chưa có lời gọi đo thời gian. */
  avg_latency_ms: CountSchema.nullable(),
});
export type UsageAnalyticsKpi = z.infer<typeof UsageAnalyticsKpiSchema>;

export const UsageSeriesPointSchema = z.strictObject({
  bucket: DateOnlySchema,
  app: z.string(),
  ...measures,
});
const keyed = { key: z.string().nullable(), label: z.string().nullable(), ...measures };
export const UsageBreakdownRowSchema = z.strictObject(keyed);
export type UsageBreakdownRow = z.infer<typeof UsageBreakdownRowSchema>;
export const UsageTreeRowSchema = z.strictObject({
  app: z.string(),
  agent_id: UuidSchema.nullable(),
  agent_key: z.string().nullable(),
  feature: z.string().nullable(),
  model: z.string().nullable(),
  tier: z.string(),
  ...measures,
});
export type UsageTreeRow = z.infer<typeof UsageTreeRowSchema>;

export const UsageAnalyticsSchema = z.strictObject({
  range: z.strictObject({ from: DateOnlySchema, to: DateOnlySchema }),
  grain: z.enum(USAGE_GRAINS),
  tenant_id: UuidSchema.nullable(),
  kpi: UsageAnalyticsKpiSchema,
  previous: UsageAnalyticsKpiSchema,
  series: z.array(UsageSeriesPointSchema),
  by_app: z.array(UsageBreakdownRowSchema),
  by_agent: z.array(UsageBreakdownRowSchema).max(USAGE_BREAKDOWN_MAX),
  by_model: z.array(UsageBreakdownRowSchema).max(USAGE_BREAKDOWN_MAX),
  by_tier: z.array(UsageBreakdownRowSchema),
  by_feature: z.array(UsageBreakdownRowSchema).max(USAGE_BREAKDOWN_MAX),
  by_user: z.array(UsageBreakdownRowSchema).max(USAGE_BREAKDOWN_MAX),
  by_outcome: z.array(UsageBreakdownRowSchema),
  /** Chỉ platform_admin khi không chọn tenant; còn lại []. */
  by_tenant: z.array(UsageBreakdownRowSchema).max(USAGE_BREAKDOWN_MAX),
  tree: z.array(UsageTreeRowSchema).max(USAGE_BREAKDOWN_MAX * 2),
});
export type UsageAnalytics = z.infer<typeof UsageAnalyticsSchema>;

export const UsageRecordSchema = z.strictObject({
  id: UuidSchema,
  at: z.string(),
  tenant_id: UuidSchema,
  tenant_key: z.string().nullable(),
  user_id: UuidSchema.nullable(),
  username: z.string().nullable(),
  app: z.string(),
  feature: z.string().nullable(),
  agent_id: UuidSchema.nullable(),
  agent_key: z.string().nullable(),
  run_id: UuidSchema.nullable(),
  provider_key: z.string().nullable(),
  model: z.string().nullable(),
  billing: z.string(),
  outcome: z.enum(USAGE_OUTCOMES).nullable(),
  input_tokens: CountSchema,
  output_tokens: CountSchema,
  cache_read_tokens: CountSchema,
  cache_write_tokens: CountSchema,
  latency_ms: CountSchema.nullable(),
  cost_usd: MoneyNonNegSchema.nullable().optional(),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

export const UsageRecordsSchema = z.strictObject({
  items: z.array(UsageRecordSchema).max(USAGE_RECORDS_MAX),
  next_cursor: z.string().nullable(),
});
export type UsageRecords = z.infer<typeof UsageRecordsSchema>;

export const UsageRunSchema = z.strictObject({
  run_id: UuidSchema,
  items: z.array(UsageRecordSchema),
  total: z.strictObject({ ...measures }),
});
export type UsageRun = z.infer<typeof UsageRunSchema>;
