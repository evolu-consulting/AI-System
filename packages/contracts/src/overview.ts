// ADM-FR-44 · contract GET /admin/overview (plan-contract §2.3).
import { z } from "zod";
import { AuditItemSchema } from "./audit";
import { CountSchema, IsoDateTime, UuidSchema } from "./common";
import { QuotaBannerSchema, QuotaLevelSchema, QuotaStatusSchema } from "./quotas";

export const OVERVIEW_RECENT_MAX = 8;
export const OVERVIEW_NEVER_LOGGED_MAX = 5;
export const OVERVIEW_QUOTA_TENANTS_MAX = 10;
export const OVERVIEW_UNAVAILABLE = ["command_errors", "agent_studio"] as const;

export const OverviewTenantSchema = z.strictObject({
  kind: z.literal("tenant"),
  tenant: z.strictObject({ id: UuidSchema, key: z.string(), name: z.string() }),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  active_users: CountSchema,
  groups: CountSchema,
  runs_month: CountSchema.nullable(),
  runs_prev_month: CountSchema.nullable(),
  has_usage_data: z.boolean(),
  quotas: z.array(QuotaStatusSchema),
  banner: QuotaBannerSchema.nullable(),
  never_logged_in: z
    .array(
      z.strictObject({
        id: UuidSchema,
        username: z.string(),
        display_name: z.string(),
        created_at: IsoDateTime,
      }),
    )
    .max(OVERVIEW_NEVER_LOGGED_MAX),
  never_logged_in_total: CountSchema,
  recent_changes: z.array(AuditItemSchema).max(OVERVIEW_RECENT_MAX),
});

export const OverviewPlatformSchema = z.strictObject({
  kind: z.literal("platform"),
  tenants_active: CountSchema,
  commands_enabled: CountSchema,
  workflows_total: CountSchema,
  workflows_unattached: CountSchema,
  users_active: CountSchema,
  runs_24h: CountSchema.nullable(),
  has_usage_data: z.boolean(),
  quota_tenants: z
    .array(
      z.strictObject({
        tenant_id: UuidSchema,
        tenant_key: z.string(),
        tenant_name: z.string(),
        pct: CountSchema,
        level: QuotaLevelSchema,
      }),
    )
    .max(OVERVIEW_QUOTA_TENANTS_MAX),
  recent_changes: z.array(AuditItemSchema).max(OVERVIEW_RECENT_MAX),
  unavailable: z.array(z.enum(OVERVIEW_UNAVAILABLE)),
});

export const OverviewResponseSchema = z.discriminatedUnion("kind", [
  OverviewTenantSchema,
  OverviewPlatformSchema,
]);
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
