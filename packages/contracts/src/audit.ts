// ADM-FR-51, ADM-FR-52 · M4-R10…R13 · contract /admin/audit* (plan-contract §2.4).
// Hằng khớp `AUDIT_ACTION_VALUES` / `AUDIT_ENTITY_VALUES` của @ai/db (test ở packages/db).
import { z } from "zod";
import { IsoDateTime, LIST_Q_MAX, TenantKeySchema, UuidSchema, VersionSchema } from "./common";
import { DateOnlySchema } from "./quotas";

export const AUDIT_ENTITIES = [
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
export const AUDIT_ACTIONS = [
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
export const AUDIT_LIMIT_DEFAULT = 50;
export const AUDIT_LIMIT_MAX = 200;
export const AUDIT_CURSOR_MAX = 32;

export const AuditEntitySchema = z.enum(AUDIT_ENTITIES);
export type AuditEntity = z.infer<typeof AuditEntitySchema>;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditListQuerySchema = z.strictObject({
  tenant_id: z.union([UuidSchema, z.literal("system")]).optional(),
  entity: AuditEntitySchema.optional(),
  action: AuditActionSchema.optional(),
  actor_id: UuidSchema.optional(),
  entity_id: UuidSchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  q: z.string().trim().min(1).max(LIST_Q_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_LIMIT_MAX).default(AUDIT_LIMIT_DEFAULT),
  cursor: z.string().max(AUDIT_CURSOR_MAX).optional(),
});
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

export const AuditSummarySchema = z.strictObject({
  subject_type: z.string().optional(),
  subject_name: z.string().optional(),
  feature_key: z.string().optional(),
  tenant_key: TenantKeySchema.optional(),
  added: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional(),
  value_changed: z.literal(true).optional(),
  password_reset: z.literal(true).optional(),
  restored_from: UuidSchema.optional(),
  restored_version: z.number().int().optional(),
  file: z.string().optional(),
  added_count: z.number().int().min(0).optional(),
  updated_count: z.number().int().min(0).optional(),
});
export type AuditSummary = z.infer<typeof AuditSummarySchema>;

const auditItemShape = {
  id: UuidSchema,
  at: IsoDateTime,
  tenant_id: UuidSchema.nullable(),
  tenant_key: z.string().nullable(),
  actor_id: UuidSchema.nullable(),
  actor_username: z.string().nullable(),
  action: AuditActionSchema,
  entity: AuditEntitySchema,
  entity_id: UuidSchema.nullable(),
  entity_name: z.string(),
  config_version: z.number().int().nullable(),
  entity_version: z.number().int().nullable(),
  summary: AuditSummarySchema,
  restorable: z.boolean(),
};
export const AuditItemSchema = z.strictObject(auditItemShape);
export type AuditItem = z.infer<typeof AuditItemSchema>;

const JsonObject = z.record(z.string(), z.unknown()).nullable();
export const AuditDetailSchema = z.strictObject({
  ...auditItemShape,
  before: JsonObject,
  after: JsonObject,
});
export type AuditDetail = z.infer<typeof AuditDetailSchema>;

export const AuditListResponseSchema = z.strictObject({
  items: z.array(AuditItemSchema),
  next_cursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

export const AuditRestoreRequestSchema = z.strictObject({});
export const AuditRestoreResponseSchema = z.strictObject({
  entity: AuditEntitySchema,
  entity_id: UuidSchema,
  version: VersionSchema,
  audit_id: UuidSchema,
});
export type AuditRestoreResponse = z.infer<typeof AuditRestoreResponseSchema>;

/** details của 409 `NAME_TAKEN`. */
export const NameTakenDetailsSchema = z.strictObject({
  entity: AuditEntitySchema,
  name: z.string(),
});
export type NameTakenDetails = z.infer<typeof NameTakenDetailsSchema>;
/** details của 409 `RESTORE_REF_MISSING`. */
export const RestoreRefMissingDetailsSchema = z.strictObject({
  missing: z.array(z.strictObject({ entity: AuditEntitySchema, id: UuidSchema })).min(1),
});
export type RestoreRefMissingDetails = z.infer<typeof RestoreRefMissingDetailsSchema>;
