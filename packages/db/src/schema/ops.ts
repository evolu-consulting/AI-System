// ADM-FR-40, ADM-FR-41, ADM-FR-51 · schema `admin` M4 (plan M4 §3): tenant_quotas (M4-R02), quota_alerts (M4-R04, R05),
// audit_log (M4-R10, R11). RLS, policy, quyền `hub_ro`/`admin_rw`, trigger append-only `audit_log` nằm ở phần nối tay
// cuối migration 0007_m4_ops (không khai ở đây).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { admin, features, tenants, users } from "./admin";

const tsz = (name: string) => timestamp(name, { withTimezone: true });
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(", "));

/** Khớp `AUDIT_ACTIONS`/`AUDIT_ENTITIES` của `@ai/contracts` (plan-contract §2.4); đổi thì cần migration mới. */
export const AUDIT_ACTION_VALUES = [
  "create",
  "update",
  "delete",
  "lock",
  "unlock",
  "grant",
  "revoke",
  "restore",
  "import",
] as const;
export const AUDIT_ENTITY_VALUES = [
  "tenant",
  "user",
  "user_totp",
  "group",
  "grant",
  "entitlement",
  "feature",
  "workflow",
  "command",
  "secret",
  "quota",
  "config",
] as const;
export const QUOTA_ALERT_STATUSES = ["pending", "sending", "sent", "skipped", "failed"] as const;

/** Hạn mức tháng; `feature_id` NULL = cả tenant. Ít nhất một giới hạn khác NULL. */
export const tenantQuotas = admin.table(
  "tenant_quotas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    featureId: uuid("feature_id").references(() => features.id, { onDelete: "cascade" }),
    period: text("period").notNull().default("month"),
    maxRuns: integer("max_runs"),
    maxTokens: bigint("max_tokens", { mode: "number" }),
    maxUsd: numeric("max_usd", { precision: 12, scale: 2 }),
    warnPct: smallint("warn_pct").notNull().default(80),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("tenant_quotas_scope_uq").on(t.tenantId, t.featureId).nullsNotDistinct(),
    check("tenant_quotas_period_check", sql`${t.period} = 'month'`),
    check("tenant_quotas_max_runs_check", sql`${t.maxRuns} > 0`),
    check("tenant_quotas_max_tokens_check", sql`${t.maxTokens} > 0`),
    check("tenant_quotas_max_usd_check", sql`${t.maxUsd} > 0`),
    check("tenant_quotas_warn_pct_check", sql`${t.warnPct} = 80`),
    check(
      "tenant_quotas_limit_check",
      sql`num_nonnulls(${t.maxRuns}, ${t.maxTokens}, ${t.maxUsd}) >= 1`,
    ),
  ],
);

/** Một hàng mỗi (tenant, feature, mức, tháng VN): khoá chống gửi trùng + trạng thái gửi mail. */
export const quotaAlerts = admin.table(
  "quota_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    featureId: uuid("feature_id").references(() => features.id, { onDelete: "cascade" }),
    level: smallint("level").notNull(),
    month: date("month").notNull(),
    pct: smallint("pct").notNull(),
    status: text("status", { enum: QUOTA_ALERT_STATUSES }).notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    claimedAt: tsz("claimed_at"),
    sentAt: tsz("sent_at"),
    lastError: text("last_error"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("quota_alerts_once_uq").on(t.tenantId, t.featureId, t.level, t.month).nullsNotDistinct(),
    index("quota_alerts_queue_idx")
      .on(t.status, t.claimedAt)
      .where(sql`${t.status} IN ('pending', 'sending')`),
    check("quota_alerts_level_check", sql`${t.level} IN (80, 100)`),
    check("quota_alerts_pct_check", sql`${t.pct} >= 0`),
    check("quota_alerts_status_check", sql`${t.status} IN (${inList(QUOTA_ALERT_STATUSES)})`),
    check("quota_alerts_attempts_check", sql`${t.attempts} >= 0`),
    check("quota_alerts_last_error_check", sql`char_length(${t.lastError}) <= 200`),
  ],
);

/**
 * Nhật ký append-only (UPDATE/DELETE/TRUNCATE bị chặn bằng quyền + trigger ở 0007). Không FK `tenant_id`/`actor_id`:
 * INSERT sau bump `config_version` không chờ khoá hàng cha (plan §4.1), và hàng sống lâu hơn tenant/user.
 */
export const auditLog = admin.table(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    at: tsz("at").notNull().defaultNow(),
    tenantId: uuid("tenant_id"),
    actorId: uuid("actor_id"),
    actorUsername: text("actor_username"),
    action: text("action", { enum: AUDIT_ACTION_VALUES }).notNull(),
    entity: text("entity", { enum: AUDIT_ENTITY_VALUES }).notNull(),
    entityId: uuid("entity_id"),
    entityName: text("entity_name").notNull().default(""),
    configVersion: integer("config_version"),
    entityVersion: integer("entity_version"),
    before: jsonb("before"),
    after: jsonb("after"),
    summary: jsonb("summary").notNull().default({}),
    snapshot: boolean("snapshot").notNull().default(false),
  },
  (t) => [
    unique("audit_log_seq_uq").on(t.seq),
    index("audit_log_tenant_seq_idx").on(t.tenantId, t.seq.desc()),
    index("audit_log_entity_seq_idx").on(t.entity, t.entityId, t.seq.desc()),
    index("audit_log_actor_seq_idx").on(t.actorId, t.seq.desc()),
    check("audit_log_action_check", sql`${t.action} IN (${inList(AUDIT_ACTION_VALUES)})`),
    check("audit_log_entity_check", sql`${t.entity} IN (${inList(AUDIT_ENTITY_VALUES)})`),
    check("audit_log_entity_name_check", sql`char_length(${t.entityName}) <= 200`),
  ],
);
