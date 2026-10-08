// HUB-FR-60 · HUB-FR-61 · HUB-FR-69 · H4a-R03..R06 · plan §2.3 — agent: union theo runtime (create), update theo runtime từ DB.
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";
import { AgentKeySchema } from "../hub/common";
import {
  AgentRuntimeSchema,
  CLI_KINDS,
  CWD_MODES,
  HubConfigVersionSchema,
  LocalizedNameSchema,
  listMetaSchema,
  STUDIO_CLI_TOOLS,
} from "./common";

const unique = (a: readonly unknown[]) => new Set(a).size === a.length;
const Version = z.number().int().min(1);
const WfIds = (min: number, max: number) =>
  z.array(UuidSchema).min(min).max(max).refine(unique, "duplicate ids");
const OPTIONS_MAX_BYTES = 16 * 1024;

const CliOptionsSchema = z.strictObject({
  cli: z.enum(CLI_KINDS).default("claude"),
  allowed_tools: z
    .array(z.enum(STUDIO_CLI_TOOLS))
    .max(6)
    .refine(unique, "duplicate tools")
    .default(["Read", "Grep"]),
  mcp: z.boolean().default(false),
  cwd_mode: z.enum(CWD_MODES).default("job"),
  max_turns: z.number().int().min(2).max(100).optional(),
});
const PythonOptionsSchema = z
  .record(z.string(), z.unknown())
  .refine((o) => JSON.stringify(o).length <= OPTIONS_MAX_BYTES, "runtime_options too large");

const nullish = z.null().optional();
const common = {
  name: LocalizedNameSchema,
  description: z.string().trim().min(20).max(400),
  system_prompt: z.string().max(20_000).default(""),
  timeout_s: z.number().int().min(10).max(3600).default(600),
  token_budget: z.number().int().min(1).max(10_000_000).nullable().default(null),
  enabled: z.boolean().default(true),
  bash_ack: z.boolean().optional(),
};

/** Phần riêng từng runtime (không gồm `runtime`, `key`) — dùng cho cả create lẫn update. */
const RUNTIME_SHAPES = {
  "agentic-cli": {
    profile_id: UuidSchema,
    /** CR-054 · model ghi đè profile (giá trị từ danh mục Runtime: alias `haiku`/`sonnet`/`opus` hoặc id); null = theo profile. */
    model: z.string().trim().min(1).max(100).nullable().default(null),
    agent_type_key: nullish,
    runtime_options: CliOptionsSchema.default(() => CliOptionsSchema.parse({})),
    workflow_ids: WfIds(0, 20).default([]),
  },
  llm: {
    profile_id: UuidSchema,
    agent_type_key: nullish,
    runtime_options: z.strictObject({}).default({}),
    workflow_ids: WfIds(0, 20).default([]),
  },
  "dify-workflow": {
    profile_id: nullish,
    agent_type_key: nullish,
    runtime_options: z.undefined().optional(),
    workflow_ids: WfIds(1, 1),
  },
  "dify-agent": {
    profile_id: nullish,
    agent_type_key: nullish,
    runtime_options: z.undefined().optional(),
    workflow_ids: WfIds(1, 1),
  },
  python: {
    profile_id: UuidSchema.nullish(),
    agent_type_key: AgentKeySchema,
    runtime_options: PythonOptionsSchema,
    workflow_ids: WfIds(0, 20).default([]),
  },
} as const;
type RuntimeKey = keyof typeof RUNTIME_SHAPES;

export const AgentCreateSchema = z.discriminatedUnion("runtime", [
  z.strictObject({
    runtime: z.literal("agentic-cli"),
    key: AgentKeySchema,
    ...common,
    ...RUNTIME_SHAPES["agentic-cli"],
  }),
  z.strictObject({
    runtime: z.literal("llm"),
    key: AgentKeySchema,
    ...common,
    ...RUNTIME_SHAPES.llm,
  }),
  z.strictObject({
    runtime: z.literal("dify-workflow"),
    key: AgentKeySchema,
    ...common,
    ...RUNTIME_SHAPES["dify-workflow"],
  }),
  z.strictObject({
    runtime: z.literal("dify-agent"),
    key: AgentKeySchema,
    ...common,
    ...RUNTIME_SHAPES["dify-agent"],
  }),
  z.strictObject({
    runtime: z.literal("python"),
    key: AgentKeySchema,
    ...common,
    ...RUNTIME_SHAPES.python,
  }),
]);
export type AgentCreate = z.infer<typeof AgentCreateSchema>;

/** PUT: không nhận `key`, `runtime` (P10/QB5; gửi ⇒ 400) + `version`. Route lấy runtime từ hàng DB. */
export function agentUpdateSchemaFor(runtime: RuntimeKey) {
  return z.strictObject({ ...common, ...RUNTIME_SHAPES[runtime], version: Version });
}

export const AgentEnabledSchema = z.strictObject({ enabled: z.boolean(), version: Version });
export const AgentDeleteQuerySchema = z.strictObject({ version: z.coerce.number().int().min(1) });
export const AgentListQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  runtime: AgentRuntimeSchema.optional(),
  enabled: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const AgentWarningSchema = z.union([
  z.strictObject({
    code: z.literal("description_overlap"),
    agent_id: UuidSchema,
    agent_key: z.string(),
    score: z.number().min(0).max(1),
  }),
  z.strictObject({ code: z.literal("runtime_not_ready") }),
  z.strictObject({ code: z.literal("tools_not_supported"), tools: z.array(z.string()) }),
]);
export type AgentWarning = z.infer<typeof AgentWarningSchema>;

export const OrchestratorOfSchema = z.strictObject({
  default: z.boolean(),
  tenant_ids: z.array(UuidSchema),
});

export const AgentSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  name: LocalizedNameSchema,
  description: z.string(),
  runtime: AgentRuntimeSchema,
  agent_type_key: z.string().nullable(),
  profile_id: UuidSchema.nullable(),
  /** CR-054 · vắng ở bản cũ. */
  model: z.string().nullable().optional(),
  system_prompt: z.string(),
  runtime_options: z.record(z.string(), z.unknown()),
  workflow_ids: z.array(UuidSchema),
  timeout_s: z.number().int(),
  token_budget: z.number().int().nullable(),
  enabled: z.boolean(),
  version: Version,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  runnable: z.boolean(),
  orchestrator_of: OrchestratorOfSchema,
  workflows: z.array(
    z.strictObject({
      id: UuidSchema,
      key: z.string(),
      name: z.string(),
      app_type: z.string(),
      description: z.string().nullable(),
      enabled: z.boolean(),
    }),
  ),
  warnings: z.array(AgentWarningSchema),
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentListItemSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  name: LocalizedNameSchema,
  description: z.string(),
  runtime: AgentRuntimeSchema,
  enabled: z.boolean(),
  version: Version,
  updated_at: IsoDateTime,
  profile: z.strictObject({ id: UuidSchema, key: z.string() }).nullable(),
  workflow_count: z.number().int().min(0),
  entitled_tenant_count: z.number().int().min(0),
  orchestrator_of: OrchestratorOfSchema,
  runnable: z.boolean(),
});
export type AgentListItem = z.infer<typeof AgentListItemSchema>;
export const AgentListSchema = listMetaSchema(AgentListItemSchema);
export type AgentList = z.infer<typeof AgentListSchema>;

export const AgentWriteResponseSchema = z.strictObject({
  agent: AgentSchema,
  hub_config_version: HubConfigVersionSchema,
});
export type AgentWriteResponse = z.infer<typeof AgentWriteResponseSchema>;
