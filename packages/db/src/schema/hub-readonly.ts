// ADM-NFR-06 · kiểu đọc của 3 bảng hub.* Admin được SELECT (spec M0 §4.2, ba-agent-hub.md §8).
// Chỉ để đọc có kiểu: KHÔNG nằm trong drizzle.config.ts — Hub sở hữu DDL. Hub ghi `agent_grants` từ H3b, `agent_workflows` từ H4a (Studio, 0010 D1).
import {
  boolean,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const hub = pgSchema("hub");

export const agentWorkflows = hub.table(
  "agent_workflows",
  {
    agentId: uuid("agent_id").notNull(),
    workflowId: uuid("workflow_id").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.workflowId] }),
    index("agent_workflows_workflow_id_idx").on(t.workflowId),
  ],
);

export const agentGrants = hub.table(
  "agent_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    subjectType: text("subject_type", { enum: ["group", "user"] }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    grantedBy: uuid("granted_by"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("agent_grants_uq").on(t.agentId, t.tenantId, t.subjectType, t.subjectId),
    index("agent_grants_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
  ],
);

export const usageLogs = hub.table(
  "usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    runId: uuid("run_id"),
    stepId: uuid("step_id"),
    userId: uuid("user_id"),
    featureId: uuid("feature_id"),
    agentId: uuid("agent_id"),
    providerKey: text("provider_key"),
    model: text("model"),
    billing: text("billing", { enum: ["api", "subscription", "dify"] }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // NULL = "Chưa định giá" (readiness #32); numeric trả về string để không mất chính xác.
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
    billableUsd: numeric("billable_usd", { precision: 14, scale: 6 }),
    overage: boolean("overage").notNull().default(false),
    latencyMs: integer("latency_ms"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_logs_tenant_at_idx").on(t.tenantId, t.at),
    index("usage_logs_tenant_feature_at_idx").on(t.tenantId, t.featureId, t.at),
  ],
);
