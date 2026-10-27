// tenant-quotas (0025): hạn mức NGÀY theo công ty; null = dùng env hub-api. RLS + policy ở migration (viết tay).
import { sql } from "drizzle-orm";
import { bigint, check, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { admin, tenants, users } from "./admin";

const tsz = (name: string) => timestamp(name, { withTimezone: true });

export const tenantDailyLimits = admin.table(
  "tenant_daily_limits",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    uploadsDay: integer("uploads_day"),
    actionsDay: integer("actions_day"),
    aiTokensDay: bigint("ai_tokens_day", { mode: "number" }),
    /** Lúc "Đặt lại hôm nay" token AI; hub đếm từ max(00:00 UTC, mốc này). */
    aiTokensResetAt: tsz("ai_tokens_reset_at"),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "tenant_daily_limits_uploads_day_check",
      sql`${t.uploadsDay} IS NULL OR ${t.uploadsDay} BETWEEN 1 AND 1000000`,
    ),
    check(
      "tenant_daily_limits_actions_day_check",
      sql`${t.actionsDay} IS NULL OR ${t.actionsDay} BETWEEN 1 AND 1000000`,
    ),
    check(
      "tenant_daily_limits_ai_tokens_day_check",
      sql`${t.aiTokensDay} IS NULL OR ${t.aiTokensDay} BETWEEN 1 AND 1000000000000`,
    ),
  ],
);
