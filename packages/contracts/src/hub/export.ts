// HUB-FR-89 · schema xuất JSON Schema → pydantic (plan H1 §2.6, C2; H2a §2.2–2.3). Key = tên model Python.
// `JobPayloadWorkflowAsync` có tên riêng để `JobPayload` tham chiếu $ref (pydantic `JobPayloadWorkflowAsync`); `agent.cli` giữ `JobPayload1`.
import type { z } from "zod";
import { DifyCredentialResponseSchema } from "../hub-internal/credential";
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
import { WorkflowAsyncJobSchema } from "./workflow";

export const HUB_JSON_SCHEMAS = {
  JobPayload: JobPayloadSchema,
  RunEvent: RunEventSchema,
  AgentResult: AgentResultSchema,
  OrchestratorDecision: OrchestratorDecisionSchema,
  AgentTypeManifest: AgentTypeManifestSchema,
  JobEnqueuedPayload: JobEnqueuedPayloadSchema,
  JobCancelPayload: JobCancelPayloadSchema,
  HubConfigChangedPayload: HubConfigChangedPayloadSchema,
  JobPayloadWorkflowAsync: WorkflowAsyncJobSchema,
  DifyCredentialResponse: DifyCredentialResponseSchema,
} as const satisfies Record<string, z.ZodType>;
export type HubJsonSchemaName = keyof typeof HUB_JSON_SCHEMAS;
