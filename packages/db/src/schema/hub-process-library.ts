// CR-105 · thư viện quy trình + gán tenant × khe — kiểu Drizzle CHỈ để truy vấn có kiểu. DDL thật, CHECK (`slot` regex), FK
// `ON DELETE RESTRICT`, index `assignments(def_id)`, RLS (gán: đọc T, ghi system; releases/khe: chỉ system) và REVOKE
// UPDATE/DELETE trên releases ở `migrations-hub/0068_process_library.sql` (viết tay). Cột mới của `process_defs` ở `hub-processes.ts`.
import { boolean, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** CR-105 · L2a · audit thư viện (0069 `hub_audit_log_action_check`) — trải vào `HUB_AUDIT_ACTION_VALUES` (hub.ts). */
export const LIB_AUDIT_ACTIONS = [
  "publish",
  "rollback",
  "assign",
  "unassign",
  "set_default",
  // CR-118 §11.2 (0087): gán/bỏ gán quy trình vào tập của tenant + lưu luật chọn quy trình.
  "assign_process",
  "unassign_process",
  "set_routing",
] as const;

/** dlc-step-library · audit thư viện bước DLC (0071 `hub_audit_log_entity_check`) — trải vào `PA_AUDIT_ENTITIES` (hub-processes.ts). */
export const DLC_STEP_AUDIT_ENTITIES = ["dlc_step_template"] as const;

/** Bản xuất bản BẤT BIẾN của def thư viện; quay lại = chụp bản cũ thành bản mới (số bản luôn tăng). */
export const processDefReleases = hub.table(
  "process_def_releases",
  {
    defId: uuid("def_id").notNull(),
    relVersion: integer("rel_version").notNull(),
    name: text("name").notNull(),
    stages: jsonb("stages").$type<unknown[]>().notNull(),
    slotBody: jsonb("slot_body").$type<Record<string, unknown>>(),
    publishedBy: uuid("published_by"),
    publishedAt: ts("published_at").notNull().defaultNow(),
    note: text("note").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.defId, t.relVersion] })],
);

/** Đúng một mặc định mỗi khe. */
export const processSlots = hub.table("process_slots", {
  slot: text("slot").primaryKey(),
  defaultDefId: uuid("default_def_id").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** CR-118 §11.2 · tập quy trình thư viện platform đã gán cho tenant (nhiều mỗi khe). DDL/RLS: `0087_process_routing.sql`. */
export const processTenantDefs = hub.table(
  "process_tenant_defs",
  {
    tenantId: uuid("tenant_id").notNull(),
    defId: uuid("def_id").notNull(),
    slot: text("slot").notNull(),
    assignedBy: uuid("assigned_by"),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.defId] })],
);

/** CR-118 §11.2 · đầu danh sách luật tenant × khe (`version` chống ghi đè đồng thời). */
export const processRoutings = hub.table(
  "process_routings",
  {
    tenantId: uuid("tenant_id").notNull(),
    slot: text("slot").notNull(),
    version: integer("version").notNull().default(1),
    updatedBy: uuid("updated_by"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.slot] })],
);

/** CR-118 §11.2 · luật có thứ tự; `def_id` ∈ tập đã gán (FK); ≤ 1 `is_default` mỗi tenant × khe. */
export const processRoutingRules = hub.table("process_routing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  slot: text("slot").notNull(),
  priority: integer("priority").notNull(),
  condition: jsonb("condition")
    .$type<{ departmentIds?: string[]; contractKinds?: string[] }>()
    .notNull(),
  defId: uuid("def_id").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  /** CR-121 D-4 · 'admin' = người gán/sửa · 'auto' = `ensureSlotDefaults` tự cấp (hub 0096). Cổng engine duyệt HĐ: có luật 'admin'. */
  source: text("source").$type<"admin" | "auto">().notNull().default("admin"),
});

/** dlc-step-library · bước DLC mẫu (platform_admin): Canvas khe `dlc.*` chép thành bước. DDL/CHECK/RLS: `0071_dlc_step_templates.sql`. */
export const dlcStepTemplates = hub.table("dlc_step_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  action: text("action").notNull(),
  agentKey: text("agent_key"),
  instruction: text("instruction").notNull().default(""),
  gateGroup: text("gate_group"),
  rejectTo: text("reject_to"),
  maxRounds: integer("max_rounds").notNull().default(3),
  timeoutMin: integer("timeout_min").notNull().default(60),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
