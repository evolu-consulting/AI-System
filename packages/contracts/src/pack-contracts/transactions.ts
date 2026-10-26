// CR-097 G1 · GD-FR-01…05 · intake 2026-10-23 R9, R10, R27–R32: Giao dịch nhập tay (`/pack/contracts/transactions`). Nháp sửa/xoá tự
// do → ghi sổ (sinh nghĩa vụ thanh toán + ghi kho theo luật giao hàng HĐ) → mô tả sửa trực tiếp · số liệu = điều chỉnh có lý do (bản
// cũ giữ) · huỷ có lý do (hoàn kho + huỷ nghĩa vụ mở, không xoá). Tiền = số nguyên đồng chưa VAT; SL = chuỗi thập phân ≤ 4 số lẻ.
import { z } from "zod";

export const TRANSACTION_ERRORS = {
  /** Thao tác không hợp trạng thái (vd sửa giao dịch đã ghi sổ, huỷ nháp, đã huỷ). */
  TRANSACTION_STATE: 409,
  /** Kho không đủ để xuất / không đảo được (hàng nhập đã bán nơi khác). */
  TRANSACTION_STOCK: 409,
  /** Dòng/SP/thành phần/hạn gói sai luật. */
  TRANSACTION_INVALID: 422,
} as const;
export type TransactionErrorCode = keyof typeof TRANSACTION_ERRORS;

export const TRANSACTION_DEALS = ["buy", "sell"] as const;
export const TRANSACTION_STATUSES = ["draft", "posted", "cancelled"] as const;
export const TRANSACTION_EVENT_TYPES = [
  "created",
  "edited",
  "posted",
  "described",
  "adjusted",
  "cancelled",
] as const;
export const TRANSACTION_LINES_MAX = 200;
export const TRANSACTION_PAGE_MAX = 100;

const Money = z.number().int().min(0).max(1_000_000_000_000_000);
const Qty = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/);
const Day = z.iso.date();
const Text = (max: number) => z.string().trim().max(max);
const Reason = z.string().trim().min(3).max(500);

export const TransactionLineInSchema = z.strictObject({
  name: z.string().trim().min(1).max(300),
  product_id: z.uuid().nullish(),
  /** Thành phần đã chọn của SP (vắng ⇒ mọi thành phần của SP, như dòng HĐ). */
  component_ids: z.array(z.uuid()).min(1).max(20).nullish(),
  unit: Text(40).nullish(),
  qty: Qty,
  unit_price: Money,
});
export type TransactionLineIn = z.infer<typeof TransactionLineInSchema>;

const Describe = {
  note: Text(2000).nullish(),
  /** Người giữ (hàng/chứng từ). */
  holder: Text(200).nullish(),
  /** Nhãn lô. */
  lot_label: Text(200).nullish(),
};

const DraftShape = {
  deal: z.enum(TRANSACTION_DEALS),
  occurred_on: Day,
  /** Hạn thanh toán (vắng ⇒ ngày phát sinh). */
  due_on: Day.nullish(),
  /** Hạn gói (bắt buộc khi mua SP gói suất có hạn). */
  valid_until: Day.nullish(),
  partner_name: z.string().trim().min(1).max(300),
  partner_tax_id: Text(20).nullish(),
  product_group: z.enum(["service", "goods"]).nullish(),
  /** GD-FR-01: liên kết tuỳ chọn tới một HĐ (phải thấy được). */
  contract_id: z.uuid().nullish(),
  ...Describe,
  lines: z.array(TransactionLineInSchema).max(TRANSACTION_LINES_MAX),
};
/** `POST /transactions` — tạo nháp. */
export const TransactionDraftSchema = z.strictObject(DraftShape);
export type TransactionDraft = z.infer<typeof TransactionDraftSchema>;
/** `PATCH /transactions/:id` — sửa nháp (có `lines` ⇒ thay toàn bộ dòng). */
export const TransactionDraftPatchSchema = z
  .strictObject(DraftShape)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");
export type TransactionDraftPatch = z.infer<typeof TransactionDraftPatchSchema>;
/** `PATCH /transactions/:id/describe` — GD-FR-03 mô tả sau ghi sổ (sửa trực tiếp, có vết). */
export const TransactionDescribeSchema = z
  .strictObject(Describe)
  .refine((v) => Object.keys(v).length > 0, "empty");
export type TransactionDescribe = z.infer<typeof TransactionDescribeSchema>;
/** `POST /transactions/:id/adjust` — GD-FR-04 điều chỉnh số liệu: lý do bắt buộc; dòng mới thay bản hiện hành (bản cũ giữ). */
export const TransactionAdjustSchema = z.strictObject({
  reason: Reason,
  occurred_on: Day.optional(),
  due_on: Day.nullish(),
  valid_until: Day.nullish(),
  product_group: z.enum(["service", "goods"]).nullish(),
  lines: z.array(TransactionLineInSchema).max(TRANSACTION_LINES_MAX),
});
export type TransactionAdjust = z.infer<typeof TransactionAdjustSchema>;
/** `POST /transactions/:id/cancel` — GD-FR-05 huỷ có lý do. */
export const TransactionCancelSchema = z.strictObject({ reason: Reason });
export type TransactionCancel = z.infer<typeof TransactionCancelSchema>;

export const TransactionListQuerySchema = z.object({
  status: z.enum(TRANSACTION_STATUSES).optional(),
  deal: z.enum(TRANSACTION_DEALS).optional(),
  /** Tìm theo tên đối tác (không dấu, chứa). */
  q: z.string().trim().min(1).max(100).optional(),
  contract_id: z.uuid().optional(),
  from: Day.optional(),
  to: Day.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(TRANSACTION_PAGE_MAX).default(50),
});
export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;

export const TransactionSummarySchema = z.object({
  id: z.uuid(),
  deal: z.enum(TRANSACTION_DEALS),
  status: z.enum(TRANSACTION_STATUSES),
  rev: z.number().int(),
  occurred_on: Day,
  due_on: Day.nullable(),
  partner_name: z.string(),
  party_key: z.string().nullable(),
  contract_id: z.uuid().nullable(),
  total: z.number().int(),
  lot_label: z.string().nullable(),
  updated_at: z.string(),
});
export type TransactionSummary = z.infer<typeof TransactionSummarySchema>;

export const TransactionListOutSchema = z.object({
  items: z.array(TransactionSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type TransactionListOut = z.infer<typeof TransactionListOutSchema>;

export const TransactionLineOutSchema = z.object({
  id: z.uuid(),
  ord: z.number().int(),
  name: z.string(),
  product_id: z.uuid().nullable(),
  component_ids: z.array(z.uuid()).nullable(),
  unit: z.string().nullable(),
  qty: z.string(),
  unit_price: z.number().int(),
  amount: z.number().int(),
});
export type TransactionLineOut = z.infer<typeof TransactionLineOutSchema>;

export const TransactionEventOutSchema = z.object({
  id: z.string(),
  type: z.enum(TRANSACTION_EVENT_TYPES),
  actor_user_id: z.uuid().nullable(),
  reason: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type TransactionEventOut = z.infer<typeof TransactionEventOutSchema>;

export const TransactionObligationOutSchema = z.object({
  id: z.uuid(),
  direction: z.enum(["receive", "pay"]),
  seq: z.number().int(),
  due_date: Day,
  amount: z.number().int().nullable(),
  status: z.string(),
  cancel_reason: z.string().nullable(),
});

export const TransactionDetailSchema = TransactionSummarySchema.extend({
  valid_until: Day.nullable(),
  partner_tax_id: z.string().nullable(),
  product_group: z.enum(["service", "goods"]).nullable(),
  note: z.string().nullable(),
  holder: z.string().nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  posted_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  /** Dòng của bản hiện hành (`rev`). */
  lines: z.array(TransactionLineOutSchema),
  obligations: z.array(TransactionObligationOutSchema),
  events: z.array(TransactionEventOutSchema),
});
export type TransactionDetail = z.infer<typeof TransactionDetailSchema>;

/** Kho trước → sau của một thành phần (ghi sổ / điều chỉnh / huỷ). */
export const TransactionStockChangeSchema = z.object({
  component_id: z.uuid(),
  on_hand_before: z.string(),
  on_hand_after: z.string(),
  avg_cost_before: z.number().int(),
  avg_cost_after: z.number().int(),
});
export const TransactionActionOutSchema = z.object({
  transaction: TransactionDetailSchema,
  stock: z.array(TransactionStockChangeSchema),
  /** Số dòng sổ kho đã đảo (điều chỉnh / huỷ). */
  stock_reversed: z.number().int(),
});
export type TransactionActionOut = z.infer<typeof TransactionActionOutSchema>;
