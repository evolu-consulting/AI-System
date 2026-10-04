// HUB-FR-75, WRK-FR-24 · kiểu Drizzle cho bảng `hub` mà hub-api dùng (plan H1 §3.1–3.3, plan-db §3.3).
// CHỈ để truy vấn có kiểu: DDL thật là `migrations-hub/0000_hub_core.sql` (viết tay), KHÔNG nằm trong drizzle.config.ts.
// Ràng buộc (CHECK, FK, index) chỉ ở SQL. Ba bảng stub (`agent_grants`, `agent_workflows`, `usage_logs`) ở `hub-readonly.ts`
// (kiểu của Admin, không thêm cột mới để `select()` của Admin chạy được trên DB chưa có migration Hub).
import {
  boolean,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

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
export const PROVIDER_STATE_VALUES = ["ok", "busy", "cooldown", "error", "logged_out"] as const;
export const AGENT_RUNTIME_VALUES = [
  "agentic-cli",
  "llm",
  "python",
  "dify-workflow",
  "dify-agent",
] as const;

// ── §3.1 Cấu hình ──
export const hubConfigMeta = hub.table("config_meta", {
  id: smallint("id").primaryKey(),
  hubConfigVersion: integer("hub_config_version").notNull().default(0),
});

export const providers = hub.table("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  kind: text("kind", { enum: ["subscription", "api"] }).notNull(),
  vendor: text("vendor", { enum: ["anthropic", "openai", "google", "fake"] }).notNull(),
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
  id: smallint("id").primaryKey(),
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
  kind: text("kind").notNull().default("orchestrated"),
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
  type: text("type", { enum: ["orchestrator", "delegate"] }).notNull(),
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
  agentId: uuid("agent_id").notNull(),
  type: text("type", { enum: ["agent.cli", "agent.run"] }).notNull(),
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
  createdAt: createdAt(),
});

export const providerState = hub.table("provider_state", {
  providerKey: text("provider_key").primaryKey(),
  status: text("status", { enum: PROVIDER_STATE_VALUES }).notNull().default("ok"),
  cooldownUntil: ts("cooldown_until"),
  lastError: text("last_error"),
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
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
