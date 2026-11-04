// CR-118 §11.2 · luật chọn quy trình theo phòng ban + tập quy trình đã gán cho tenant × khe. Export lại qua `processes.ts`.
// - platform_admin: `PUT|DELETE /hub-admin/tenants/:tid/process-routing/:slot/processes/:defId` (gán / bỏ gán vào tập).
// - platform_admin + tenant_admin CHÍNH tenant: `GET|PUT /hub-admin/tenants/:tid/process-routing/:slot` (thay cả danh sách),
//   `GET /hub-admin/tenants/:tid/process-routing/:slot/processes/:defId` (xem sơ đồ quy trình trong tập gán).
import { z } from "zod";
import { UuidSchema } from "../common";
import { SlotKeySchema } from "./process-library";

/** ≤ 50 luật mỗi tenant × khe (CHECK `process_routing_rules_prio_ck` 0..49, hub 0087). */
export const ROUTING_RULES_MAX = 50;
/** ≤ 100 phòng ban mỗi luật. */
export const ROUTING_DEPTS_MAX = 100;

export const HUB_ADMIN_ROUTING_ERRORS = {
  /** Quy trình chưa được platform gán cho tenant × khe. */
  ROUTING_PROCESS_NOT_ASSIGNED: 422,
  /** Quy trình trong tập gán nhưng đã bị xoá / chưa xuất bản — không chọn được cho luật. */
  ROUTING_PROCESS_UNAVAILABLE: 422,
  /** Phòng ban không thuộc tenant. */
  ROUTING_DEPARTMENT_INVALID: 422,
  /** Luật lệch hình (luật thường không có phòng ban / > 1 mặc định). */
  ROUTING_RULES_INVALID: 422,
  /** Bỏ gán quy trình đang được luật dùng — `details.rules` = luật bị ảnh hưởng. */
  ROUTING_PROCESS_IN_USE: 409,
} as const;
export type HubAdminRoutingErrorCode = keyof typeof HUB_ADMIN_ROUTING_ERRORS;

/** Điều kiện bản đầu: phòng ban người khởi tạo (gồm phòng ban con). Mở rộng sau theo cùng cấu trúc. */
export const RoutingConditionSchema = z.strictObject({
  departmentIds: z.array(UuidSchema).max(ROUTING_DEPTS_MAX).optional(),
});
export type RoutingCondition = z.infer<typeof RoutingConditionSchema>;

export const ProcessRoutingRuleInputSchema = z.strictObject({
  condition: RoutingConditionSchema,
  def_id: UuidSchema,
  is_default: z.boolean().default(false),
});
export type ProcessRoutingRuleInput = z.infer<typeof ProcessRoutingRuleInputSchema>;

/** PUT: thứ tự mảng = priority (0 = xét trước). `version` = version đọc ở GET (0 = chưa có luật) — lệch ⇒ 409. */
export const PutProcessRoutingRequestSchema = z.strictObject({
  version: z.number().int().min(0),
  rules: z.array(ProcessRoutingRuleInputSchema).max(ROUTING_RULES_MAX),
});
export type PutProcessRoutingRequest = z.infer<typeof PutProcessRoutingRequestSchema>;

export const ProcessRoutingRuleSchema = z.strictObject({
  id: UuidSchema,
  priority: z.number().int().min(0),
  condition: RoutingConditionSchema,
  def_id: UuidSchema,
  is_default: z.boolean(),
  /** cr118-routing-deleted · quy trình của luật không chạy được: `deleted` (def bị xoá mềm / bỏ khỏi tập) hoặc `unpublished`
   *  (chưa có bản xuất bản) ⇒ người khớp luật bị chặn khởi tạo. Vắng = chạy được. */
  unavailable: z.enum(["deleted", "unpublished"]).optional(),
});
export type ProcessRoutingRule = z.infer<typeof ProcessRoutingRuleSchema>;

/** Quy trình đã gán cho tenant × khe (chỉ chọn được trong số này). */
export const AssignedProcessSchema = z.strictObject({
  def_id: UuidSchema,
  name: z.string(),
  rel_version: z.number().int().min(1).nullable(),
});
export type AssignedProcess = z.infer<typeof AssignedProcessSchema>;

/** GET/PUT response. `version` 0 = chưa có luật (launch chạy đường gán/mặc định khe như cũ). */
export const ProcessRoutingSchema = z.strictObject({
  slot: SlotKeySchema,
  version: z.number().int().min(0),
  rules: z.array(ProcessRoutingRuleSchema),
  processes: z.array(AssignedProcessSchema),
});
export type ProcessRouting = z.infer<typeof ProcessRoutingSchema>;

/**
 * `GET /hub-admin/tenants/:tid/process-routing/:slot/processes/:defId` (platform_admin + tenant_admin CHÍNH tenant; def ∉ tập
 * gán / tenant khác ⇒ 404) — sơ đồ cho `@ai/flow-canvas` chế độ xem. `stages`/`slot_body` cùng hình `ProcessDef` (thư viện),
 * lấy từ bản xuất bản đang dùng. Def đã xoá ⇒ 404. Chưa xuất bản: tenant_admin ⇒ 404 (không lộ nháp của platform);
 * platform_admin ⇒ nháp (`rel_version` null).
 */
export const ProcessRoutingDefViewSchema = z.strictObject({
  def_id: UuidSchema,
  slot: SlotKeySchema,
  name: z.string(),
  rel_version: z.number().int().min(1).nullable(),
  stages: z.array(z.unknown()),
  slot_body: z.unknown(),
});
export type ProcessRoutingDefView = z.infer<typeof ProcessRoutingDefViewSchema>;

/** `ROUTING_PROCESS_IN_USE` details. */
export const RoutingProcessInUseDetailsSchema = z.strictObject({
  rules: z.array(z.strictObject({ id: UuidSchema, priority: z.number().int() })),
});
