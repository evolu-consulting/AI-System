// HUB-FR-72 · plan §2.1 — 12 mã lỗi Studio + `details` (strict). Dùng kèm VALIDATION_ERROR/AUTH_EXPIRED/NOT_FOUND/INTERNAL_ERROR.
import { z } from "zod";
import { UuidSchema } from "../common";
import { versionConflictDetailsSchema } from "../version-conflict";
import { AgentSchema } from "./agents";
import { OrchestratorSchema } from "./orchestrator";

export const STUDIO_ERRORS = {
  FORBIDDEN: 403,
  INVALID_REFERENCE: 400,
  VERSION_CONFLICT: 409,
  KEY_TAKEN: 409,
  BASH_ACK_REQUIRED: 422,
  AGENT_IN_USE_AS_ORCHESTRATOR: 409,
  AGENT_HAS_HISTORY: 409,
  AGENT_HAS_ACCESS: 409,
  AGENT_NOT_ORCHESTRATABLE: 409,
  ORCHESTRATOR_EXISTS: 409,
  ORCHESTRATOR_DEFAULT_PROTECTED: 409,
  TENANT_INACTIVE: 409,
} as const satisfies Record<string, 400 | 403 | 409 | 422>;
export type StudioErrorCode = keyof typeof STUDIO_ERRORS;

export const StudioInvalidReferenceDetailsSchema = z.strictObject({
  field: z.enum(["profile_id", "workflow_ids", "agent_type_key", "agent_id", "tenant_id"]),
  ids: z.array(UuidSchema).max(20).optional(),
  reason: z
    .enum(["not_found", "disabled", "app_type", "no_input", "runtime_mismatch", "unavailable"])
    .optional(),
});
export const AgentVersionConflictDetailsSchema = versionConflictDetailsSchema(AgentSchema);
export const OrchestratorVersionConflictDetailsSchema =
  versionConflictDetailsSchema(OrchestratorSchema);
export const AgentInUseDetailsSchema = z.strictObject({
  scopes: z
    .array(
      z.union([
        z.strictObject({ tenant_id: z.null() }),
        z.strictObject({ tenant_id: UuidSchema, tenant_key: z.string() }),
      ]),
    )
    .min(1),
});
export const AgentHasAccessDetailsSchema = z.strictObject({
  entitlements: z.number().int().min(0),
  grants: z.number().int().min(0),
});
export const AgentNotOrchestratableDetailsSchema = z.strictObject({
  reason: z.enum(["disabled", "runtime_unsupported"]),
});
export const KeyTakenDetailsSchema = z.strictObject({ field: z.literal("key") });
