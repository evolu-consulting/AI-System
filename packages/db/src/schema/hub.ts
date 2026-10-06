// HUB-FR-75, WRK-FR-24 · kiểu Drizzle cho bảng `hub` mà hub-api dùng (plan H1 §3.1–3.3, plan-db §3.3).
// CHỈ để truy vấn có kiểu: DDL thật là `migrations-hub/0000_hub_core.sql`, `0002_h2a_dify.sql`, `0006_h2b_routing.sql`, `0007_h2c_attachments.sql`, `0008_h3a_provider_state.sql`, `0009_h3b_agent_grants.sql` (viết tay), KHÔNG nằm trong drizzle.config.ts.
// Ràng buộc (CHECK, FK, index) chỉ ở SQL. Ba bảng stub (`agent_grants`, `agent_workflows`, `usage_logs`) ở `hub-readonly.ts`
// (kiểu của Admin, không thêm cột mới để `select()` của Admin chạy được trên DB chưa có migration Hub).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const RUN_STATUS_VALUES = ["running", "finished", "failed", "cancelled"] as const;
export const RUN_STEP_STATUS_VALUES = ["running", "ok", "failed", "skipped"] as const;
export const JOB_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export const RUN_KIND_VALUES = ["orchestrated", "command", "direct"] as const;
export const RUN_STEP_TYPE_VALUES = ["orchestrator", "delegate", "workflow", "tool"] as const;
export const JOB_TYPE_VALUES = ["agent.cli", "agent.run", "workflow.async"] as const;
export const TOOL_CONFIRMATION_STATUS_VALUES = [
  "pending",
  "confirmed",
  "declined",
  "consumed",
  "expired",
] as const;
export const PROVIDER_STATE_VALUES = ["ok", "busy", "cooldown", "error", "logged_out"] as const;
export const AGENT_RUNTIME_VALUES = [
  "agentic-cli",
  "llm",
  "python",
  "dify-workflow",
  "dify-agent",
] as const;
export const ATTACHMENT_ORIGIN_VALUES = ["upload", "output"] as const;
export const HUB_AUDIT_ACTION_VALUES = ["grant", "revoke", "view_trace"] as const;
export const HUB_AUDIT_ENTITY_VALUES = ["agent_grant", "run"] as const;
export const HUB_AUDIT_ACTOR_ROLE_VALUES = ["platform_admin", "tenant_admin", "member"] as const;

// ── §3.1 Cấu hình ──
export const hubConfigMeta = hub.table("config_meta", {
  id: smallint("id").primaryKey(),
  hubConfigVersion: integer("hub_config_version").notNull().default(0),
});

export const providers = hub.table("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  kind: text("kind", { enum: ["subscription", "api"] }).notNull(),
  vendor: text("vendor", { enum: ["anthropic", "openai", "google", "fake", "dify"] }).notNull(),
  baseUrl: text("base_url"),
  secretId: uuid("secret_id"),
  maxConcurrency: integer("max_concurrency").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  devOnly: boolean("dev_only").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type ModelProfileStep = { provider_key: string; model: string; on: string[] };

export const modelProfiles = hub.table("model_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  steps: jsonb("steps").$type<ModelProfileStep[]>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const agents = hub.table("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  name: jsonb("name").$type<{ vi: string; en: string }>().notNull(),
  description: text("description").notNull(),
  runtime: text("runtime", { enum: AGENT_RUNTIME_VALUES }).notNull(),
  agentTypeKey: text("agent_type_key"),
  profileId: uuid("profile_id").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  runtimeOptions: jsonb("runtime_options").$type<Record<string, unknown>>().notNull().default({}),
  timeoutS: integer("timeout_s").notNull().default(600),
  tokenBudget: integer("token_budget"),
  enabled: boolean("enabled").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const orchestratorSettings = hub.table("orchestrator_settings", {
  // 0006 (H2b): id=1 = bản mặc định (tenant_id NULL); hàng tenant lấy id từ sequence (scope CHECK ở SQL).
  id: smallint("id").primaryKey().default(sql`nextval('hub.orchestrator_settings_id_seq')`),
  tenantId: uuid("tenant_id"),
  agentId: uuid("agent_id").notNull(),
  maxSteps: integer("max_steps").notNull().default(5),
  tokenBudget: integer("token_budget").notNull().default(200000),
  historyN: integer("history_n").notNull().default(10),
  onNoMatch: text("on_no_match", { enum: ["answer", "ask"] })
    .notNull()
    .default("answer"),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const agentEntitlements = hub.table(
  "agent_entitlements",
  {
    agentId: uuid("agent_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    grantedBy: uuid("granted_by"),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.tenantId] })],
);

// ── §3.2 Hội thoại (RLS) ──
const owned = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
});

export const conversations = hub.table("conversations", {
  ...owned(),
  title: text("title").notNull(),
  titleNorm: text("title_norm").notNull(),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const flows = hub.table("flows", {
  ...owned(),
  conversationId: uuid("conversation_id").notNull(),
  title: text("title").notNull(),
  agentId: uuid("agent_id"),
  pendingAsk: boolean("pending_ask").notNull().default(false),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: createdAt(),
  lastActiveAt: ts("last_active_at").notNull().defaultNow(),
});

export const messages = hub.table("messages", {
  ...owned(),
  conversationId: uuid("conversation_id").notNull(),
  flowId: uuid("flow_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  runId: uuid("run_id"),
  ask: jsonb("ask").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const runs = hub.table("runs", {
  ...owned(),
  conversationId: uuid("conversation_id").notNull(),
  flowId: uuid("flow_id").notNull(),
  kind: text("kind", { enum: RUN_KIND_VALUES }).notNull().default("orchestrated"),
  commandId: uuid("command_id"),
  featureId: uuid("feature_id"),
  // 0006 (H2b): run `direct` (agent_id + responder_*), Orchestrator theo tenant.
  agentId: uuid("agent_id"),
  orchestratorTenantId: uuid("orchestrator_tenant_id"),
  responderKey: text("responder_key"),
  responderName: text("responder_name"),
  // 0007 (H2c): tập file của run (R14, ≤ 10 — CHECK ở SQL).
  attachmentIds: uuid("attachment_ids").array().notNull().default(sql`'{}'`),
  status: text("status", { enum: RUN_STATUS_VALUES }).notNull(),
  configVersion: integer("config_version").notNull(),
  userMessageId: uuid("user_message_id").notNull(),
  answerMessageId: uuid("answer_message_id").notNull(),
  owner: text("owner"),
  leaseUntil: ts("lease_until"),
  lastSeq: integer("last_seq").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorHint: text("error_hint"),
  locale: text("locale", { enum: ["vi", "en"] })
    .notNull()
    .default("vi"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const runSteps = hub.table("run_steps", {
  ...owned(),
  runId: uuid("run_id").notNull(),
  seq: integer("seq").notNull(),
  type: text("type", { enum: RUN_STEP_TYPE_VALUES }).notNull(),
  workflowId: uuid("workflow_id"),
  agentId: uuid("agent_id"),
  providerKey: text("provider_key"),
  jobId: uuid("job_id"),
  labelKey: text("label_key").notNull(),
  status: text("status", { enum: RUN_STEP_STATUS_VALUES }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

// ── plan-db §3.3 Runtime (không RLS) ──
export const jobs = hub.table("jobs", {
  ...owned(),
  runId: uuid("run_id").notNull(),
  stepId: uuid("step_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  /** null chỉ khi `type = workflow.async` (CHECK `jobs_agent_ck`). */
  agentId: uuid("agent_id"),
  type: text("type", { enum: JOB_TYPE_VALUES }).notNull(),
  providerKey: text("provider_key").notNull(),
  priority: smallint("priority").notNull().default(100),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: JOB_STATUS_VALUES }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  workerId: text("worker_id"),
  pgid: integer("pgid"),
  heartbeatAt: ts("heartbeat_at"),
  cancelRequestedAt: ts("cancel_requested_at"),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  errorReason: text("error_reason"),
  errorMessage: text("error_message"),
  /** sha256 (32 byte) token job — Runtime ghi lúc claim, requeue xoá (plan H2a P4/RT1). */
  tokenHash: bytea("token_hash"),
  queuedAt: ts("queued_at").notNull().defaultNow(),
  dispatchedAt: ts("dispatched_at"),
  createdAt: createdAt(),
});

// ── H2a (0002_h2a_dify): xác nhận tool side_effect (RLS như bảng hội thoại), cờ workflow (seed ghi) ──
export const toolConfirmations = hub.table("tool_confirmations", {
  ...owned(),
  flowId: uuid("flow_id").notNull(),
  runId: uuid("run_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  workflowId: uuid("workflow_id").notNull(),
  status: text("status", { enum: TOOL_CONFIRMATION_STATUS_VALUES }).notNull(),
  decidedRunId: uuid("decided_run_id"),
  createdAt: createdAt(),
  decidedAt: ts("decided_at"),
  consumedAt: ts("consumed_at"),
});

export const workflowFlags = hub.table("workflow_flags", {
  workflowId: uuid("workflow_id").primaryKey(),
  sideEffect: boolean("side_effect").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const providerState = hub.table("provider_state", {
  providerKey: text("provider_key").primaryKey(),
  status: text("status", { enum: PROVIDER_STATE_VALUES }).notNull().default("ok"),
  cooldownUntil: ts("cooldown_until"),
  lastError: text("last_error"),
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  // H3a (0008_h3a_provider_state, WRK-FR-22): probe + tín hiệu quota; CHECK regex/[0,1] chỉ ở SQL.
  lastProbeAt: ts("last_probe_at"),
  lastOkAt: ts("last_ok_at"),
  rateLimitType: text("rate_limit_type"),
  utilization: real("utilization"),
  warnAt: ts("warn_at"),
  warnResetsAt: ts("warn_resets_at"),
});

export const agentTypes = hub.table("agent_types", {
  key: text("key").primaryKey(),
  runtime: text("runtime", { enum: ["agentic-cli", "llm", "python"] }).notNull(),
  description: jsonb("description").$type<{ vi: string; en: string }>().notNull(),
  configSchema: jsonb("config_schema").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull(),
  workerId: text("worker_id").notNull(),
  available: boolean("available").notNull().default(true),
  registeredAt: ts("registered_at").notNull().defaultNow(),
});

// ── H2c (0007_h2c_attachments): file đính kèm (RLS như bảng hội thoại; FK message_id SET NULL; CHECK ở SQL) ──
export const attachments = hub.table("attachments", {
  ...owned(),
  origin: text("origin", { enum: ATTACHMENT_ORIGIN_VALUES }).notNull(),
  /** NOT NULL ⇔ origin = output (CHECK `attachments_output_job_ck`). */
  jobId: uuid("job_id"),
  conversationId: uuid("conversation_id"),
  flowId: uuid("flow_id"),
  messageId: uuid("message_id"),
  /** Thứ tự trong tin (0–9), đặt khi gắn (R12). */
  position: smallint("position"),
  filename: text("filename").notNull(),
  safeName: text("safe_name").notNull(),
  mime: text("mime").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  /** `<tenant_id>/<id>` (CHECK `attachments_key_ck`). */
  storageKey: text("storage_key").notNull(),
  createdAt: createdAt(),
  boundAt: ts("bound_at"),
  purgedAt: ts("purged_at"),
});

// ── H3b (0009_h3b_agent_grants): audit Hub append-only (trigger chặn UPDATE/DELETE/TRUNCATE kể cả owner; CHECK ở SQL).
// Tên `hubAuditLog` tránh trùng `auditLog` (admin.audit_log, `ops.ts`). Không RLS — cách ly tenant ở repo (PL6).
export const hubAuditLog = hub.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Thứ tự ghi (identity) — sort/phân trang ổn định, `at` có thể trùng. */
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  at: ts("at").notNull().defaultNow(),
  tenantId: uuid("tenant_id").notNull(),
  actorId: uuid("actor_id"),
  actorUsername: text("actor_username"),
  actorRole: text("actor_role", { enum: HUB_AUDIT_ACTOR_ROLE_VALUES }),
  action: text("action", { enum: HUB_AUDIT_ACTION_VALUES }).notNull(),
  entity: text("entity", { enum: HUB_AUDIT_ENTITY_VALUES }).notNull(),
  entityId: uuid("entity_id"),
  /** ≤ 200 ký tự (CHECK `hub_audit_log_entity_name_check`). */
  entityName: text("entity_name").notNull().default(""),
  hubConfigVersion: integer("hub_config_version"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
});
