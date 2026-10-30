// CR-105 · thư viện quy trình + gán tenant × khe — kiểu Drizzle CHỈ để truy vấn có kiểu. DDL thật, CHECK (`slot` regex), FK
// `ON DELETE RESTRICT`, index `assignments(def_id)`, RLS (gán: đọc T, ghi system; releases/khe: chỉ system) và REVOKE
// UPDATE/DELETE trên releases ở `migrations-hub/0068_process_library.sql` (viết tay). Cột mới của `process_defs` ở `hub-processes.ts`.
import { integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** CR-105 · L2a · audit thư viện (0069 `hub_audit_log_action_check`) — trải vào `HUB_AUDIT_ACTION_VALUES` (hub.ts). */
export const LIB_AUDIT_ACTIONS = [
  "publish",
  "rollback",
  "assign",
  "unassign",
  "set_default",
] as const;

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

/** Gán tenant × khe = đúng một def thư viện; gán lại = upsert thay thế; không hàng ⇒ chạy mặc định. */
export const processSlotAssignments = hub.table(
  "process_slot_assignments",
  {
    tenantId: uuid("tenant_id").notNull(),
    slot: text("slot").notNull(),
    defId: uuid("def_id").notNull(),
    assignedBy: uuid("assigned_by"),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.slot] })],
);
