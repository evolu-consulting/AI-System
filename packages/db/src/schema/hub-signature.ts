// CR-181 · lát s1 · kiểu Drizzle cho chữ ký nội bộ (`hub.user_signatures`, `hub.signature_settings`, `hub.signature_change_grants`).
// CHỈ để truy vấn có kiểu: DDL thật, CHECK, index (unique partial «một bản đang dùng»), RLS và hàm DEFINER `hub.sig_*` ở `migrations-hub/0155_cr181_signatures.sql`.
// BẪY: RLS chỉ cho `app.scope='system'` ⇒ hub_rw ở scope người dùng KHÔNG đọc/ghi bảng trực tiếp; luôn đi qua hàm `hub.sig_*` / `hub.signature_for_stamp`.
import {
  SIGNATURE_SETTINGS_DEFAULT,
  type SignatureKind,
  type SignatureMethod,
  type SignatureSettings,
} from "@ai/contracts/signature";
import { boolean, customType, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Audit chữ ký (0155 `hub_audit_log_action_check` / `_entity_check`) — trải vào `EXT_AUDIT_ACTIONS` / `EXT_AUDIT_ENTITIES` (hub-kh.ts → `HUB_AUDIT_*_VALUES`; `hub.ts`/`hub-processes.ts` chạm trần 400 dòng). */
export const SIGNATURE_AUDIT_ACTIONS = [
  "signature_created",
  "signature_settings_changed",
  "signature_change_requested",
  "signature_change_granted",
  "document_signed",
] as const;
export const SIGNATURE_AUDIT_ENTITIES = ["signature"] as const;

/** Một chữ ký của một người; đổi = retire (`retiredAt`) + hàng mới, không xoá. */
export const userSignatures = hub.table("user_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").$type<SignatureKind>().notNull(),
  method: text("method").$type<SignatureMethod>().notNull(),
  png: bytea("png").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  retiredAt: ts("retired_at"),
});

export const signatureSettings = hub.table("signature_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  methods: text("methods").array().$type<SignatureSettings["methods"]>().notNull(),
  required: boolean("required").notNull().default(SIGNATURE_SETTINGS_DEFAULT.required),
  caption: text("caption").array().$type<SignatureSettings["caption"]>().notNull(),
  ink: text("ink").$type<SignatureSettings["ink"]>().notNull(),
  initials: text("initials").$type<SignatureSettings["initials"]>().notNull(),
  changePolicy: text("change_policy").$type<SignatureSettings["change_policy"]>().notNull(),
  onDocEnabled: boolean("on_doc_enabled").notNull().default(false),
  digitalEnabled: boolean("digital_enabled").notNull().default(false),
  digitalProvider: text("digital_provider"),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const signatureChangeGrants = hub.table("signature_change_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  grantedBy: uuid("granted_by"),
  grantedAt: ts("granted_at"),
  usedAt: ts("used_at"),
});
