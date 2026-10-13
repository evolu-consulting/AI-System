// HUB-FR-66 · HUB-FR-67 · spec H4b2 §3 A–B · plan D4/D6/D11/D12 — Models Studio: provider (CRUD, bật/tắt, kiểm tra
// key) và model profile (CRUD). Chỉ platform_admin. Mọi object strict; key/kind/vendor provider và key profile bất biến (Q8).
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";
import { AgentKeySchema } from "../hub/common";
import { PROFILE_STEPS_MAX, ProfileStepSchema } from "../hub/job";
import { versionConflictDetailsSchema } from "../version-conflict";
import { ModelProfileItemSchema, ProviderItemSchema } from "./catalog";
import { KeyTakenDetailsSchema, StudioInvalidReferenceDetailsSchema } from "./errors";

/** Giá trị DB (`providers_kind_check`); BA "subscription-cli" = `subscription`. */
export const PROVIDER_KINDS = ["subscription", "api"] as const;
/** Vendor chọn được ở Studio (Q3); `dify` = readonly, do seed quản. `fake` ⇒ luôn `dev_only = true`. */
export const STUDIO_PROVIDER_VENDORS = ["anthropic", "openai", "google", "fake"] as const;
export const PROVIDER_STATE_STATUSES = ["ok", "busy", "cooldown", "error", "logged_out"] as const;
export const PROVIDER_CHECK_STATUSES = ["ok", "error", "unsupported", "requested"] as const;
export const PROVIDER_CHECK_ERROR_CODES = [
  "auth_failed",
  "http_error",
  "timeout",
  "network",
  "secret_unreadable",
] as const;
export const REF_LIST_MAX = 50;

export const ProviderKeySchema = AgentKeySchema;
/** Luật https/loopback ở `baseUrlProblem` (hub-api `models.rules.ts`) — sai ⇒ 400 path `base_url`. */
export const BaseUrlSchema = z.string().trim().max(300).nullable();
const VersionField = z.number().int().min(1);
const MaxConcurrencySchema = z.number().int().min(1).max(100);

export const RefSchema = z.strictObject({ id: UuidSchema, key: z.string() });
export type Ref = z.infer<typeof RefSchema>;

/** Trạng thái sống do Runtime ghi (`hub.provider_state`) — chỉ ở chi tiết. */
export const ProviderStateSchema = z.strictObject({
  status: z.enum(PROVIDER_STATE_STATUSES),
  cooldown_until: IsoDateTime.nullable(),
  last_probe_at: IsoDateTime.nullable(),
  last_ok_at: IsoDateTime.nullable(),
  utilization: z.number().nullable(),
  last_error: z.string().max(500).nullable(),
});
export type ProviderState = z.infer<typeof ProviderStateSchema>;

// ── A. Provider ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const ProviderCreateSchema = z.strictObject({
  key: ProviderKeySchema,
  kind: z.enum(PROVIDER_KINDS),
  vendor: z.enum(STUDIO_PROVIDER_VENDORS),
  base_url: BaseUrlSchema,
  secret_id: UuidSchema.nullable(),
  max_concurrency: MaxConcurrencySchema.default(1),
  enabled: z.boolean().default(true),
});
export type ProviderCreate = z.infer<typeof ProviderCreateSchema>;
export const ProviderUpdateSchema = z.strictObject({
  version: VersionField,
  base_url: BaseUrlSchema,
  secret_id: UuidSchema.nullable(),
  max_concurrency: MaxConcurrencySchema,
  enabled: z.boolean(),
});
export type ProviderUpdate = z.infer<typeof ProviderUpdateSchema>;
export const ProviderEnabledPatchSchema = z.strictObject({
  version: VersionField,
  enabled: z.boolean(),
});
/** `DELETE /providers/:id?version=N` và `DELETE /model-profiles/:id?version=N`. */
export const VersionQuerySchema = z.strictObject({ version: z.coerce.number().int().min(1) });

export const ProviderDetailSchema = ProviderItemSchema.extend({
  secret: z.strictObject({ id: UuidSchema, name: z.string() }).nullable(),
  readonly: z.boolean(),
  updated_at: IsoDateTime,
  state: ProviderStateSchema.nullable(),
  used_by_profiles: z.array(RefSchema).max(REF_LIST_MAX),
});
export type ProviderDetail = z.infer<typeof ProviderDetailSchema>;

export const ProviderCheckResultSchema = z.strictObject({
  status: z.enum(PROVIDER_CHECK_STATUSES),
  error_code: z.enum(PROVIDER_CHECK_ERROR_CODES).nullable(),
  http_status: z.number().int().nullable(),
  message: z.string().max(500).nullable(),
  latency_ms: z.number().int().min(0).nullable(),
  checked_at: IsoDateTime,
});
export type ProviderCheckResult = z.infer<typeof ProviderCheckResultSchema>;

// ── B. Model profile ─────────────────────────────────────────────────────────────────────────────────────────────────
const StepsSchema = z.array(ProfileStepSchema).min(1).max(PROFILE_STEPS_MAX);
export const ModelProfileWriteSchema = z.strictObject({
  key: ProviderKeySchema,
  steps: StepsSchema,
});
export type ModelProfileWrite = z.infer<typeof ModelProfileWriteSchema>;
export const ModelProfileUpdateSchema = z.strictObject({
  version: VersionField,
  steps: StepsSchema,
});
export type ModelProfileUpdate = z.infer<typeof ModelProfileUpdateSchema>;
export const ModelProfileSchema = ModelProfileItemSchema.extend({
  updated_at: IsoDateTime,
  used_by_agents: z.array(RefSchema).max(REF_LIST_MAX),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

// ── Mã lỗi riêng (D12: không sửa STUDIO_ERRORS đã khoá) + details ───────────────────────────────────────────────────
export const STUDIO_MODEL_ERRORS = {
  PROVIDER_IN_USE: 409,
  PROVIDER_HAS_HISTORY: 409,
  PROVIDER_READONLY: 409,
  PROFILE_IN_USE: 409,
} as const satisfies Record<string, 409>;
export type StudioModelErrorCode = keyof typeof STUDIO_MODEL_ERRORS;

export const ProviderInUseDetailsSchema = z.strictObject({
  profiles: z.array(RefSchema).min(1).max(REF_LIST_MAX),
});
export const ProfileInUseDetailsSchema = z.strictObject({
  agents: z.array(RefSchema).min(1).max(REF_LIST_MAX),
});
export const ProviderVersionConflictDetailsSchema =
  versionConflictDetailsSchema(ProviderDetailSchema);
export const ModelProfileVersionConflictDetailsSchema =
  versionConflictDetailsSchema(ModelProfileSchema);

/** `details` theo mã cho route Models (mã không có ở đây ⇒ không có `details`). */
export const STUDIO_MODEL_ERROR_DETAILS = {
  PROVIDER_IN_USE: ProviderInUseDetailsSchema,
  PROFILE_IN_USE: ProfileInUseDetailsSchema,
  KEY_TAKEN: KeyTakenDetailsSchema,
  INVALID_REFERENCE: StudioInvalidReferenceDetailsSchema,
} as const;
