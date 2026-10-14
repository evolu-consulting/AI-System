// HUB-FR-89 · payload `hub.jobs.payload` Hub ghi, Runtime đọc (plan H1 §2.2; H2a §2.2: `workflow.async`, `mcp`).
import { z } from "zod";
import { STAGE_KEY_RE } from "../chat/processes";
import { ATTACH_MAX_BYTES, AttachMimeSchema } from "../common";
import { AutofixCmdSchema, AutofixWriteAllowlistSchema } from "../hub-admin/autofix";
import {
  ApplyModeSchema,
  BranchSchema,
  GitUrlSchema,
  GlobSchema,
  RESOLVE_ALLOWLIST_MAX,
  RESOLVE_ITEMS_MAX,
  SOURCE_SHA_RE,
  SourceConfigSchema,
  SourceKeySchema,
  SourceKindSchema,
  SourcePinSchema,
  STAGE_ALLOWLIST_MAX,
  STAGE_SOURCES_MAX,
} from "../hub-admin/sources";
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

/** P-b · nguồn chỉ-đọc gắn vào job stage `agent.cli` (PB-R10). */
export const JobSourceSchema = z.strictObject({
  key: SourceKeySchema,
  kind: SourceKindSchema,
  pin: SourcePinSchema,
  allowlist: z.array(GlobSchema).max(STAGE_ALLOWLIST_MAX),
});
export type JobSource = z.infer<typeof JobSourceSchema>;

/** P-c1 · HUB-FR-128 · phần tự-sửa của job: nhánh `ai/<run uuid>/<stage_key>`; nguồn KHÔNG allowlist (ghi qua `write_allowlist`). */
export const AUTOFIX_ROUND_MAX = 100;
export const AUTOFIX_BRANCH_RE = new RegExp(`^ai/[0-9a-f-]{36}/${STAGE_KEY_RE.source.slice(1)}`);
export const JobAutofixSchema = z.strictObject({
  source: JobSourceSchema.extend({ allowlist: z.array(GlobSchema).max(0) }),
  install_cmd: AutofixCmdSchema.nullable(),
  test_cmd: AutofixCmdSchema,
  write_allowlist: AutofixWriteAllowlistSchema,
  branch: z.string().regex(AUTOFIX_BRANCH_RE),
  round: z.number().int().min(1).max(AUTOFIX_ROUND_MAX),
  base_patch: JobAttachmentSchema.nullable(),
});
export type JobAutofix = z.infer<typeof JobAutofixSchema>;

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
  /** P-b · nguồn tham chiếu chỉ-đọc (PB-R10): mount `work/<job_id>/sources/<key>/`; có nguồn ⇒ Hub ép R/G/G. */
  sources: z.array(JobSourceSchema).max(STAGE_SOURCES_MAX).optional(),
  /** P-c1 · job tự-sửa trong sandbox container; vắng = job thường (không `default` — pydantic sinh khớp). */
  autofix: JobAutofixSchema.optional(),
});
export type AgentCliJob = z.infer<typeof AgentCliJobSchema>;

// ── P-b · kênh resolve nguồn (D4): job `source.resolve`, Runtime dựng snapshot → `/sources-resolved` ──────────────────
export const ResolveItemSchema = z.strictObject({
  source_id: HubUuidSchema,
  key: SourceKeySchema,
  kind: SourceKindSchema,
  config: SourceConfigSchema,
  allowlist_union: z.array(GlobSchema).max(RESOLVE_ALLOWLIST_MAX),
  /** P-c1 · `autofix` ⇒ Runtime dựng thêm bản git sâu cho stage tự-sửa; vắng = `source`. */
  caps: z.enum(["source", "autofix"]).optional(),
});
export type ResolveItem = z.infer<typeof ResolveItemSchema>;

export const SourceResolveJobSchema = z.strictObject({
  v: VersionSchema,
  type: z.literal("source.resolve"),
  job_id: HubUuidSchema,
  tenant_id: HubUuidSchema,
  process_run_id: HubUuidSchema.nullable(),
  items: z.array(ResolveItemSchema).min(1).max(RESOLVE_ITEMS_MAX),
  timeout_s: z.number().int().min(10).max(300),
});
export type SourceResolveJob = z.infer<typeof SourceResolveJobSchema>;

// ── P-c2 · HUB-FR-129 · WRK-FR-29 · job `source.apply` (plan §3.3): Runtime áp diff đã duyệt lên nhánh `ai/…` rồi push ──
export const SourceApplyJobSchema = z
  .strictObject({
    v: VersionSchema,
    type: z.literal("source.apply"),
    job_id: HubUuidSchema,
    tenant_id: HubUuidSchema,
    process_run_id: HubUuidSchema,
    /** Chỉ `git_remote`; khoá lấy qua `/internal/jobs/:id/source-credential` khi `has_credential` (không có giá trị ở đây). */
    source: z.strictObject({
      source_id: HubUuidSchema,
      key: SourceKeySchema,
      url: GitUrlSchema,
      branch: BranchSchema,
      has_credential: z.boolean(),
    }),
    pin_sha: z.string().regex(SOURCE_SHA_RE),
    branch: z.string().regex(AUTOFIX_BRANCH_RE),
    /** C8 · chế độ hiệu lực lúc launch. */
    apply_mode: ApplyModeSchema,
    push_only: z.boolean(),
    /** Diff của kết quả tự-sửa `ok` (thuộc run — PB-R18). */
    patch: JobAttachmentSchema,
    install_cmd: AutofixCmdSchema.nullable(),
    test_cmd: AutofixCmdSchema,
    write_allowlist: AutofixWriteAllowlistSchema,
    timeout_s: z.number().int().min(60).max(3600),
  })
  .superRefine((j, ctx) => {
    if (j.push_only !== (j.apply_mode === "branch_only"))
      ctx.addIssue({ code: "custom", path: ["push_only"], message: "push_only iff branch_only" });
  });
export type SourceApplyJob = z.infer<typeof SourceApplyJobSchema>;

export const JobPayloadSchema = z.discriminatedUnion("type", [
  AgentCliJobSchema,
  WorkflowAsyncJobSchema,
  SourceResolveJobSchema,
  SourceApplyJobSchema,
]);
export type JobPayload = z.infer<typeof JobPayloadSchema>;
