// HUB-FR-104 · HUB-FR-105 · HUB-FR-117 · ADM-FR-65 · CR-056 · API quản trị quy trình (plan-contract §6). Hằng + thực thể
// run export lại từ `chat/processes*` (một nguồn; Evolu Control xem run/token qua endpoint chat §3).
import { z } from "zod";
import {
  PROCESS_DESC_MAX,
  PROCESS_INPUT_MAX,
  PROCESS_LIST_LIMIT,
  PROCESS_NAME_MAX,
  PROCESS_RUN_GROUPS_MAX,
  PROCESS_STAGES_MAX,
  ProcessKeySchema,
  STAGE_TIMEOUT_S,
  TeamModeSchema,
} from "../chat/processes";
import { CountSchema, IsoDateTime, UuidSchema } from "../common";

export * from "../chat/processes";
export {
  type ProcessRunListQuery,
  ProcessRunListQuerySchema,
  type ProcessRunListResponse,
  ProcessRunListResponseSchema,
} from "../chat/processes-api";
export {
  type ProcessRunSummary,
  ProcessRunSummarySchema,
  type ProcessRunUsage,
  ProcessRunUsageSchema,
  type ProcessRunView,
  ProcessRunViewSchema,
} from "../chat/processes-entities";

export const HUB_ADMIN_PROCESS_ERRORS = {
  PROCESS_KEY_TAKEN: 409,
  PROCESS_DEF_INVALID: 422,
  PROCESS_DEF_INCOMPLETE: 422,
  PROCESS_REF_INVALID: 422,
  TEMPLATE_READ_ONLY: 403,
} as const;
export type HubAdminProcessErrorCode = keyof typeof HUB_ADMIN_PROCESS_ERRORS;
export const PROCESS_DEF_PATHS_MAX = 20;
export const PROCESS_REF_KINDS = ["agent", "team", "group", "user"] as const;
/** `PROCESS_DEF_INVALID` / `PROCESS_DEF_INCOMPLETE`; path dạng `stages.<i>.<trường>`. */
export const ProcessDefPathsDetailsSchema = z.strictObject({
  paths: z.array(z.string().min(1)).max(PROCESS_DEF_PATHS_MAX),
});
export const ProcessRefInvalidDetailsSchema = z.strictObject({
  path: z.string().min(1),
  ref: z.enum(PROCESS_REF_KINDS),
});

export const STAGE_INSTRUCTION_MAX = 4_000;
export const STAGE_TEMPLATE_MAX = 20_000;
export const STAGE_SECTIONS_MAX = 20;
export const STAGE_FIELDS_MAX = 20;
export const STAGE_TOKEN_BUDGET = { min: 1_000, max: 5_000_000 } as const;
export const OUTPUT_FILENAME_RE = /^[a-z0-9._-]{1,76}\.md$/;
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

const NameSchema = z.string().trim().min(1).max(PROCESS_NAME_MAX);

export const ProcessStageDefSchema = z.strictObject({
  key: ProcessKeySchema,
  name: NameSchema,
  executor: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("agent"), agent_id: UuidSchema }),
    z.strictObject({ kind: z.literal("team"), team_id: UuidSchema }),
  ]),
  instruction: z.string().max(STAGE_INSTRUCTION_MAX),
  output: z.strictObject({
    filename: z.string().regex(OUTPUT_FILENAME_RE),
    template: z.string().min(1).max(STAGE_TEMPLATE_MAX),
    required_sections: z
      .array(z.string().trim().min(1).max(PROCESS_NAME_MAX))
      .min(1)
      .max(STAGE_SECTIONS_MAX),
    fields: z
      .array(
        z.strictObject({
          key: z.string().regex(FIELD_KEY_RE),
          type: z.enum(["number", "string", "date"]),
          required: z.boolean(),
        }),
      )
      .max(STAGE_FIELDS_MAX),
  }),
  after: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("review"), group_id: UuidSchema.nullable() }),
    z.strictObject({ kind: z.literal("auto") }),
  ]),
  real_action: z.boolean(),
  answerer: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("starter") }),
    z.strictObject({ kind: z.literal("group"), group_id: UuidSchema }),
    z.strictObject({ kind: z.literal("user"), user_id: UuidSchema }),
  ]),
  timeout_s: z
    .number()
    .int()
    .min(STAGE_TIMEOUT_S.min)
    .max(STAGE_TIMEOUT_S.max)
    .default(STAGE_TIMEOUT_S.default),
  token_budget: z.number().int().min(STAGE_TOKEN_BUDGET.min).max(STAGE_TOKEN_BUDGET.max).nullable(),
});
export type ProcessStageDef = z.infer<typeof ProcessStageDefSchema>;

/** Hình dạng thôi (không luật chéo stage) — route dùng cái này + `validateProcessDef` để trả 422 có `paths`. */
export const ProcessDefInputBaseSchema = z.strictObject({
  key: ProcessKeySchema,
  name: NameSchema,
  description: z.string().max(PROCESS_DESC_MAX),
  input_hint: z.string().max(PROCESS_DESC_MAX),
  run_group_ids: z.array(UuidSchema).max(PROCESS_RUN_GROUPS_MAX),
  stages: z.array(ProcessStageDefSchema).min(1).max(PROCESS_STAGES_MAX),
  token_budget: z.number().int().min(STAGE_TOKEN_BUDGET.min).nullable(),
  enabled: z.boolean(),
});

/** Đường dẫn vi phạm luật chéo stage (key trùng; `real_action` ở stage 0 / sau stage `auto`) — dùng chung với def.rules. */
export function processDefStagePaths(stages: readonly ProcessStageDef[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  stages.forEach((s, i) => {
    if (seen.has(s.key)) paths.push(`stages.${i}.key`);
    seen.add(s.key);
    if (s.real_action && (i === 0 || stages[i - 1]?.after.kind !== "review")) {
      paths.push(`stages.${i}.real_action`);
    }
  });
  return paths;
}

/** Hình dạng + luật chéo stage (R-K08). */
export const ProcessDefInputSchema = ProcessDefInputBaseSchema.superRefine((d, ctx) => {
  for (const p of processDefStagePaths(d.stages)) {
    ctx.addIssue({ code: "custom", path: p.split("."), message: "invalid stage" });
  }
});
export type ProcessDefInput = z.infer<typeof ProcessDefInputBaseSchema>;

export const ProcessDefSchema = ProcessDefInputBaseSchema.extend({
  id: UuidSchema,
  tenant_id: UuidSchema.nullable(),
  is_template: z.boolean(),
  source_template_id: UuidSchema.nullable(),
  version: z.number().int().min(1),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type ProcessDef = z.infer<typeof ProcessDefSchema>;

export const UpdateProcessDefRequestSchema = ProcessDefInputBaseSchema.extend({
  version: z.number().int().min(1),
});
export type UpdateProcessDefRequest = z.infer<typeof UpdateProcessDefRequestSchema>;

export const CopyProcessDefRequestSchema = z.strictObject({
  key: ProcessKeySchema.optional(),
  name: NameSchema.optional(),
});
export type CopyProcessDefRequest = z.infer<typeof CopyProcessDefRequestSchema>;

export const RunProcessDefRequestSchema = z.strictObject({
  input: z.string().trim().max(PROCESS_INPUT_MAX),
});
export type RunProcessDefRequest = z.infer<typeof RunProcessDefRequestSchema>;

export const ProcessDefListQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  include_templates: z.stringbool().default(true),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PROCESS_LIST_LIMIT.max)
    .default(PROCESS_LIST_LIMIT.default),
  cursor: z.string().min(1).max(512).optional(),
});
export type ProcessDefListQuery = z.infer<typeof ProcessDefListQuerySchema>;
export const ProcessDefTenantQuerySchema = z.strictObject({ tenant_id: UuidSchema.optional() });
export const DeleteProcessDefQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  version: z.coerce.number().int().min(1),
});

export const ProcessDefListItemSchema = z.strictObject({
  id: UuidSchema,
  key: ProcessKeySchema,
  name: z.string().min(1).max(PROCESS_NAME_MAX),
  enabled: z.boolean(),
  is_template: z.boolean(),
  stage_count: z.number().int().min(1).max(PROCESS_STAGES_MAX),
  version: z.number().int().min(1),
  updated_at: IsoDateTime,
  active_runs: CountSchema,
});
export type ProcessDefListItem = z.infer<typeof ProcessDefListItemSchema>;
export const ProcessDefListResponseSchema = z.strictObject({
  items: z.array(ProcessDefListItemSchema).max(PROCESS_LIST_LIMIT.max),
  next_cursor: z.string().nullable(),
});
export type ProcessDefListResponse = z.infer<typeof ProcessDefListResponseSchema>;

const TeamNameSchema = z.string().min(1).max(100);
export const AgentTeamSchema = z.strictObject({
  id: UuidSchema,
  key: z.string().min(1).max(64),
  name: z.strictObject({ vi: TeamNameSchema, en: TeamNameSchema }),
  description: z.string().max(PROCESS_DESC_MAX),
  mode: TeamModeSchema,
  members: z
    .array(
      z.strictObject({
        agent: z.strictObject({
          id: UuidSchema,
          key: z.string().min(1).max(64),
          name: z.strictObject({ vi: TeamNameSchema, en: TeamNameSchema }),
        }),
        role: z.string().min(1).max(40),
        sections: z.array(z.string().min(1).max(PROCESS_NAME_MAX)).max(STAGE_SECTIONS_MAX),
      }),
    )
    .max(20),
});
export type AgentTeam = z.infer<typeof AgentTeamSchema>;
export const AgentTeamListResponseSchema = z.strictObject({ items: z.array(AgentTeamSchema) });
export type AgentTeamListResponse = z.infer<typeof AgentTeamListResponseSchema>;
