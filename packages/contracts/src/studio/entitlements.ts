// HUB-FR-77 · HUB-FR-78 · HUB-BR-17 · spec H4b2 §3 C · plan D2 — Quyền agent: ma trận agent × tenant (entitlement).
// Chỉ platform_admin. Ghi gọi nguyên `AgentSettingsService.putEntitlement` (CR-054); công thức HUB-FR-77 không đổi.
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";

export const ENTITLEMENT_MATRIX_MAX = 200;
export const ENTITLEMENT_GRANTS_MAX = 200;
export const ENTITLEMENT_SUBJECT_TYPES = ["group", "user", "tenant"] as const;

/** `name` = `agents.name.vi` (chuỗi; nhãn ma trận theo key — readiness #3–#32, khớp mock e2e qc). */
const IdKeyName = { id: UuidSchema, key: z.string(), name: z.string() } as const;

export const EntitlementAgentSchema = z.strictObject({
  ...IdKeyName,
  enabled: z.boolean(),
  is_orchestrator: z.boolean(),
  /** Orchestrator riêng của một tenant ⇒ ô tenant khác không áp dụng. */
  only_tenant_id: UuidSchema.nullable(),
});
export const EntitlementTenantSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  active: z.boolean(),
});
const GrantCountsSchema = z.strictObject({
  group: z.number().int().min(0),
  user: z.number().int().min(0),
  tenant: z.number().int().min(0),
});
/** Chỉ entitlement CHƯA thu hồi. */
export const EntitlementCellSchema = z.strictObject({
  agent_id: UuidSchema,
  tenant_id: UuidSchema,
  granted_at: IsoDateTime,
  grant_count: z.number().int().min(0),
  grants: GrantCountsSchema,
});
export const EntitlementMatrixSchema = z.strictObject({
  agents: z.array(EntitlementAgentSchema).max(ENTITLEMENT_MATRIX_MAX),
  tenants: z.array(EntitlementTenantSchema).max(ENTITLEMENT_MATRIX_MAX),
  cells: z.array(EntitlementCellSchema),
  truncated: z.boolean(),
  hub_config_version: z.number().int().min(0),
});
export type EntitlementMatrix = z.infer<typeof EntitlementMatrixSchema>;

/** Path `/agent-entitlements/:agent_id/:tenant_id` — không phải uuid ⇒ 400 VALIDATION_ERROR. */
export const EntitlementCellParamsSchema = z.strictObject({
  agent_id: UuidSchema,
  tenant_id: UuidSchema,
});

export const EntitlementGrantSchema = z.strictObject({
  id: UuidSchema,
  subject_type: z.enum(ENTITLEMENT_SUBJECT_TYPES),
  subject: z.strictObject({ id: UuidSchema, name: z.string() }),
  granted_by_username: z.string().nullable(),
  granted_at: IsoDateTime,
});
/** Drawer ô: grant hiện cả khi entitlement đã thu hồi. */
export const EntitlementCellDetailSchema = z.strictObject({
  agent: z.strictObject(IdKeyName),
  tenant: z.strictObject({ id: UuidSchema, key: z.string(), name: z.string() }),
  entitled: z.boolean(),
  granted_at: IsoDateTime.nullable(),
  granted_by: z.strictObject({ id: UuidSchema, username: z.string() }).nullable(),
  revoked_at: IsoDateTime.nullable(),
  grants: z.array(EntitlementGrantSchema).max(ENTITLEMENT_GRANTS_MAX),
  grants_truncated: z.boolean(),
});
export type EntitlementCellDetail = z.infer<typeof EntitlementCellDetailSchema>;

/** Phản hồi PUT (cấp, idempotent) / DELETE (thu hồi). */
export const EntitlementWriteResultSchema = z.strictObject({
  hub_config_version: z.number().int().min(0),
  affected_grants: z.number().int().min(0),
});
export type EntitlementWriteResult = z.infer<typeof EntitlementWriteResultSchema>;
