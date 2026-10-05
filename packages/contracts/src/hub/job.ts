// HUB-FR-89 · payload `hub.jobs.payload` Hub ghi, Runtime đọc (plan H1 §2.2; H2a §2.2: `workflow.async`, `mcp`).
import { z } from "zod";
import { ATTACH_MAX_BYTES, AttachMimeSchema } from "../common";
import {
  AgentKeySchema,
  ALLOWED_TOOLS,
  AllowedToolSchema,
  HubUuidSchema,
  VersionSchema,
} from "./common";
import { McpConfigSchema, WorkflowAsyncJobSchema } from "./workflow";

export const PROFILE_STEPS_MAX = 5;
export const HISTORY_MAX = 50;
export const HISTORY_CONTENT_MAX = 64_000;
export const SYSTEM_PROMPT_MAX = 20_000;
export const PROMPT_MAX = 200_000;
export const FALLBACK_TRIGGERS = ["error", "quota", "timeout"] as const;
export const AGENT_ROLES = ["orchestrator", "agent"] as const;
export const JOB_OUTPUTS = ["agent_result", "text"] as const;

// HUB-FR-44, WRK-FR-11 · H2c (plan §2.2): file đính kèm job agent CLI; Runtime tải qua `/internal/jobs/:id/attachments/:aid`.
export const JOB_ATTACHMENTS_MAX = 10;
export const JOB_OUTPUTS_MAX = 5;
export const JOB_FILE_NAME_MAX = 120;
/** Không bắt đầu bằng `.`/`-`, không `/`, `\`, ký tự điều khiển (không lookahead — pydantic-core regex Rust). ≤ 120 byte kiểm ở Hub. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: cấm ký tự điều khiển trong tên file job
export const JOB_FILE_NAME_RE = /^[^./\\\x00-\x1f\x7f-][^/\\\x00-\x1f\x7f]*$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export const JobAttachmentSchema = z.strictObject({
  id: HubUuidSchema,
  name: z.string().min(1).max(JOB_FILE_NAME_MAX).regex(JOB_FILE_NAME_RE),
  mime: AttachMimeSchema,
  size: z.number().int().min(1).max(ATTACH_MAX_BYTES),
  sha256: z.string().regex(SHA256_HEX_RE),
});
export type JobAttachment = z.infer<typeof JobAttachmentSchema>;

/** null = mặc định của CLI. */
const ModelSchema = z.string().min(1).max(100).nullable();

export const ProfileStepSchema = z.strictObject({
  provider_key: AgentKeySchema,
  model: ModelSchema,
  on: z.array(z.enum(FALLBACK_TRIGGERS)).max(FALLBACK_TRIGGERS.length),
});
export type ProfileStep = z.infer<typeof ProfileStepSchema>;

export const HistoryItemSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(HISTORY_CONTENT_MAX),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export const JobAgentSchema = z.strictObject({
  id: HubUuidSchema,
  key: AgentKeySchema,
  role: z.enum(AGENT_ROLES),
});
export type JobAgent = z.infer<typeof JobAgentSchema>;

export const AgentCliJobSchema = z.strictObject({
  v: VersionSchema,
  type: z.literal("agent.cli"),
  runtime: z.literal("agentic-cli"),
  job_id: HubUuidSchema,
  run_id: HubUuidSchema,
  step_id: HubUuidSchema,
  tenant_id: HubUuidSchema,
  user_id: HubUuidSchema,
  conversation_id: HubUuidSchema,
  flow_id: HubUuidSchema,
  feature_id: HubUuidSchema.nullable(),
  agent_type_key: AgentKeySchema.nullable(),
  mcp: McpConfigSchema.nullable(),
  agent: JobAgentSchema,
  provider_key: AgentKeySchema,
  model: ModelSchema,
  step_index: z
    .number()
    .int()
    .min(0)
    .max(PROFILE_STEPS_MAX - 1),
  // Hub điền (agent 30, Orchestrator 3) — schema không `default` để pydantic sinh khớp.
  max_turns: z.number().int().min(1).max(100),
  profile_steps: z.array(ProfileStepSchema).min(1).max(PROFILE_STEPS_MAX),
  system_prompt: z.string().max(SYSTEM_PROMPT_MAX),
  prompt: z.string().min(1).max(PROMPT_MAX),
  history: z.array(HistoryItemSchema).max(HISTORY_MAX),
  use_session: z.boolean(),
  allowed_tools: z.array(AllowedToolSchema).max(ALLOWED_TOOLS.length),
  output: z.enum(JOB_OUTPUTS),
  timeout_s: z.number().int().min(10).max(3600),
  /** H2b P3: Runtime phát `job.delta`; vắng = `false` (không `default` — pydantic sinh khớp). */
  stream: z.boolean().optional(),
  /** H2c F1: chỉ khi run có file (vắng = không file; Hub không ghi mảng rỗng). */
  attachments: z.array(JobAttachmentSchema).max(JOB_ATTACHMENTS_MAX).optional(),
});
export type AgentCliJob = z.infer<typeof AgentCliJobSchema>;

export const JobPayloadSchema = z.discriminatedUnion("type", [
  AgentCliJobSchema,
  WorkflowAsyncJobSchema,
]);
export type JobPayload = z.infer<typeof JobPayloadSchema>;
