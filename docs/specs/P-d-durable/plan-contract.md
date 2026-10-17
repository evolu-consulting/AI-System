# Plan phụ lục · Contract P-d (backend-lead sở hữu)

Phần của [`plan.md`](plan.md). Luật chung: **chỉ thêm**; enum mới **thêm cuối mảng**; trường mới của view là `.optional()` (FE mock strict không vỡ). Đối chiếu code `packages/contracts/src` tại nhánh `platform/gd0` (2026-10-17). Lớp 3 — domain **không** import các hằng này, tự khai lại ở `P/domain/limits.ts` ([plan-domain §2](plan-domain.md)).

## 1. Hằng + enum P-d1 — `chat/processes.ts` (`hub-admin/processes.ts` re-export qua `export *`)
```ts
// PROCESS_RUN_STATUSES  += "waiting_timer"                 (cuối, 9 phần tử)
// PROCESS_RUN_ACTIVE    += "waiting_timer"                 (cuối, 5) — "chưa kết thúc"
// STAGE_RUN_STATUSES    += "waiting_timer"                 (cuối, 10)
// DECISION_REASONS      += "retry_exhausted", "timer_invalid"   (cuối, 22)
// NOTICE_KINDS          += "escalated"                     (cuối, 7)
// EXECUTOR_KINDS        += "wait_until"                    (cuối, 4)

// ── P-d1 · engine chạy bền [HUB-FR-143…145][HUB-FR-115] (plan-contract §1) ──
/** PD-R16 · trạng thái run TÍNH trần 5 run/tenant (= PROCESS_RUN_ACTIVE trước P-d; khớp predicate `process_runs_active_idx`). */
export const PROCESS_RUN_CAP_COUNTED = ["running", "waiting_review", "waiting_answer", "needs_decision"] as const;
export const STAGE_RETRY_MAX = 3;
export const RETRY_BACKOFF_S = [30, 120, 480] as const;
export const REMIND_EVERY_H = { min: 4, max: 168 } as const;
export const REMIND_MAX = 10;
export const ESCALATE_AFTER_H = { min: 4, max: 2160 } as const;
export const PROCESS_TTL_DAYS = { min: 1, max: 365, default: 7 } as const; // PROCESS_RUN_TTL_DAYS giữ = 7
export const WAIT_OFFSET_DAYS = { min: -365, max: 365 } as const;
export const WAIT_HORIZON_DAYS = 730;
export const WAIT_TIME_DEFAULT = "09:00";
export const WAIT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIMER_KINDS = ["wait_until", "retry"] as const;
export const TIMER_SWEEP_BATCH = 100;
export type TimerKind = (typeof TIMER_KINDS)[number];
/** Ngày lịch có thật (2026-02-30 ⇒ false). Thuần — FE dùng chung. */
export function isIsoCalendarDate(s: string): boolean;   // ISO_DATE_RE ∧ Date.UTC(y,m-1,d) cho lại đúng y/m/d
export const IsoCalendarDateSchema = z.string().regex(ISO_DATE_RE).refine(isIsoCalendarDate, "invalid calendar date");
export const WaitTimeSchema = z.string().regex(WAIT_TIME_RE);
export const TtlDaysSchema = z.number().int().min(PROCESS_TTL_DAYS.min).max(PROCESS_TTL_DAYS.max).nullable();
```
`hub-admin/sources.ts`: `INPUT_TYPES += "date"` (cuối, 5). `ProcessInputValueSchema` thêm biến thể (cuối union):
```ts
z.strictObject({ type: z.literal("date"), key: SourceKeySchema, value: z.string().min(1).max(10) }),
```
Hình dạng ở zod (400 nếu sai kiểu); **ngày lịch** kiểm ở luật domain `startInputIssues` lúc bắt đầu ⇒ `VALIDATION_ERROR` path `inputs.<i>.value` (§7 — mã này là **400** trong contract, xem plan §10 Q1).

## 2. Thực thể / view P-d1 — `chat/processes-entities.ts` (356 → ~380 dòng)
| Schema | Trường mới (đều optional) | Nguồn |
|---|---|---|
| `ProcessRunSummarySchema` | `expires_at: IsoDateTime.nullable().optional()` | `process_runs.expires_at` (PD-R25) |
| `StageViewSchema` | `retry_count: z.number().int().min(0).max(3).optional()` · `next_retry_at: IsoDateTime.optional()` · `last_error_code: z.string().min(1).max(64).optional()` · `wait: z.strictObject({ due_at: IsoDateTime, timezone: z.string().min(1).max(64) }).optional()` | `retry_count` = giá trị **hiệu lực** (`effectiveRetryCount`, plan-domain §4.2); `next_retry_at` = `due_at` hẹn `retry` chưa bắn/huỷ; `wait` = hẹn `wait_until` chưa huỷ + `timezone` lúc lưu (cột `process_timers.timezone`) |
| `HistoryItemSchema.kind` | enum `[...cũ, "escalate"]` (P-d2 + `"branch"`) · `group: z.strictObject({ id: UuidSchema, name: z.string().min(1).max(100) }).optional()` (escalate) · `rule: z.number().int().min(1).max(10).optional()` (P-d2 branch; dùng `to_step` sẵn có) | audit `escalate` / thread `branch` |
| `TaskDetailSchema` | `escalated: z.boolean().optional()` · `remind_count: z.number().int().min(0).max(10).optional()` | `review_tasks.escalated_at IS NOT NULL`, `remind_count` (chỉ kind `review`) |
| `OpenTaskSchema` | `escalated_group: z.strictObject({ id: UuidSchema, name: z.string().min(1).max(100) }).nullable().optional()` | assignee `via='escalated'` |
| `ExecutorRefSchema.kind` | tự mở rộng theo `EXECUTOR_KINDS` | `WAIT_UNTIL_EXECUTOR_REF` (hub `runs/executor-ref.ts`): `{kind:"wait_until", key:"wait_until", name:{vi:"Chờ tới ngày", en:"Wait until date"}}` |

Người xem `task` (HUB-BR-25): `ProcessRunTaskViewSchema` **không** thêm `wait`/`retry`/`group` (chỉ `status` mới hiện qua enum).

## 3. Định nghĩa quy trình P-d1 — `hub-admin/processes.ts`
```ts
// executor: thêm biến thể cuối discriminatedUnion
z.strictObject({
  kind: z.literal("wait_until"),
  from: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("input"), key: SourceKeySchema }),
    z.strictObject({ kind: z.literal("field"), stage_key: z.string().regex(STAGE_KEY_RE), field: z.string().regex(FIELD_KEY_RE) }),
  ]),
  offset_days: z.number().int().min(WAIT_OFFSET_DAYS.min).max(WAIT_OFFSET_DAYS.max),
  time: WaitTimeSchema.default(WAIT_TIME_DEFAULT),
}),
// after.review: thêm 2 trường
remind_every_h: z.number().int().min(REMIND_EVERY_H.min).max(REMIND_EVERY_H.max).nullable().default(null),
escalate: z.strictObject({
  after_h: z.number().int().min(ESCALATE_AFTER_H.min).max(ESCALATE_AFTER_H.max),
  group_id: UuidSchema,
}).nullable().default(null),
// ProcessDefInputBaseSchema: + ttl_days: TtlDaysSchema.optional()   (vắng = "không gửi")
// ProcessDefSchema = Base.extend({ ..., ttl_days: TtlDaysSchema })   (response: luôn có, null = không hết hạn)
// ProcessStageDef (kiểu tay): after.review thêm `remind_every_h?: number | null; escalate?: {after_h:number; group_id:string} | null`
```
- Tạo (`POST /process-defs`) vắng `ttl_days` ⇒ 7; sửa (`PUT /process-defs/:id`, toàn bộ body + `version`) vắng ⇒ **giữ** giá trị hiện có; `copy` chép `ttl_days` của nguồn. Không có export/import def trong code (grep `transfer.ts`, `defs.routes.ts`) ⇒ phần export/import của PD-R24 **N/A** (plan §10 #23).
- `PROCESS_DEF_RULES` (`hub-admin/process-steps.ts`) += `"WAIT_INVALID"`, `"ESCALATE_INVALID"` (cuối, 16). `PROCESS_REF_KINDS` không đổi ở P-d1 (Group chuyển cấp dùng `ref:"group"`, path `stages.<i>.after.escalate.group_id`).
- `processDefStageIssues` (contract, thuần, FE dùng) gọi thêm `waitStageIssues(stages, inputs)` + `escalateStageIssues(stages)` — **cùng điều kiện** với luật domain [plan-domain §4.6–4.7]; path: `stages.<i>.executor` (WAIT_INVALID nguồn/after/real_action/sources/must_know/autofix), `stages.<i>.after.escalate` (ESCALATE_INVALID). Chữ ký mở rộng: `processDefStageIssues(stages, ctx?: { inputs?: readonly {key:string; type:string}[] })` — vắng `ctx` ⇒ bỏ kiểm nguồn input (giữ test khoá cũ).
→ thay bởi plan-addendum A2: path WAIT_INVALID phía contract.
- Hub **ép** khi lưu (`ensureWaitStage`, như `ensureHandoff`): `output = {filename: giữ, template: "# {name}\n\n## Bàn giao\n", required_sections:["Bàn giao"], fields:[]}`, `answerer={kind:"starter"}`, `token_budget=null`, `timeout_s` = mặc định (bỏ qua).

## 4. Endpoint mới P-d1 — ngữ cảnh editor (Hub)
`GET /process-editor/context?tenant_id=` — `requireAdminRole()` như `/process-defs`; phạm vi `defScopeOf` (tenant_admin ⇒ tenant mình; platform_admin ⇒ `tenant_id` hoặc mẫu). Thêm `"/process-editor"` vào `PROCESS_PROTECTED_PREFIXES`.
```ts
export const ProcessEditorContextQuerySchema = z.strictObject({ tenant_id: UuidSchema.optional() });
export const ProcessEditorContextSchema = z.strictObject({
  timezone: z.string().min(1).max(64),                 // tenant null (mẫu) ⇒ TENANT_TZ_DEFAULT
  tools: z.array(ProcessToolItemSchema).max(200).optional(),   // P-d2 (§6); P-d1 không trả
});
```
`tenant_admin` không cần màn tenant (B3). 403 `FORBIDDEN` như `/process-defs`.

## 5. Admin · múi giờ tenant (T6a) — `packages/contracts/src/tenants.ts`
```ts
export const TENANT_TZ_DEFAULT = "Asia/Ho_Chi_Minh";
/** Server (Bun/JSC) là nguồn đúng; KHÔNG dùng ở schema response (danh sách Intl của Chrome khác JSC — plan §10 R3). */
export function isSupportedTimeZone(tz: string): boolean;   // Intl.supportedValuesOf("timeZone").includes(tz) (cache Set)
export const TimezoneSchema = z.string().min(1).max(64);                          // response
export const TimezoneInputSchema = TimezoneSchema.refine(isSupportedTimeZone, "unsupported time zone"); // request
// tenantShape += timezone: TimezoneSchema
// TenantCreateRequestSchema += timezone: TimezoneInputSchema.default(TENANT_TZ_DEFAULT)
// TenantUpdateRequestSchema += timezone: TimezoneInputSchema.optional()
// transfer.ts TenantElSchema += timezone: TimezoneInputSchema.optional()   (import vắng ⇒ giữ / tenant mới ⇒ mặc định, TZ-R05)
```
Sai ⇒ `VALIDATION_ERROR` (400 theo `common.ts:210`) path `timezone`. PATCH lệch `version` ⇒ 409 `VERSION_CONFLICT` như cũ. Audit `tenant/update` before/after có `timezone`; `config_changed {entity:"tenant", tenantId}`.

## 6. Contract P-d2 (T17, T18a)
```ts
// chat/processes.ts
// STAGE_RUN_STATUSES += "skipped" (cuối, 11) · DECISION_REASONS += "tool_failed" (cuối, 23) · EXECUTOR_KINDS += "tool" (cuối, 5)
export const TOOL_ARGS_MAX = 20;
export const TOOL_RESULT_MAX_BYTES = 65_536;
export const BRANCH_RULES_MAX = 10;
export const BRANCH_OPS = ["eq", "ne", "lt", "le", "gt", "ge"] as const;
// chat/room-process.ts: ROOM_PROCESS_KINDS += "branch" (cuối, 8); RoomProcessPartSchema thêm
z.strictObject({ kind: z.literal("branch"), process_run_id: UuidSchema, stage_idx: StageIdxSchema,
  to_step: ProcessStepSchema, rule: z.number().int().min(1).max(BRANCH_RULES_MAX) }),
// StageViewSchema += tool_key: z.string().regex(PROCESS_KEY_RE).optional()
// hub-admin/process-steps.ts: PROCESS_DEF_RULES += "TOOL_INVALID", "TOOL_SIDE_EFFECT", "BRANCH_INVALID" (cuối, 19)
// hub-admin/processes.ts: PROCESS_REF_KINDS += "tool" (cuối, 6)
export const ArgSourceSchema = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("input"), key: SourceKeySchema }),
  z.strictObject({ from: z.literal("field"), stage_key: z.string().regex(STAGE_KEY_RE), field: z.string().regex(FIELD_KEY_RE) }),
  z.strictObject({ from: z.literal("const"), value: z.union([z.string().max(PROCESS_INPUT_MAX), z.number(), z.boolean()]) }),
]);
// executor += z.strictObject({ kind: z.literal("tool"), tool_key: ProcessKeySchema,
//   args: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), ArgSourceSchema)
//     .refine((a) => Object.keys(a).length <= TOOL_ARGS_MAX) })
export const BranchRuleSchema = z.strictObject({
  field: z.string().regex(FIELD_KEY_RE), op: z.enum(BRANCH_OPS),
  value: z.union([z.string().max(200), z.number()]), goto_step: ProcessStepSchema,
});
// after (cả review và auto) += branch: z.array(BranchRuleSchema).max(BRANCH_RULES_MAX).default([])
export const ProcessToolItemSchema = z.strictObject({
  key: ProcessKeySchema, name: z.string().min(1).max(128), description: z.string().max(400),
  side_effect: z.boolean(),
  params: z.array(z.strictObject({ name: z.string().min(1).max(64), type: z.enum(["text","paragraph","select","number","file"]),
    required: z.boolean() })).max(TOOL_ARGS_MAX),
});
```
→ thay bởi plan-addendum A1: khối `params` ở trên (trần, `description`, `options`); plan-addendum A2: `toolStageIssues`/`branchStageIssues`.
`params.type` = kiểu input workflow catalog (`WorkflowInput`); tham số `file` ⇒ tool **không** chọn được trong stage (GĐ1 không truyền file) — `TOOL_INVALID` khi lưu, và catalog vẫn liệt kê để FE hiện "không hỗ trợ".

**Admin · công tắc tool (T18a)** — `packages/contracts/src/workflow-tools.ts` (mới, export ở `index.ts`). Chỉ `platform_admin` (tenant_admin ⇒ 403).
| Route | Body / Query | Response | Lỗi |
|---|---|---|---|
| `GET /admin/tenants/:id/workflow-tools` | — | `{ items: TenantWorkflowTool[] }` (mọi workflow catalog, sắp `key`, ≤ 200) | 404 tenant |
| `PUT /admin/tenants/:id/workflow-tools/:workflow_id` | `{}` (strict) | 200 `TenantWorkflowTool` (đã bật ⇒ không đổi, không audit) | 404 tenant/workflow |
| `DELETE /admin/tenants/:id/workflow-tools/:workflow_id` | — | 200 `TenantWorkflowTool` (`on:false`; đã tắt ⇒ không đổi) | 404 |
```ts
export const TenantWorkflowToolSchema = z.strictObject({
  workflow_id: UuidSchema, key: CatalogKeySchema, name: z.string().min(1).max(128),
  side_effect: z.boolean(), enabled: z.boolean(), on: z.boolean(),
  granted_at: IsoDateTime.nullable(), granted_by: UpdatedBySchema,   // null khi chưa từng bật / đã tắt
});
export const TenantWorkflowToolListSchema = z.strictObject({ items: z.array(TenantWorkflowToolSchema).max(200) });
export const TenantWorkflowToolPutSchema = z.strictObject({});
```
Audit (TT-R03 "workflow_tool.enable/disable"): **dùng enum admin sẵn có** — `entity:"workflow"`, `action:"grant"` (bật) / `"revoke"` (tắt), `tenant_id`=T, `entity_id`=W, `entity_name`=key, `before/after = {on}`. `config_changed {entity:"workflow", tenantId:T}`. (Không thêm `AUDIT_ENTITIES` ⇒ không CHECK admin mới — plan-d2 §1 D2-04.)

## 7. Mã lỗi (không mã HTTP mới)
| Tình huống | Mã · HTTP | details |
|---|---|---|
| Luật def mới (WAIT/ESCALATE/TOOL/TOOL_SIDE_EFFECT/BRANCH) | `PROCESS_DEF_INVALID` 422 | `{paths[], rules[]}` cùng chỉ số |
| Group chuyển cấp không tồn tại / khác tenant; tool không khả dụng / mẫu dùng tool | `PROCESS_REF_INVALID` 422 | `{path, ref:"group"\|"tool"}` |
| Input `date` sai ngày lịch lúc bắt đầu | `VALIDATION_ERROR` **400** | `issues[{path:["inputs",i,"value"]}]` |
| `timezone` sai | `VALIDATION_ERROR` 400 | path `timezone` |
| Quyết `use_current` khi `tool_failed` không output | `NO_OUTPUT` 409 | — |

Map lỗi domain → AppError: [plan-domain §3](plan-domain.md).

## 8. Sự kiện
Không event SSE mới. `process.updated` mang `status` mới (`waiting_timer`, stage `skipped`). Notice `escalated` dùng `ProcessNoticeSchema` sẵn có (payload `{process_name, stage_name}`); DM "Quy trình" như `review_requested`.
