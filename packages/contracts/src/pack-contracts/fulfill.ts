// CR-127 · X1 · spec §4.1 `POST /obligations/:id/fulfill`, §6 `recordFulfillment` · BR-41, BR-45, BR-46, BR-50…54: MỘT đường ghi
// "đã giao / đã thu / đã trả" của HĐ vào mốc (`contracts.obligations`). Làm thiếu ⇒ mốc gốc đóng với số thật + hàng con phần còn lại
// (`keep` giữ hạn cũ, `split` hạn mới); vượt phần còn lại ⇒ `OVER_PLAN`; HĐ tạm khoá ⇒ chỉ ghi được tiền thu. Câu VI: tasks §9.
import { z } from "zod";
import { EvidenceInputSchema } from "../chat/evidence";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const Day = z.string().regex(ISO_DAY, "invalid date");
/** SL dạng thập phân ≤ 4 chữ số lẻ (`numeric(18,4)`), > 0. */
const Qty = z.union([z.number().positive().max(1e14), z.string().regex(/^\d{1,14}(\.\d{1,4})?$/)]);

export const FULFILL_TITLE_MAX = 300;
export const FULFILL_ITEMS_MAX = 200;

export const FulfillRemainderSchema = z.union([
  z.literal("keep"),
  z.strictObject({
    split: z.strictObject({
      due_date: Day,
      title: z.string().trim().min(1).max(FULFILL_TITLE_MAX).optional(),
    }),
  }),
]);
export type FulfillRemainder = z.infer<typeof FulfillRemainderSchema>;

export const FulfillRequestSchema = z.strictObject({
  at: Day.nullish(),
  /** Số tiền thật (đồng); vắng ⇒ đủ số của mốc. */
  amount: z.number().int().min(0).max(1_000_000_000_000_000).nullish(),
  /** SL thật từng dòng HĐ (mốc giao); vắng ⇒ đủ phần còn lại của mốc. Dòng không ghi ⇒ 0. */
  qty_items: z
    .array(z.strictObject({ contract_item_id: z.uuid(), qty: Qty }))
    .max(FULFILL_ITEMS_MAX)
    .nullish(),
  fault: z.enum(["partner", "ours", "unknown"]).nullish(),
  /** Làm thiếu: `keep` (mặc định) = hàng con giữ hạn cũ; `split` = hàng con hạn mới. */
  remainder: FulfillRemainderSchema.nullish(),
  evidence: EvidenceInputSchema,
});
export type FulfillRequest = z.infer<typeof FulfillRequestSchema>;

/** Mã lỗi thêm của đường ghi thực hiện (HTTP theo spec §4). */
export const FULFILL_ERRORS = {
  CONTRACT_ON_HOLD: 409,
  OVER_PLAN: 422,
  OBLIGATION_CLOSED: 409,
  CHANGE_PENDING: 409,
  /** CR-127 X5 · spec §5.9: mốc có việc «Xác nhận mốc» đã có người nhận (người khác ghi) / chưa ai nhận (thành viên nhóm phải Nhận việc trước).
   *  SG1: `details` của `TASK_CLAIMED` = `{ by, by_name }` (id + tên hiển thị người đang giữ việc). */
  TASK_CLAIMED: 409,
  TASK_NOT_CLAIMED: 409,
} as const;
export type FulfillErrorCode = keyof typeof FULFILL_ERRORS;

/** Kết quả: mốc vừa ghi (đã đóng với số thật) + hàng con phần còn lại (nếu làm thiếu). */
export type FulfillOut<O> = { obligation: O; child: O | null };
