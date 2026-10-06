// HUB-FR-62 · H4a-R07..R09 · plan §2.4 — cấu hình Orchestrator (mặc định + theo tenant).
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";
import { AgentRuntimeSchema, HubConfigVersionSchema, ON_NO_MATCH_VALUES } from "./common";

const Version = z.number().int().min(1);
const inputShape = {
  agent_id: UuidSchema,
  max_steps: z.number().int().min(1).max(20),
  token_budget: z.number().int().min(1000).max(10_000_000),
  history_n: z.number().int().min(1).max(50),
  on_no_match: z.enum(ON_NO_MATCH_VALUES),
};
export const OrchestratorInputSchema = z.strictObject(inputShape);
export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;
export const OrchestratorPutSchema = z.strictObject({ ...inputShape, version: Version });
export const OrchestratorTenantCreateSchema = z.strictObject({
  ...inputShape,
  tenant_id: UuidSchema,
});
export const OrchestratorDeleteQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(1),
});

export const OrchestratorSchema = z.strictObject({
  id: z.number().int(),
  tenant: z.strictObject({ id: UuidSchema, key: z.string(), name: z.string() }).nullable(),
  agent: z.strictObject({
    id: UuidSchema,
    key: z.string(),
    name: z.string(),
    runtime: AgentRuntimeSchema,
    enabled: z.boolean(),
  }),
  max_steps: z.number().int(),
  token_budget: z.number().int(),
  history_n: z.number().int(),
  on_no_match: z.enum(ON_NO_MATCH_VALUES),
  version: Version,
  updated_by: UuidSchema.nullable(),
  updated_at: IsoDateTime,
  warnings: z.array(z.literal("agentic_cli_slow")),
});
export type Orchestrator = z.infer<typeof OrchestratorSchema>;

export const OrchestratorListSchema = z.strictObject({
  default: OrchestratorSchema,
  tenants: z.array(OrchestratorSchema).max(200),
  hub_config_version: HubConfigVersionSchema,
});
export type OrchestratorList = z.infer<typeof OrchestratorListSchema>;
export const OrchestratorWriteResponseSchema = z.strictObject({
  orchestrator: OrchestratorSchema,
  hub_config_version: HubConfigVersionSchema,
});
export type OrchestratorWriteResponse = z.infer<typeof OrchestratorWriteResponseSchema>;
