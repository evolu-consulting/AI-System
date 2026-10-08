// HUB-FR-72 · H4a-R13 · plan §2.5 — đọc catalog (không secret).
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";
import { LocalizedNameSchema, listMetaSchema } from "./common";

export const CatalogQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
});
export const WorkflowCatalogQuerySchema = CatalogQuerySchema.extend({
  app_type: z.string().min(1).max(50).optional(),
});

export const AgentTypeItemSchema = z.strictObject({
  key: z.string(),
  runtime: z.enum(["agentic-cli", "llm", "python"]),
  description: LocalizedNameSchema,
  config_schema: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  available: z.boolean(),
});
export const ModelProfileItemSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  steps: z.array(
    z.strictObject({ provider_key: z.string(), model: z.string(), on: z.array(z.string()) }),
  ),
});
export const ProviderItemSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  kind: z.string(),
  vendor: z.string(),
  base_url: z.string().nullable(),
  has_secret: z.boolean(),
  max_concurrency: z.number().int(),
  enabled: z.boolean(),
  dev_only: z.boolean(),
  state: z
    .strictObject({
      status: z.string(),
      cooldown_until: z.string().nullable(),
      utilization: z.number().nullable(),
    })
    .nullable(),
});
export const WorkflowItemSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  app_type: z.string(),
  usable_for: z.array(z.enum(["tool", "dify-workflow", "dify-agent"])),
});
export const TenantItemSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  active: z.boolean(),
  has_orchestrator: z.boolean(),
});

export const AgentTypeListSchema = listMetaSchema(AgentTypeItemSchema);
export const ModelProfileListSchema = listMetaSchema(ModelProfileItemSchema);

/** CR-054 · danh mục model thật Runtime đọc từ CLI (`hub.provider_models`), sắp theo provider + thứ tự CLI. */
export const ModelCatalogItemSchema = z.strictObject({
  provider_key: z.string(),
  value: z.string(),
  resolved_model: z.string().nullable(),
  display_name: z.string(),
  description: z.string(),
  fetched_at: IsoDateTime,
});
export type ModelCatalogItem = z.infer<typeof ModelCatalogItemSchema>;
export const ModelCatalogListSchema = z.strictObject({ items: z.array(ModelCatalogItemSchema) });
export type ModelCatalogList = z.infer<typeof ModelCatalogListSchema>;
export const ProviderListSchema = listMetaSchema(ProviderItemSchema);
export const WorkflowListSchema = listMetaSchema(WorkflowItemSchema);
export const TenantListSchema = listMetaSchema(TenantItemSchema);
