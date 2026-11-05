// (Các route này mount ở GỐC hub, KHÔNG có tiền tố /hub-admin.)
// CR-118 §11.2 · luật chọn quy trình theo phòng ban + tập quy trình đã gán cho tenant × khe. Export lại qua `processes.ts`.
// - platform_admin: `PUT|DELETE /tenants/:tid/process-routing/:slot/processes/:defId` (gán / bỏ gán vào tập).
// - platform_admin + tenant_admin CHÍNH tenant: `GET|PUT /tenants/:tid/process-routing/:slot` (thay cả danh sách),
//   `GET /tenants/:tid/process-routing/:slot/processes/:defId` (xem sơ đồ quy trình trong tập gán).
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
  /** Luật lệch hình (luật thường không có điều kiện / > 1 mặc định). */
  ROUTING_RULES_INVALID: 422,
  /** Bỏ gán quy trình đang được luật dùng — `details.rules` = luật bị ảnh hưởng. */
  ROUTING_PROCESS_IN_USE: 409,
} as const;
export type HubAdminRoutingErrorCode = keyof typeof HUB_ADMIN_ROUTING_ERRORS;

/** cr118-route-kind · loại HĐ (= `CONTRACT_DEALS` của pack-contracts: Mua / Bán / Giới thiệu; giữ bản sao để hub-admin không
 *  kéo zod của gói hợp đồng). */
export const ROUTING_CONTRACT_KINDS = ["buy", "sell", "referral"] as const;
export const RoutingContractKindSchema = z.enum(ROUTING_CONTRACT_KINDS);
export type RoutingContractKind = z.infer<typeof RoutingContractKindSchema>;

/** Điều kiện: phòng ban người khởi tạo (gồm phòng ban con) VÀ loại HĐ. Cả hai tuỳ chọn, kết hợp AND; rỗng/vắng = mọi giá trị.
 *  Luật thường cần ≥ 1 điều kiện không rỗng. Khe không có loại HĐ ⇒ bỏ qua `contractKinds`. */
export const RoutingConditionSchema = z.strictObject({
  departmentIds: z.array(UuidSchema).max(ROUTING_DEPTS_MAX).optional(),
  contractKinds: z.array(RoutingContractKindSchema).max(ROUTING_CONTRACT_KINDS.length).optional(),
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
  /** hub-routing-backfill · quy trình chạy khi KHÔNG có luật nào khớp/không có luật: gán cũ của tenant × khe, không có ⇒ mặc
   *  định khe; null = chưa có quy trình. Có thể nằm ngoài `processes` (mặc định khe chưa gán). Vắng ở server cũ. */
  current_def_id: UuidSchema.nullable().optional(),
  current_def_name: z.string().nullable().optional(),
});
export type ProcessRouting = z.infer<typeof ProcessRoutingSchema>;

/**
 * `GET /tenants/:tid/process-routing/:slot/processes/:defId` (platform_admin + tenant_admin CHÍNH tenant; def ∉ tập
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
