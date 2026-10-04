// HUB-FR-89, WRK-FR-07 · job `workflow.async` (Dify) và cấu hình MCP của job `agent.cli` (plan H2a §2.2).
// Quy tắc H1 §2: chỉ kiểu biểu diễn được bằng JSON Schema — cấm refine/transform/coerce/default.
// Payload **không** có `base_url`, app-key, token job, URL Hub (P4, Q5: Runtime lấy key qua `/internal/jobs/:id/dify-credential`).
import { z } from "zod";
import {
  CATALOG_KEY_RE,
  INPUT_NAME_RE,
  OUTPUT_FIELD_MAX,
  TIMEOUT_MAX_S,
  TIMEOUT_MIN_S,
} from "../common";
import { HubUuidSchema, VersionSchema } from "./common";

export const WorkflowKeySchema = z.string().regex(CATALOG_KEY_RE);
export type WorkflowKey = z.infer<typeof WorkflowKeySchema>;

export const MCP_URL_MAX = 2048;
export const MCP_TOOLS_MAX = 20;
export const HTTP_URL_RE = /^https?:\/\//;

/** Token job không nằm ở đây (P4): Runtime sinh lúc claim, chỉ đưa vào file cấu hình MCP 0600. */
export const McpConfigSchema = z.strictObject({
  url: z.string().min(1).max(MCP_URL_MAX).regex(HTTP_URL_RE),
  tools: z.array(WorkflowKeySchema).min(1).max(MCP_TOOLS_MAX),
});
export type McpConfig = z.infer<typeof McpConfigSchema>;

export const DIFY_APP_TYPES = ["workflow", "chat", "agent"] as const;
export const DifyAppTypeSchema = z.enum(DIFY_APP_TYPES);
export type DifyAppType = z.infer<typeof DifyAppTypeSchema>;

/** Giới hạn ≤ 50 khoá là luật Hub (input_map ≤ INPUT_SCHEMA_MAX) — record không biểu diễn được `maxProperties` hai phía. */
export const WORKFLOW_INPUTS_MAX = 50;
export const WORKFLOW_INPUT_TEXT_MAX = 64_000;
export const WORKFLOW_QUERY_MAX = 16_000;
export const DIFY_USER_MAX = 200;

export const WorkflowInputValueSchema = z.union([
  z.string().max(WORKFLOW_INPUT_TEXT_MAX),
  z.number(),
  z.boolean(),
]);

export const WorkflowAsyncJobSchema = z.strictObject({
  v: VersionSchema,
  type: z.literal("workflow.async"),
  provider_key: z.literal("dify"),
  job_id: HubUuidSchema,
  run_id: HubUuidSchema,
  step_id: HubUuidSchema,
  tenant_id: HubUuidSchema,
  user_id: HubUuidSchema,
  conversation_id: HubUuidSchema,
  flow_id: HubUuidSchema,
  workflow_id: HubUuidSchema,
  feature_id: HubUuidSchema.nullable(),
  command_id: HubUuidSchema.nullable(),
  workflow_key: WorkflowKeySchema,
  app_type: DifyAppTypeSchema,
  inputs: z.record(z.string().regex(INPUT_NAME_RE), WorkflowInputValueSchema),
  // Bắt buộc khi app_type chat/agent — luật Hub, không ở schema.
  query: z.string().min(1).max(WORKFLOW_QUERY_MAX).nullable(),
  output_field: z.string().min(1).max(OUTPUT_FIELD_MAX).nullable(),
  dify_user: z.string().min(1).max(DIFY_USER_MAX),
  side_effect: z.boolean(),
  timeout_s: z.number().int().min(TIMEOUT_MIN_S).max(TIMEOUT_MAX_S),
});
export type WorkflowAsyncJob = z.infer<typeof WorkflowAsyncJobSchema>;
