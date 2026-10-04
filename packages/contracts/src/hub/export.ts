// HUB-FR-89 · schema xuất JSON Schema → pydantic (plan H1 §2.6, C2). Key = tên model Python.
import type { z } from "zod";
import { OrchestratorDecisionSchema } from "./decision";
import { RunEventSchema } from "./events";
import { JobPayloadSchema } from "./job";
import { AgentTypeManifestSchema } from "./manifest";
import {
  HubConfigChangedPayloadSchema,
  JobCancelPayloadSchema,
  JobEnqueuedPayloadSchema,
} from "./notify";
import { AgentResultSchema } from "./result";

export const HUB_JSON_SCHEMAS = {
  JobPayload: JobPayloadSchema,
  RunEvent: RunEventSchema,
  AgentResult: AgentResultSchema,
  OrchestratorDecision: OrchestratorDecisionSchema,
  AgentTypeManifest: AgentTypeManifestSchema,
  JobEnqueuedPayload: JobEnqueuedPayloadSchema,
  JobCancelPayload: JobCancelPayloadSchema,
  HubConfigChangedPayload: HubConfigChangedPayloadSchema,
} as const satisfies Record<string, z.ZodType>;
export type HubJsonSchemaName = keyof typeof HUB_JSON_SCHEMAS;
