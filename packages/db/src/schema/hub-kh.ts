// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · CR-073 · kiểu Drizzle cho 5 bảng KnowledgeHub (spec K1 §4, plan §5).
// CHỈ để truy vấn có kiểu: DDL thật, CHECK, unique `lower(name)`, FK (RESTRICT/CASCADE), RLS `v_t` và GRANT ở
// `migrations-hub/0029_k1_kh.sql` (viết tay). `kh_connections`/`agent_kh` là cấu hình nền tảng (không tenant, không RLS);
// `kh_jobs`/`kh_stage_usage`/`kh_writes` theo tenant (RLS "T"). Không có cột giá trị khoá — chỉ `secret_id`.
import {
  KH_CONNECTION_STATUSES,
  KH_WARNING_CODES,
  type KhCheckResult,
  type KhProjectId,
} from "@ai/contracts/hub-admin";
import {
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";
import { SECRET_AUDIT_ACTIONS, SECRET_AUDIT_ENTITIES } from "./hub-secrets";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Khớp CHECK audit ở 0029 (plan §4). */
export const K1_AUDIT_ACTIONS = ["check", "degrade", "write_fail"] as const;
export const K1_AUDIT_ENTITIES = ["kh_connection", "kh_query", "kh_worklog"] as const;
/** Phần audit thêm sau P-a (H4b-1 + K1) — trải vào `HUB_AUDIT_*_VALUES` (`hub.ts`, giữ file ≤ 400 dòng). */
export const EXT_AUDIT_ACTIONS = [...SECRET_AUDIT_ACTIONS, ...K1_AUDIT_ACTIONS] as const;
export const EXT_AUDIT_ENTITIES = [...SECRET_AUDIT_ENTITIES, ...K1_AUDIT_ENTITIES] as const;

export const KH_WRITE_STATUS_VALUES = ["pending", "done", "failed", "skipped"] as const;

/** Phần tử `kh_jobs.items` (KH + project chốt lúc tạo job — plan D6). */
export type KhJobItemRow = {
  connection_id: string;
  name: string;
  summary_project: KhProjectId | null;
  projects: KhProjectId[];
};

export const khConnections = hub.table("kh_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** FK `hub.secrets` RESTRICT; phải `kind = kh_api_key` ∧ nền tảng (kiểm ở service). */
  secretId: uuid("secret_id").notNull(),
  summaryProject: text("summary_project"),
  checkStatus: text("check_status", { enum: KH_CONNECTION_STATUSES })
    .notNull()
    .default("unchecked"),
  checkedAt: ts("checked_at"),
  checkResult: jsonb("check_result").$type<KhCheckResult>(),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const agentKh = hub.table(
  "agent_kh",
  {
    agentId: uuid("agent_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    /** 0..4 = thứ tự tick. */
    position: smallint("position").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.connectionId] }),
    unique("agent_kh_position_uq").on(t.agentId, t.position),
  ],
);

export const khJobs = hub.table("kh_jobs", {
  jobId: uuid("job_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  items: jsonb("items").$type<KhJobItemRow[]>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const khStageUsage = hub.table(
  "kh_stage_usage",
  {
    stageRunId: uuid("stage_run_id").notNull(),
    attempt: smallint("attempt").notNull(),
    round: smallint("round").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    queries: smallint("queries").notNull().default(0),
    lastWarning: text("last_warning", { enum: KH_WARNING_CODES }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.stageRunId, t.attempt, t.round] })],
);

export const khWrites = hub.table("kh_writes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  processRunId: uuid("process_run_id").notNull(),
  stageRunId: uuid("stage_run_id").notNull(),
  /** UNIQUE — `ON CONFLICT (output_id) DO NOTHING`. */
  outputId: uuid("output_id").notNull().unique("kh_writes_output_uq"),
  /** Không FK: bộ gửi đọc lại kết nối; mất ⇒ `skipped`. */
  connectionId: uuid("connection_id").notNull(),
  projectId: text("project_id").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  vectorId: text("vector_id").notNull(),
  status: text("status", { enum: KH_WRITE_STATUS_VALUES }).notNull().default("pending"),
  attempts: smallint("attempts").notNull().default(0),
  nextAt: ts("next_at").notNull().defaultNow(),
  lastCode: text("last_code"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
