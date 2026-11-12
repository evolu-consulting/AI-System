// CR-101 DOC-deals · R1, R5–R10, R37, R40 (API) · X1–X3 · Câu 1, 3, 4: Giao dịch = chứng từ `doc_type = 'deal'` (file tuỳ chọn, có
// nguồn). Lưu là có hiệu lực, sửa trực tiếp qua `PATCH /contracts/:id` (máy ghi lịch sử `GET /contracts/:id/edit-log`), nâng thành HĐ
// `POST /contracts/:id/promote` (multipart: `file` ký + `number`) giữ id/mốc/kho/điểm và khoá ngay. `/transactions*` cũ: GET đọc lớp
// tương thích, ghi ⇒ 410 `USE_CONTRACTS`.
import { z } from "zod";
import { EvidenceInputSchema } from "../chat/evidence";
import { VersionSchema } from "../common";
import { ManualContractRequestSchema } from "./extract";
import { CONTRACT_TEXT_MAX, nfcText } from "./fields";
import { ContractDealSchema } from "./milestones";

export const DEAL_SOURCES = ["invoice", "verbal", "message", "quote", "other"] as const;
export const DealSourceSchema = z.enum(DEAL_SOURCES);
export type DealSource = z.infer<typeof DealSourceSchema>;

export const DEAL_ERRORS = {
  /** `/transactions*` ghi: bảng G1 chỉ đọc — dùng `/contracts` (giao dịch là chứng từ). */
  USE_CONTRACTS: 410,
  /** Thao tác chỉ cho giao dịch (vd nâng) trên chứng từ khác. */
  NOT_A_DEAL: 409,
  /** Nâng thành HĐ thiếu file ký / số HĐ. */
  PROMOTE_NEEDS_FILE: 422,
  PROMOTE_NEEDS_NUMBER: 422,
  /** CR-127 X2 · spec §4.1: đối tác có HĐ DONE còn hiệu lực chứa SP ⇒ phải chọn HĐ/mốc hoặc "Không theo hợp đồng". */
  LINK_REQUIRED: 422,
  /** "Không theo hợp đồng" khi đối tác còn HĐ mở ⇒ phải ghi lý do. */
  LINK_REASON_REQUIRED: 422,
  /** Một giao dịch = một mốc: có dòng sản phẩm ngoài HĐ đã chọn ⇒ tách giao dịch khác. */
  LINK_MIXED: 422,
  /** Gắn mốc cần bằng chứng (BR-52). */
  EVIDENCE_REQUIRED: 422,
  /** Mốc đang do người khác nhận việc xử lý (spec §5.9; X5 nối người giữ). */
  TASK_CLAIMED: 409,
} as const;
export type DealErrorCode = keyof typeof DEAL_ERRORS;

const { direction: _d, deal: _deal, ...manual } = ManualContractRequestSchema.shape;

/**
 * `POST /pack/contracts/contracts/deals` — tạo giao dịch (JSON, không file). Trường như nhập tay (`ManualContractRequestSchema`)
 * + `deal` bắt buộc + `source`. `settled_now` (Câu 4, ô "Đã giao / đã thanh toán ngay"): xác nhận ngay các mốc mặc định khi lưu
 * (giao ⇒ kho chạy theo luật giao hàng; tiền ⇒ đã thu/trả). Hoa hồng chỉ cho Giới thiệu.
 */
/**
 * CR-127 X2 · `link`: `{obligation_id}` = ghi THẲNG vào mốc của HĐ (không tạo chứng từ giao dịch, `recordFulfillment`); `{none:{reason}}` =
 * "Không theo hợp đồng" ⇒ chứng từ giao dịch như cũ + lý do (bắt buộc khi đối tác còn HĐ mở). Vắng = như cũ khi đối tác không có HĐ
 * đang hiệu lực chứa SP; ngược lại 422 `LINK_REQUIRED`.
 */
export const DEAL_LINK_REASON_MAX = 1000;
export const DealLinkSchema = z.union([
  z.strictObject({ obligation_id: z.uuid() }),
  z.strictObject({ none: z.strictObject({ reason: z.string().max(DEAL_LINK_REASON_MAX) }) }),
]);
export type DealLink = z.infer<typeof DealLinkSchema>;

export const DealCreateRequestSchema = z
  .strictObject({
    ...manual,
    deal: ContractDealSchema,
    source: DealSourceSchema,
    settled_now: z.boolean().optional(),
    link: DealLinkSchema.optional(),
    /** Bằng chứng khi gắn mốc (bắt buộc với `link.obligation_id`). */
    evidence: EvidenceInputSchema.optional(),
  })
  .refine(
    (b) => b.deal === "referral" || (b.commission_pct == null && b.commission_fixed == null),
    { message: "hoa hồng chỉ cho giao dịch Giới thiệu", path: ["commission_pct"] },
  )
  .refine((b) => !(b.commission_pct != null && b.commission_fixed != null), {
    message: "hoa hồng: % hoặc cố định",
    path: ["commission_fixed"],
  });
export type DealCreateRequest = z.infer<typeof DealCreateRequestSchema>;

export const DealCreateResponseSchema = z.strictObject({
  /** CR-127 X2: `posted` + `deal_id` (= `id`) khi tạo chứng từ giao dịch. */
  state: z.literal("posted").optional(),
  deal_id: z.uuid().optional(),
  id: z.uuid(),
  doc_type: z.literal("deal"),
  status: z.literal("done"),
  version: VersionSchema,
  /** Mốc đã xác nhận ngay khi lưu (`settled_now`). */
  settled: z.array(z.uuid()),
  /** Giao dịch ĐÃ lưu nhưng xác nhận ngay dừng ở một mốc (vd vượt tồn khi công tắc tắt) ⇒ mã lỗi; mốc còn lại để mở. */
  settle_error: z.string().nullable(),
});
export type DealCreateResponse = z.infer<typeof DealCreateResponseSchema>;

/**
 * Gắn mốc: `posted` ⇒ đã ghi vào mốc (`obligation_id`, hàng con nếu làm thiếu); `pending` ⇒ có quy trình "Giao dịch lớn" khớp, yêu cầu
 * chờ duyệt (`request_id`) — kho/công nợ chỉ đổi khi duyệt. UI "Đang kiểm duyệt…", không poll (R#30).
 */
export const DealLinkedResponseSchema = z.strictObject({
  state: z.enum(["posted", "pending"]),
  obligation_id: z.uuid(),
  child_obligation_id: z.uuid().nullable().optional(),
  request_id: z.uuid().optional(),
});
export type DealLinkedResponse = z.infer<typeof DealLinkedResponseSchema>;

/** `GET /pack/contracts/open-milestones` — mốc mở của HĐ DONE còn hiệu lực (không tạm khoá, không bản thay thế) của một đối tác. */
export const OpenMilestonesQuerySchema = z.strictObject({
  party_key: z.string().min(1).max(500),
  product_id: z.uuid().optional(),
  /** Hướng của HĐ: `sale` (bán) | `purchase` (mua/nhập). */
  direction: z.enum(["sale", "purchase"]),
});
export type OpenMilestonesQuery = z.infer<typeof OpenMilestonesQuerySchema>;
export const OpenMilestoneSchema = z.strictObject({
  contract_id: z.uuid(),
  contract_name: z.string(),
  obligation_id: z.uuid(),
  kind: z.string(),
  title: z.string().nullable(),
  due_date: z.string(),
  /** Phần còn lại: mốc giao = Σ SL kế hoạch chưa giao; mốc tiền = số tiền của mốc (null = chưa có số). */
  remaining: z.string().nullable(),
});
export type OpenMilestone = z.infer<typeof OpenMilestoneSchema>;
export const OpenMilestonesResponseSchema = z.array(OpenMilestoneSchema).max(500);

/** Trường chữ của multipart `POST /contracts/:id/promote` (kèm `file` bắt buộc). */
export const PromoteFormSchema = z.strictObject({
  number: nfcText(CONTRACT_TEXT_MAX).min(1),
});
export type PromoteForm = z.infer<typeof PromoteFormSchema>;
export const PromoteResponseSchema = z.strictObject({
  id: z.uuid(),
  doc_type: z.literal("contract"),
  /** CR-127 K1b: nâng giao dịch = `created_done` — HĐ DONE + khoá ngay (không còn nhánh mở lượt duyệt). */
  status: z.literal("done"),
  locked: z.boolean(),
  version: VersionSchema,
  file_id: z.uuid(),
});
export type PromoteResponse = z.infer<typeof PromoteResponseSchema>;

export const EDIT_LOG_MAX = 500;
export const EditLogEntrySchema = z.strictObject({
  id: z.string(),
  at: z.string(),
  actor_user_id: z.uuid().nullable(),
  /** `fields.<khoá>` hoặc cột chứng từ (`title`, `source`, `doc_type`, `file_id`, …). */
  field: z.string(),
  old_value: z.unknown(),
  new_value: z.unknown(),
});
export type EditLogEntry = z.infer<typeof EditLogEntrySchema>;
/** `GET /contracts/:id/edit-log` — mới nhất trước, tối đa `EDIT_LOG_MAX`. */
export const EditLogResponseSchema = z.strictObject({
  items: z.array(EditLogEntrySchema).max(EDIT_LOG_MAX),
});
export type EditLogResponse = z.infer<typeof EditLogResponseSchema>;
