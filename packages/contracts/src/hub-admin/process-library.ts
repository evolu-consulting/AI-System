// CR-105 · L2a · thư viện quy trình (design §4; readiness Cao: schema response ở contracts). Mở rộng `/process-defs…` (không tiền tố
// `/process-library`) + `/process-slots` + `/tenants/:tid/process-slots/:slot` — chỉ platform_admin. Export lại qua `processes.ts`.
import { z } from "zod";
import {
  PROCESS_LIST_LIMIT,
  PROCESS_NAME_MAX,
  PROCESS_STAGES_MAX,
  ProcessKeySchema,
} from "../chat/processes";
import { CountSchema, IsoDateTime, UuidSchema } from "../common";

/** `<gói>.<việc>` — khớp CHECK `process_slots_slot_ck` (hub 0068). */
export const SLOT_KEY_RE = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;
export const SlotKeySchema = z.string().regex(SLOT_KEY_RE);
/** `GET /process-defs?kind=`: `library` = def thư viện (có khe, chỉ platform_admin); `template` = mẫu toàn nền tảng; `sample` = "Mẫu · chạy thử" (mẫu + def tenant không khe, không của gói). */
export const PROCESS_DEF_KINDS = ["library", "template", "sample"] as const;
export const ProcessDefKindSchema = z.enum(PROCESS_DEF_KINDS);

/** Trường thêm vào body ghi def (nháp thư viện): `slot_body` thắng `stages` (Hub biên dịch lại). */
export const LIBRARY_DEF_INPUT_FIELDS = {
  slot: SlotKeySchema.nullable().optional(),
  slot_body: z.unknown().optional(),
};
/** Trường thêm vào `ProcessDef` / mục danh sách (vắng ở def tenant/mẫu cũ). `tenant_count` = số tenant đang GÁN. */
export const LIBRARY_DEF_FIELDS = {
  slot_label: z.string().nullable().optional(),
  published_version: z.number().int().min(1).nullable().optional(),
  is_default: z.boolean().optional(),
  tenant_count: CountSchema.optional(),
};
export const LIBRARY_LIST_ITEM_FIELDS = {
  slot: SlotKeySchema.nullable().optional(),
  ...LIBRARY_DEF_FIELDS,
};

export const HUB_ADMIN_LIBRARY_ERRORS = {
  /** Def đang gán hoặc là mặc định: xoá / tắt / đổi key / đổi khe. */
  PROCESS_IN_USE: 409,
  PROCESS_NOT_PUBLISHED: 422,
  /** B2: thiếu nút hệ thống / bước không tới được / luật khe. */
  PROCESS_PUBLISH_INVALID: 422,
  SLOT_GROUPS_MISSING: 422,
  SLOT_UNKNOWN: 422,
  SLOT_BODY_INVALID: 422,
  SLOT_SHAPE_UNSUPPORTED: 422,
} as const;
export type HubAdminLibraryErrorCode = keyof typeof HUB_ADMIN_LIBRARY_ERRORS;

export const SlotIssueSchema = z.strictObject({ path: z.string(), rule: z.string() });
/** `SLOT_BODY_INVALID` / `PROCESS_PUBLISH_INVALID`. */
export const SlotIssuesDetailsSchema = z.strictObject({ issues: z.array(SlotIssueSchema).max(20) });
/** `SLOT_GROUPS_MISSING`: tenant đầu tiên (mã tenant) thiếu Group theo mã. */
export const SlotGroupsMissingDetailsSchema = z.strictObject({
  tenant: z.string(),
  tenant_id: UuidSchema,
  keys: z.array(z.string()),
});
export const ProcessInUseDetailsSchema = z.strictObject({
  tenant_count: CountSchema,
  is_default: z.boolean(),
});

export const PublishProcessDefRequestSchema = z.strictObject({
  version: z.number().int().min(1),
  note: z.string().trim().max(500).optional(),
});
export const RollbackProcessDefRequestSchema = z.strictObject({
  rel_version: z.number().int().min(1),
  /** Khoá lạc quan nháp (bắt buộc như publish: hai lần quay lại đồng thời ⇒ một 409). */
  version: z.number().int().min(1),
});
export const ReleaseRefSchema = z.strictObject({ rel_version: z.number().int().min(1) });
export type ReleaseRef = z.infer<typeof ReleaseRefSchema>;

/** B5 · tác động khi xuất bản: tenant đang dùng (gán + mặc định ⇒ tenant bật gói chưa gán) và lượt đang chạy của họ. */
export const ProcessImpactSchema = z.strictObject({
  tenant_count: CountSchema,
  active_runs: CountSchema,
  is_default: z.boolean(),
});
export type ProcessImpact = z.infer<typeof ProcessImpactSchema>;

export const ProcessReleaseSchema = z.strictObject({
  rel_version: z.number().int().min(1),
  name: z.string(),
  published_at: IsoDateTime,
  published_by: UuidSchema.nullable(),
  note: z.string().nullable(),
});
export type ProcessRelease = z.infer<typeof ProcessReleaseSchema>;
export const ProcessReleaseListSchema = z.strictObject({ items: z.array(ProcessReleaseSchema) });
export const ProcessReleaseDetailSchema = ProcessReleaseSchema.extend({
  stages: z.array(z.unknown()),
  slot_body: z.unknown(),
});
export type ProcessReleaseDetail = z.infer<typeof ProcessReleaseDetailSchema>;

export const ProcessAssignmentSchema = z.strictObject({
  tenant_id: UuidSchema,
  tenant_name: z.string(),
  tenant_key: z.string(),
  assigned_at: IsoDateTime,
});
export type ProcessAssignment = z.infer<typeof ProcessAssignmentSchema>;
export const ProcessAssignmentListSchema = z.strictObject({
  items: z.array(ProcessAssignmentSchema),
});

export const ProcessSlotSchema = z.strictObject({
  slot: SlotKeySchema,
  label: z.string(),
  default_def_id: UuidSchema.nullable(),
  default_def_name: z.string().nullable(),
  /** Mã Group đã thấy ở các tenant (gợi ý cho Form), tối đa 200. */
  group_keys: z.array(z.strictObject({ key: z.string() })),
});
export type ProcessSlot = z.infer<typeof ProcessSlotSchema>;
export const ProcessSlotListSchema = z.strictObject({ items: z.array(ProcessSlotSchema) });
export const SetSlotDefaultRequestSchema = z.strictObject({ def_id: UuidSchema });
export const AssignSlotRequestSchema = z.strictObject({ def_id: UuidSchema });

/** Khe của một tenant: def đang chạy (gán, không có ⇒ mặc định) + bản xuất bản. */
export const TenantProcessSlotSchema = z.strictObject({
  slot: SlotKeySchema,
  label: z.string(),
  def_id: UuidSchema.nullable(),
  def_name: z.string().nullable(),
  rel_version: z.number().int().min(1).nullable(),
  is_default: z.boolean(),
});
export type TenantProcessSlot = z.infer<typeof TenantProcessSlotSchema>;
export const TenantProcessSlotListSchema = z.strictObject({
  items: z.array(TenantProcessSlotSchema),
});

// Danh sách def (GET /process-defs) — chuyển từ processes.ts (trần 400 dòng); export lại qua processes.ts.
export const ProcessDefListQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  kind: ProcessDefKindSchema.optional(),
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
  ...LIBRARY_LIST_ITEM_FIELDS,
});
export type ProcessDefListItem = z.infer<typeof ProcessDefListItemSchema>;
export const ProcessDefListResponseSchema = z.strictObject({
  items: z.array(ProcessDefListItemSchema).max(PROCESS_LIST_LIMIT.max),
  next_cursor: z.string().nullable(),
});
export type ProcessDefListResponse = z.infer<typeof ProcessDefListResponseSchema>;
