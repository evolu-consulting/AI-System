// DLC-R14 · DLC-R15 · Evolu Control ↔ Hub cho AI SDLC: workflow loại DLC (`/dlc/workflows`, preset chạy một process của
// engine) và danh mục của engine (`/dlc/catalog`: bước, agent vai trò, process, hook). Không import `../hub`.
import { z } from "zod";
import { UuidSchema } from "../common";

export const DLC_PROCESSES = ["new-system", "enhancement", "bug-fix"] as const;
export const DLC_HUMAN_MODES = ["ask", "decide"] as const;
export const DLC_LANES = ["trivial", "small", "full"] as const;
export const DLC_WORKFLOWS_MAX = 200;
export const DLC_WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

export const DlcProcessSchema = z.enum(DLC_PROCESSES);
export type DlcProcess = z.infer<typeof DlcProcessSchema>;

const WorkflowFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(400),
  process: DlcProcessSchema,
  human_mode: z.enum(DLC_HUMAN_MODES).nullable(),
  lane: z.enum(DLC_LANES).nullable(),
  is_default: z.boolean(),
  enabled: z.boolean(),
};

export const DlcWorkflowSchema = z.strictObject({
  id: UuidSchema,
  key: z.string().regex(DLC_WORKFLOW_KEY_PATTERN),
  ...WorkflowFields,
  version: z.number().int().min(1),
  updated_at: z.string(),
});
export type DlcWorkflow = z.infer<typeof DlcWorkflowSchema>;

export const DlcWorkflowCreateSchema = z.strictObject({
  key: z.string().regex(DLC_WORKFLOW_KEY_PATTERN),
  ...WorkflowFields,
});
export type DlcWorkflowCreate = z.infer<typeof DlcWorkflowCreateSchema>;

/** PATCH: mọi trường tuỳ chọn + `version` (khác bản DB → 409 `VERSION_CONFLICT`). */
export const DlcWorkflowPatchSchema = z
  .strictObject({
    name: WorkflowFields.name,
    description: WorkflowFields.description,
    process: WorkflowFields.process,
    human_mode: WorkflowFields.human_mode,
    lane: WorkflowFields.lane,
    is_default: WorkflowFields.is_default,
    enabled: WorkflowFields.enabled,
  })
  .partial()
  .extend({ version: z.number().int().min(1) });
export type DlcWorkflowPatch = z.infer<typeof DlcWorkflowPatchSchema>;

export const DlcWorkflowListResponseSchema = z.strictObject({
  items: z.array(DlcWorkflowSchema).max(DLC_WORKFLOWS_MAX),
});
export type DlcWorkflowListResponse = z.infer<typeof DlcWorkflowListResponseSchema>;

export const DlcCatalogStepSchema = z.strictObject({
  id: z.string().max(40),
  title: z.string().max(200),
  roles: z.array(z.string().max(48)).max(50),
  hook_events: z.array(z.string().max(40)).max(20),
  optional: z.boolean(),
});
export const DlcCatalogAgentSchema = z.strictObject({
  role: z.string().max(48),
  kind: z.string().max(20),
  step: z.string().max(40),
  does: z.string().max(400),
  model: z.string().max(100),
});
export const DlcCatalogProcessSchema = z.strictObject({
  id: z.string().max(40),
  title: z.string().max(100),
  input: z.string().max(400),
  steps: z.array(z.string().max(40)).max(20),
});
export const DlcHookSchema = z.strictObject({
  id: z.number().int(),
  name: z.string().max(200),
  event: z.string().max(40),
  mode: z.string().max(20),
  enabled: z.boolean(),
});
export type DlcCatalogStep = z.infer<typeof DlcCatalogStepSchema>;
export type DlcCatalogAgent = z.infer<typeof DlcCatalogAgentSchema>;
export type DlcCatalogProcess = z.infer<typeof DlcCatalogProcessSchema>;
export type DlcHook = z.infer<typeof DlcHookSchema>;

/** `engine` ≠ `ok` ⇒ các mảng rỗng (engine không tới được / Hub chưa cấu hình `HUB_DLC_URL`). */
export const DlcCatalogResponseSchema = z.strictObject({
  engine: z.enum(["ok", "unreachable", "not_configured"]),
  default_model: z.string().max(100),
  steps: z.array(DlcCatalogStepSchema).max(30),
  agents: z.array(DlcCatalogAgentSchema).max(100),
  processes: z.array(DlcCatalogProcessSchema).max(20),
  hooks: z.array(DlcHookSchema).max(200),
});
export type DlcCatalogResponse = z.infer<typeof DlcCatalogResponseSchema>;
