// HUB-FR-104 · HUB-FR-105 · HUB-FR-117 · ADM-FR-65 · CR-056 · API quản trị quy trình (plan-contract §6). Hằng + thực thể
// run export lại từ `chat/processes*` (một nguồn; Evolu Control xem run/token qua endpoint chat §3).
import { z } from "zod";
import { APP_NODE_KEY_RE, OUTCOME_KEY_RE } from "../app-manifest/manifest";
import { EVIDENCE_MODES } from "../chat/evidence";
import {
  APPROVER_MODES,
  PROCESS_DESC_MAX,
  PROCESS_INPUT_MAX,
  PROCESS_NAME_MAX,
  PROCESS_RUN_GROUPS_MAX,
  PROCESS_STAGES_CEILING,
  PROCESS_STEP_MAX,
  ProcessKeySchema,
  ProcessStepSchema,
  REMIND_EVERY_H,
  STAGE_KEY_RE,
  STAGE_TIMEOUT_S,
  STAGE_TIMEOUT_S_HARD_MAX,
  TASK_NEEDS,
  TeamModeSchema,
  TtlDaysSchema,
} from "../chat/processes";
import { IsoDateTime, UuidSchema } from "../common";
import { StartFormConfigSchema } from "../modules/core/start-form/config";
import { AutofixCmdSchema, AutofixWriteAllowlistSchema } from "./autofix";
import { ApproveExecutorSchema, ApproveParallelSchema } from "./process-approve";
import { FormExecutorSchema } from "./process-form";
import {
  AnswererGroupSchema,
  type StageEscalate,
  StageEscalateSchema,
  StageGroupKeySchema,
} from "./process-group-refs";
import { IfExecutorSchema } from "./process-if";
import { LIBRARY_DEF_FIELDS, LIBRARY_DEF_INPUT_FIELDS } from "./process-library";
import { NotifyExecutorSchema } from "./process-notify";
import { SetExecutorSchema } from "./process-set";
import { PROCESS_DEF_RULES, processDefStageIssues } from "./process-steps";
import { HUB_ADMIN_SUBPROCESS_ERRORS, SubprocessExecutorSchema } from "./process-subprocess";
import {
  AfterBranchSchema,
  type BranchRule,
  FIELD_KEY_RE,
  ProcessToolItemSchema,
  ToolExecutorSchema,
} from "./process-tools";
import { StageUiSchema } from "./process-ui";
import {
  WaitEventExecutorSchema,
  WaitForExecutorSchema,
  WaitUntilExecutorSchema,
} from "./process-wait";
import {
  DEF_INPUTS_MAX,
  DEF_SOURCES_MAX,
  ProcessInputDefSchema,
  ProcessInputValueSchema,
  SourceKeySchema,
  STAGE_SOURCES_MAX,
  type StageSource,
  StageSourceSchema,
} from "./sources";

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
export * from "./autofix";
export * from "./dlc-step-templates";
export * from "./process-approve";
export * from "./process-company";
export * from "./process-library";
export * from "./process-notify";
export * from "./process-routing";
export * from "./process-steps";
export * from "./process-subprocess";
export * from "./process-tools";
export * from "./process-ui";
export * from "./process-wait";
export * from "./sources";
export const HUB_ADMIN_PROCESS_ERRORS = {
  PROCESS_KEY_TAKEN: 409,
  PROCESS_DEF_INVALID: 422,
  PROCESS_DEF_INCOMPLETE: 422,
  PROCESS_REF_INVALID: 422,
  TEMPLATE_READ_ONLY: 403,
  PROCESS_NOT_DELETABLE: 409, // CR-127 · Z7 · chỉ xoá được quy trình công ty còn NHÁP (chưa áp dụng, chưa có lượt chạy) — `details.reason`: applied | has_runs
  FLOW_NODE_FEATURE_OFF: 422, // CR-122 · FR-25 · node của tính năng đã tắt cho công ty
  FLOW_EDGE_MISSING: 422, // CR-122 · N2 · FR-26 · bước sau thiếu trường BẮT BUỘC mà bước trước không có (`details.edges`)
  ...HUB_ADMIN_SUBPROCESS_ERRORS, // CR-125 · «Quy trình con»: không có / gọi vòng / lồng quá sâu
  FLOW_NODE_CONFIG_INVALID: 422, // CR-122 · E5b · cấu hình riêng của node sai (`details.issues[{path,code}]`, path `stages.<i>.executor.args.<khoá>`)
} as const;
export type HubAdminProcessErrorCode = keyof typeof HUB_ADMIN_PROCESS_ERRORS;
export const PROCESS_DEF_PATHS_MAX = 20;
export const PROCESS_REF_KINDS = ["agent", "team", "group", "user", "source", "tool"] as const;
/** `PROCESS_DEF_INVALID` / `PROCESS_DEF_INCOMPLETE`; path dạng `stages.<i>.<trường>`; `rules` (P-b2) cùng chỉ số `paths`. */
export const ProcessDefPathsDetailsSchema = z.strictObject({
  paths: z.array(z.string().min(1)).max(PROCESS_DEF_PATHS_MAX),
  rules: z.array(z.enum(PROCESS_DEF_RULES)).max(PROCESS_DEF_PATHS_MAX).optional(),
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
export { STAGE_KEY_RE }; // khai báo ở chat/processes (một nguồn, TD #150)

const NameSchema = z.string().trim().min(1).max(PROCESS_NAME_MAX);

// ── Nguồn + đầu vào (P-b · HUB-FR-121/124 · PB-R06/R13): `ProcessInput*Schema`/`INPUT_*` ở `./sources` (tránh vòng import)
export const MUST_KNOW_MAX = 10;
export const MUST_KNOW_LEN = 200;

/** P-c1 · HUB-FR-126 · stage tự-sửa mã trong nguồn git (PC-R01): nguồn + lệnh cài/test + allowlist ghi. */
export const StageAutofixSchema = z.strictObject({
  source_key: SourceKeySchema,
  install_cmd: AutofixCmdSchema.nullable().default(null),
  test_cmd: AutofixCmdSchema,
  write_allowlist: AutofixWriteAllowlistSchema.default([]),
});
export type StageAutofix = z.infer<typeof StageAutofixSchema>;

export { type StageEscalate, StageEscalateSchema, StageGroupKeySchema }; // CR-105 · id hoặc mã Group
export const ProcessStageDefSchema = z.strictObject({
  key: z.string().regex(STAGE_KEY_RE),
  name: NameSchema,
  /** P-b2 · bước 0-based; vắng ở MỌI stage ⇒ bước = chỉ số stage (def cũ). */
  step: ProcessStepSchema.optional(),
  executor: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("agent"), agent_id: UuidSchema }),
    z.strictObject({ kind: z.literal("team"), team_id: UuidSchema }),
    /** P-c2 · PC2-R01 · stage "Áp bản sửa" — Hub tự chạy (luật `APPLY_*` ở `applyStageIssues`). */
    z.strictObject({ kind: z.literal("apply") }),
    /** P-d1 · PD-R13 · chờ tới ngày gốc (input `date` / field `date` của stage bước trước) + `offset_days` lúc `time`. */
    WaitUntilExecutorSchema,
    /** P-d2 · PD2-R01 · gọi tool (workflow catalog) — luật `toolStageIssues`. */
    ToolExecutorSchema,
    SetExecutorSchema, // CR-103 · R4 · node `set` (luật `setDefIssues`)
    /** CR-103 · fnr-if · node If (họ control) — luật `ifStageIssues`. */
    IfExecutorSchema,
    /** CR-118 · node `form` (người điền form; luật `formDefIssues`). */
    FormExecutorSchema,
    /** CR-120 · G3/G4 · chờ N giờ / chờ sự kiện (luật `waitNodeIssues`, hub nodes/wait-for · wait-event). */
    WaitForExecutorSchema,
    WaitEventExecutorSchema,
    /** CR-121 D-6 · gửi thông báo rồi xong bước (luật `notifyDefIssues`, hub nodes/notify). */
    NotifyExecutorSchema,
    /** CR-122 · E2b · node Duyệt độc lập (luật `approveStageIssues`, hub nodes/approve). */
    ApproveExecutorSchema,
    /** CR-125 · node «Quy trình con» (luật `subprocessCheck`, hub nodes/subprocess). */
    SubprocessExecutorSchema,
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
    z.strictObject({
      kind: z.literal("review"),
      group_id: UuidSchema.nullable().default(null), // CR-122 · P6 · def Thư viện chỉ có `group_key` ⇒ vắng = null
      /** P-b2 · bước được phép quay lại khi Chưa đạt (< bước của stage, không trùng — luật `BACK_TARGET_INVALID`). */
      back_to_steps: z.array(ProcessStepSchema).max(PROCESS_STEP_MAX).default([]),
      /** P-d1 · PD-R18 · nhắc lặp mỗi N giờ; `null` = nhắc 1 lần sau 24 h như cũ. */
      remind_every_h: z
        .number()
        .int()
        .min(REMIND_EVERY_H.min)
        .max(REMIND_EVERY_H.max)
        .nullable()
        .default(null),
      escalate: StageEscalateSchema.nullable().default(null), // P-d1 · PD-R18/R20 · chuyển cấp sau after_h (1 lần/task)
      /** P-d2 · PD2-R12 · rẽ nhánh sau Đạt (luật `branchStageIssues`). */
      branch: AfterBranchSchema,
      /** N2-FR-05 · người bắt đầu run không được quyết task duyệt của stage này (vắng ở snapshot cũ ⇒ false). */
      exclude_starter: z.boolean().default(false),
      need: z.enum(TASK_NEEDS).optional(), // CR-127 · E1 · Cần: một người nhận việc / trưởng phòng / tất cả (vắng ⇒ suy từ head_only)
      evidence: z.enum(EVIDENCE_MODES).optional(), // CR-127 · E1 · 'opinion' | 'opinion_plus' (vắng ⇒ opinion)
      head_only: z.boolean().optional(), // contract-flow S1b · chỉ trưởng phòng của `group_id` quyết (không trưởng ⇒ cả nhóm)
      parallel: ApproveParallelSchema.optional(), // CR-125 · «A + B cùng duyệt» (bước Duyệt; luật `parallelStageIssues`)
      also_group_ids: z.array(UuidSchema).max(5).optional(), // prod-fix2 · Group cũng quyết (không head_only, chịu exclude_starter)
      approver_user_id: UuidSchema.optional(), // esign-flow · người duyệt cụ thể (cửa như head_only)
      /** CR-139 · kiểu người duyệt; `starter_head` ⇒ engine ghi `approver_user_id` vào snapshot run lúc mở việc (không cần `group_id`). */
      approver_mode: z.enum(APPROVER_MODES).optional(),
      group_key: StageGroupKeySchema.optional(), // CR-105 · def thư viện: Group duyệt theo mã
      also_group_keys: z.array(StageGroupKeySchema).max(5).optional(), // CR-105
    }),
    z.strictObject({ kind: z.literal("auto"), branch: AfterBranchSchema }),
  ]),
  real_action: z.boolean(),
  answerer: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("starter") }),
    AnswererGroupSchema, // CR-105 · id hoặc mã

    z.strictObject({ kind: z.literal("user"), user_id: UuidSchema }),
  ]),
  timeout_s: z
    .number()
    .int()
    .min(STAGE_TIMEOUT_S.min)
    .max(STAGE_TIMEOUT_S_HARD_MAX)
    .default(STAGE_TIMEOUT_S.default),
  token_budget: z.number().int().min(STAGE_TOKEN_BUDGET.min).max(STAGE_TOKEN_BUDGET.max).nullable(),
  sources: z.array(StageSourceSchema).max(STAGE_SOURCES_MAX).default([]),
  must_know: z.array(z.string().trim().min(1).max(MUST_KNOW_LEN)).max(MUST_KNOW_MAX).default([]),
  autofix: StageAutofixSchema.nullable().default(null), // P-c1 · vắng/null = stage thường (snapshot cũ đọc `?? null`)
  ui: StageUiSchema.optional(), // CR-103 · fnr-canvas · vị trí node trên canvas (chỉ UI; engine bỏ qua; vắng ở snapshot cũ)
  slot: z.record(z.string(), z.unknown()).optional(), // CR-105 · pl-slot-shape · mô tả bước của khe (engine bỏ qua)
  // CR-122 · FR-12 `next_step` = bước gộp (> bước mình) · FR-15 `outcome` = node Kết thúc (`flowDefIssues`) · FR-25 `node` = node bảng
  next_step: ProcessStepSchema.optional(),
  outcome: z.string().regex(OUTCOME_KEY_RE).optional(),
  node: z.string().regex(APP_NODE_KEY_RE).optional(),
  start_form: StartFormConfigSchema.optional(), // CR-125 · cấu hình «Bắt đầu bằng phiếu yêu cầu» (node core.start-form, stage đầu)
});
type StageDefParsed = z.infer<typeof ProcessStageDefSchema>;
type StageAfterParsed = StageDefParsed["after"];
/** Kiểu stage def: `autofix` + `after.back_to_steps` OPTIONAL — snapshot def cũ (trước P-b2) và bản nháp FE không có; đọc dùng `?? []`. */
export type ProcessStageDef = Omit<StageDefParsed, "after" | "autofix"> & {
  /** P-c1 · vắng ở snapshot cũ (trước P-c); đọc dùng `?? null`. */
  autofix?: StageAutofix | null;
  after:
    | (Omit<
        Extract<StageAfterParsed, { kind: "review" }>,
        "back_to_steps" | "remind_every_h" | "escalate" | "branch" | "exclude_starter"
      > & {
        /** N2 · vắng ở snapshot cũ; đọc dùng ?? false. */
        exclude_starter?: boolean;
        back_to_steps?: number[];
        /** P-d1 · vắng ở snapshot cũ; đọc dùng `?? null`. */
        remind_every_h?: number | null;
        escalate?: StageEscalate | null;
        /** P-d2 · vắng ở snapshot cũ; đọc dùng `?? []`. */
        branch?: BranchRule[];
      })
    | { kind: "auto"; branch?: BranchRule[] };
};
/** Thay `stages` của kiểu suy từ zod bằng `ProcessStageDef` (back_to_steps optional). */
type WithStageDefs<T extends { stages: unknown }> = Omit<T, "stages"> & {
  stages: ProcessStageDef[];
};

/** Hình dạng thôi (không luật chéo stage) — route dùng cái này + `validateProcessDef` để trả 422 có `paths`. */
export const ProcessDefInputBaseSchema = z.strictObject({
  key: ProcessKeySchema,
  name: NameSchema,
  description: z.string().max(PROCESS_DESC_MAX),
  input_hint: z.string().max(PROCESS_DESC_MAX),
  run_group_ids: z.array(UuidSchema).max(PROCESS_RUN_GROUPS_MAX),
  /** CR-105 · def thư viện: Group được chạy theo mã (def tenant ⇒ vắng/rỗng). */
  run_group_keys: z.array(StageGroupKeySchema).max(PROCESS_RUN_GROUPS_MAX).optional(),
  stages: z.array(ProcessStageDefSchema).min(1).max(PROCESS_STAGES_CEILING),
  token_budget: z.number().int().min(STAGE_TOKEN_BUDGET.min).nullable(),
  enabled: z.boolean(),
  sources: z.array(SourceKeySchema).max(DEF_SOURCES_MAX).default([]),
  inputs: z.array(ProcessInputDefSchema).max(DEF_INPUTS_MAX).default([]),
  /** P-d1 · PD-R24 · vắng = "không gửi" (tạo ⇒ 7, sửa ⇒ giữ); `null` = không hết hạn. */
  ttl_days: TtlDaysSchema.optional(),
  ...LIBRARY_DEF_INPUT_FIELDS, // CR-105 · L2a
});

/** PB-R06 · stage.sources[].source_key phải ∈ def.sources — path `stages.<i>.sources.<j>.source_key` (R-C15/P-02). */
export function processDefSourcePaths(d: {
  sources: readonly string[];
  stages: readonly { sources?: readonly StageSource[]; autofix?: { source_key: string } | null }[];
}): string[] {
  const declared = new Set(d.sources);
  const paths: string[] = [];
  d.stages.forEach((s, i) => {
    (s.sources ?? []).forEach((src, j) => {
      if (!declared.has(src.source_key)) paths.push(`stages.${i}.sources.${j}.source_key`);
    });
    if (s.autofix && !declared.has(s.autofix.source_key))
      paths.push(`stages.${i}.autofix.source_key`);
  });
  return paths;
}

/** Hình dạng + luật chéo stage (R-K08) + tham chiếu nguồn (R-C15). */
export const ProcessDefInputSchema = ProcessDefInputBaseSchema.superRefine((d, ctx) => {
  for (const it of processDefStageIssues(d.stages, { inputs: d.inputs })) {
    ctx.addIssue({ code: "custom", path: it.path.split("."), message: it.rule });
  }
  for (const p of processDefSourcePaths(d)) {
    ctx.addIssue({ code: "custom", path: p.split("."), message: "unknown source_key" });
  }
});
export type ProcessDefInput = WithStageDefs<z.infer<typeof ProcessDefInputBaseSchema>>;

export const ProcessDefSchema = ProcessDefInputBaseSchema.extend({
  id: UuidSchema,
  tenant_id: UuidSchema.nullable(),
  is_template: z.boolean(),
  source_template_id: UuidSchema.nullable(),
  version: z.number().int().min(1),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  /** P-d1 · response luôn có (`null` = không hết hạn). */
  ttl_days: TtlDaysSchema,
  ...LIBRARY_DEF_FIELDS,
});
export type ProcessDef = WithStageDefs<z.infer<typeof ProcessDefSchema>>;

export const UpdateProcessDefRequestSchema = ProcessDefInputBaseSchema.extend({
  version: z.number().int().min(1),
});
export type UpdateProcessDefRequest = WithStageDefs<z.infer<typeof UpdateProcessDefRequestSchema>>;

export const CopyProcessDefRequestSchema = z.strictObject({
  key: ProcessKeySchema.optional(),
  name: NameSchema.optional(),
});
export type CopyProcessDefRequest = z.infer<typeof CopyProcessDefRequestSchema>;

export const RunProcessDefRequestSchema = z.strictObject({
  input: z.string().trim().max(PROCESS_INPUT_MAX),
  inputs: z.array(ProcessInputValueSchema).max(DEF_INPUTS_MAX).optional(),
  /** CR-105 · true ⇒ lượt chạy thử (Showcase / "Mẫu · chạy thử"): `is_test`, ẩn khỏi danh sách lượt mặc định. */
  test: z.boolean().optional(),
});
export type RunProcessDefRequest = z.infer<typeof RunProcessDefRequestSchema>;

export const ProcessDefTenantQuerySchema = z.strictObject({ tenant_id: UuidSchema.optional() });
export const DeleteProcessDefQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  version: z.coerce.number().int().min(1),
});

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

// ── P-d1 · ngữ cảnh editor quy trình (plan-contract §4) — `GET /process-editor/context?tenant_id=` ─────────────────
export const ProcessEditorContextQuerySchema = z.strictObject({ tenant_id: UuidSchema.optional() });
export type ProcessEditorContextQuery = z.infer<typeof ProcessEditorContextQuerySchema>;
export const ProcessEditorContextSchema = z.strictObject({
  /** Múi giờ tenant; def mẫu (tenant null) ⇒ `TENANT_TZ_DEFAULT`. */
  timezone: z.string().min(1).max(64),
  /** P-d2 · catalog tool khả dụng của tenant (def mẫu ⇒ `[]`, A4 G7); ≤ 200 (D2-26). */
  tools: z.array(ProcessToolItemSchema).max(200).optional(),
});
export type ProcessEditorContext = z.infer<typeof ProcessEditorContextSchema>;
