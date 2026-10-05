// HUB-FR-60, HUB-FR-61, HUB-FR-62, HUB-FR-23 · schema zod của seed yaml Hub (plan H1 §3.1, §3.6; H2a plan-db §4).
// strictObject: trường lạ (vd `secret`) bị từ chối — yaml không được chứa secret/app-key (H1-R16).

import { USERNAME_RE } from "@ai/contracts";
import { AgentKeySchema, ProfileStepSchema, WorkflowKeySchema } from "@ai/contracts/hub";
import { z } from "zod";

/** Giá trị `profile` của agent được thay bằng profile seed (`HUB_SEED_PROFILE`, plan §3.6). */
export const SEED_PROFILE_TOKEN = "$HUB_SEED_PROFILE";
export const PROVIDER_KINDS = ["subscription", "api"] as const;
export const PROVIDER_VENDORS = ["anthropic", "openai", "google", "fake", "dify"] as const;
export const SEED_AGENT_RUNTIMES = [
  "agentic-cli",
  "llm",
  "python",
  "dify-workflow",
  "dify-agent",
] as const;

const TenantKeySchema = z.string().min(1).max(64);
const LocalizedNameSchema = z.strictObject({
  vi: z.string().min(1).max(100),
  en: z.string().min(1).max(100),
});

export const SeedProviderSchema = z.strictObject({
  key: AgentKeySchema,
  kind: z.enum(PROVIDER_KINDS),
  vendor: z.enum(PROVIDER_VENDORS),
  base_url: z.url().nullable().default(null),
  max_concurrency: z.number().int().min(1).max(100).default(1),
  enabled: z.boolean().default(true),
  dev_only: z.boolean().default(false),
});

export const SeedProfileStepSchema = ProfileStepSchema.extend({
  model: ProfileStepSchema.shape.model.default(null),
  on: ProfileStepSchema.shape.on.default([]),
});

export const SeedProfileSchema = z.strictObject({
  key: AgentKeySchema,
  steps: z.array(SeedProfileStepSchema).min(1).max(5),
});

export const SeedAgentSchema = z.strictObject({
  key: AgentKeySchema,
  name: LocalizedNameSchema,
  description: z.string().min(20).max(400),
  runtime: z.enum(SEED_AGENT_RUNTIMES),
  profile: z.union([AgentKeySchema, z.literal(SEED_PROFILE_TOKEN)]),
  system_prompt: z.string().max(20_000).default(""),
  runtime_options: z.record(z.string(), z.unknown()).default({}),
  timeout_s: z.number().int().min(10).max(3600).default(600),
  token_budget: z.number().int().min(1).nullable().default(null),
  enabled: z.boolean().default(true),
});

/** H2a plan-db §4: agent `dify-*` chỉ có `workflow_key` (key Admin, `CATALOG_KEY_RE`); thừa khoá → lỗi seed. */
export const DIFY_RUNTIMES = ["dify-workflow", "dify-agent"] as const;
export type DifyRuntime = (typeof DIFY_RUNTIMES)[number];
export const DifyRuntimeOptionsSchema = z.strictObject({ workflow_key: WorkflowKeySchema });

export const SeedAgentWorkflowSchema = z.strictObject({
  agent: AgentKeySchema,
  workflow: WorkflowKeySchema,
});

/** Chỉ bật cờ (upsert `side_effect = true`), không tắt cờ workflow vắng mặt. */
export const SeedWorkflowFlagsSchema = z.strictObject({
  side_effect: z.array(WorkflowKeySchema).default([]),
});

export const SeedOrchestratorSchema = z.strictObject({
  agent: AgentKeySchema,
  max_steps: z.number().int().min(1).max(20).default(5),
  token_budget: z.number().int().min(1).default(200_000),
  history_n: z.number().int().min(1).max(50).default(10),
  on_no_match: z.enum(["answer", "ask"]).default("answer"),
});

/**
 * H2b-R13: một mục `orchestrator_tenants` — trường thiếu lấy từ bản mặc định cùng yaml (không `default` ở đây;
 * `planOrchestratorTenants` điền).
 */
export const SeedOrchestratorTenantSchema = z.union([
  z.strictObject({
    tenant_key: TenantKeySchema,
    agent: AgentKeySchema,
    max_steps: z.number().int().min(1).max(20).optional(),
    token_budget: z.number().int().min(1).optional(),
    history_n: z.number().int().min(1).max(50).optional(),
    on_no_match: z.enum(["answer", "ask"]).optional(),
  }),
  z.strictObject({ tenant_key: TenantKeySchema, remove: z.literal(true) }),
]);

export const SeedEntitlementSchema = z.strictObject({
  agent: AgentKeySchema,
  tenant_key: TenantKeySchema,
});

const USER_SUBJECT = new RegExp(`^user:${USERNAME_RE.source.slice(1, -1)}$`);
const GROUP_SUBJECT = /^group:[a-z0-9][a-z0-9-]{0,63}$/;
export const SeedGrantSchema = z.strictObject({
  agent: AgentKeySchema,
  tenant_key: TenantKeySchema,
  subject: z
    .string()
    .refine(
      (s) => USER_SUBJECT.test(s) || GROUP_SUBJECT.test(s),
      "subject phải là user:<username> hoặc group:<key>",
    ),
});

/** Một file yaml: mọi mục tuỳ chọn; các file trong thư mục được gộp (plan §3.6). */
export const SeedFileSchema = z.strictObject({
  providers: z.array(SeedProviderSchema).default([]),
  model_profiles: z.array(SeedProfileSchema).default([]),
  agents: z.array(SeedAgentSchema).default([]),
  orchestrator: SeedOrchestratorSchema.optional(),
  entitlements: z.array(SeedEntitlementSchema).default([]),
  grants: z.array(SeedGrantSchema).default([]),
  agent_workflows: z.array(SeedAgentWorkflowSchema).default([]),
  workflow_flags: SeedWorkflowFlagsSchema.optional(),
  /** H2b-R13: bản Orchestrator riêng theo tenant (vắng = giữ nguyên hàng tenant trong DB). */
  orchestrator_tenants: z.array(SeedOrchestratorTenantSchema).max(1000).default([]),
});

export type SeedProvider = z.infer<typeof SeedProviderSchema>;
export type SeedProfile = z.infer<typeof SeedProfileSchema>;
export type SeedAgent = z.infer<typeof SeedAgentSchema>;
export type SeedOrchestrator = z.infer<typeof SeedOrchestratorSchema>;
export type SeedOrchestratorTenant = z.infer<typeof SeedOrchestratorTenantSchema>;
export type SeedEntitlement = z.infer<typeof SeedEntitlementSchema>;
export type SeedGrant = z.infer<typeof SeedGrantSchema>;
export type SeedAgentWorkflow = z.infer<typeof SeedAgentWorkflowSchema>;
export type SeedFile = z.infer<typeof SeedFileSchema>;
