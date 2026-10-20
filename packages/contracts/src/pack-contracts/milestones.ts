// V2-A · BA v2 §2 · §3.1 HD-01/HD-03/HD-04/HD-11 · §5.4: contract zod mốc HĐ (`/pack/contracts/contracts/:id/milestones`,
// `/milestones/:id`) + loại HĐ (Mua/Bán/Giới thiệu) + giai đoạn suy từ mốc. Tiền = số nguyên đồng 0…10¹⁵; SL ≤ 4 chữ số thập phân.
import { z } from "zod";
import { nfcText } from "./fields";
import { IsoDay, LedgerMoney } from "./ledger";

export const CONTRACT_DEALS = ["buy", "sell", "referral"] as const;
export const ContractDealSchema = z.enum(CONTRACT_DEALS);
export type ContractDeal = z.infer<typeof ContractDealSchema>;
export const MILESTONE_KINDS = [
  "delivery",
  "collect",
  "pay",
  "commission",
  "serial",
  "renewal",
  "other",
] as const;
export const MilestoneKindSchema = z.enum(MILESTONE_KINDS);
export const MILESTONE_OWNERS = ["ours", "partner"] as const;
export const MILESTONE_FAULTS = ["partner", "ours", "unknown"] as const;
export const CONTRACT_STAGES = ["not_started", "in_progress", "done"] as const;
export const MILESTONES_MAX = 200;
export const MILESTONE_TITLE_MAX = 200;
export const MILESTONE_QTY_MAX = 99_999_999_999_999;

/** Mã lỗi riêng mốc → HTTP. */
export const MILESTONE_ERRORS = {
  /** Mốc đã xác nhận giữ nguyên (không sửa/xoá) để không đổi điểm đã tính. */
  MILESTONE_CONFIRMED: 409,
  /** SL chỉ cho Giao hàng; số tiền chỉ cho Thu tiền / Thanh toán / Nhận hoa hồng. */
  MILESTONE_INVALID: 422,
} as const;
export type MilestoneErrorCode = keyof typeof MILESTONE_ERRORS;

const qty = z
  .number()
  .min(0)
  .max(MILESTONE_QTY_MAX)
  .refine((v) => Math.round(v * 10_000) === v * 10_000, "tối đa 4 chữ số thập phân");
const title = nfcText(MILESTONE_TITLE_MAX).min(1);

// ---------- vào ----------
export const MilestoneCreateSchema = z.strictObject({
  kind: MilestoneKindSchema,
  title: title.nullish(),
  due_date: IsoDay,
  owner: z.enum(MILESTONE_OWNERS).nullish(),
  qty: qty.nullish(),
  amount: LedgerMoney.nullish(),
});
export type MilestoneCreate = z.infer<typeof MilestoneCreateSchema>;
export const MilestonePatchSchema = z
  .strictObject({
    kind: MilestoneKindSchema.optional(),
    title: title.optional(),
    due_date: IsoDay.optional(),
    owner: z.enum(MILESTONE_OWNERS).optional(),
    qty: qty.nullable().optional(),
    amount: LedgerMoney.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length >= 1, { message: "cần ≥ 1 khoá" });
export type MilestonePatch = z.infer<typeof MilestonePatchSchema>;

// ---------- ra ----------
export const MilestoneSchema = z.strictObject({
  id: z.uuid(),
  contract_id: z.uuid(),
  kind: MilestoneKindSchema,
  title: z.string().min(1).max(MILESTONE_TITLE_MAX),
  seq: z.number().int().min(1),
  due_date: IsoDay,
  owner: z.enum(MILESTONE_OWNERS),
  qty: z.number().nullable(),
  /** Số tiền đã ghi trên mốc (null = để trống). */
  amount: z.number().int().nullable(),
  /** 5.4a: số tiền dùng để tính (trống ⇒ chia đều phần còn lại của giá trị HĐ / hoa hồng cho mốc tiền chính). */
  amount_effective: z.number().int().nullable(),
  status: z.enum(["open", "done", "cancelled"]),
  /** Đã xác nhận (= `status` done) ⇒ không sửa/xoá. */
  confirmed: z.boolean(),
  done_at: IsoDay.nullable(),
  fault: z.enum(MILESTONE_FAULTS).nullable(),
  postponed_to: IsoDay.nullable(),
  source: z.enum(["manual", "ai", "default", "cks"]),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const ContractStageSchema = z.enum(CONTRACT_STAGES);
/** Giai đoạn + bước hiện tại của một HĐ (danh sách: mảng `progress` cạnh `items`, không đổi ListRow đã khoá). */
export const ContractProgressSchema = z.strictObject({
  id: z.uuid(),
  deal: ContractDealSchema.nullable(),
  stage: ContractStageSchema,
  next: z
    .strictObject({
      id: z.uuid(),
      kind: MilestoneKindSchema,
      title: z.string(),
      due_date: IsoDay,
      overdue: z.boolean(),
    })
    .nullable(),
});
export type ContractProgress = z.infer<typeof ContractProgressSchema>;
