// HUB-FR-66 · HUB-FR-67 · kiểu phụ cho Models Studio (spec H4b2 §4, plan D1). Bảng `providers`/`model_profiles` ở `hub.ts`
// (cột `version` từ `migrations-hub/0030_h4b2_models.sql`, viết tay). CHECK, GRANT theo cột chỉ ở SQL.

/** Trải vào `HUB_AUDIT_ENTITY_VALUES` (`hub.ts`) — khớp `hub_audit_log_entity_check` ở 0030. */
export const MODELS_AUDIT_ENTITIES = ["provider", "model_profile"] as const;

/** Một bước của `hub.model_profiles.steps` (jsonb) — khớp `ProfileStepSchema` (`@ai/contracts/hub`, model nullable). */
export type ModelProfileStep = { provider_key: string; model: string | null; on: string[] };
