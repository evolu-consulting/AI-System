// MS-impact · CR-101b (R18, R19, R34; Câu 11): xem trước tác động THẬT khi xác nhận một mốc — `GET /pack/contracts/obligations/:id/impact
// ?fault=&actual_on=` (chỉ đọc, không ghi): điểm uy tín theo engine hiện hành (trước → sau), kho (trước → sau theo thành phần), công nợ
// (còn phải thu/trả của HĐ trước → sau). Delta thật lưu trên dòng sổ khi xác nhận; mốc đọc lại `rep_delta`.
import { z } from "zod";
import { IsoDay } from "./ledger";
import { REP_LEVELS } from "./reputation";

export const IMPACT_FAULTS = ["partner", "ours", "unknown"] as const;
export const ObligationImpactQuerySchema = z.strictObject({
  fault: z.enum(IMPACT_FAULTS).optional(),
  actual_on: IsoDay.optional(),
});
export type ObligationImpactQuery = z.infer<typeof ObligationImpactQuerySchema>;

export const RepPointSchema = z.strictObject({
  score: z.number().int().nullable(),
  level: z.enum(REP_LEVELS),
});
export type RepPoint = z.infer<typeof RepPointSchema>;

/** Delta uy tín của MỘT mốc (lưu trên dòng sổ khi xác nhận; xem trước trả cùng hình). */
export const RepDeltaSchema = z.strictObject({
  engine: z.enum(["v2e", "hd8"]),
  role: z.enum(["supplier", "customer", "commission_payer"]),
  before: RepPointSchema,
  after: RepPointSchema,
});
export type RepDelta = z.infer<typeof RepDeltaSchema>;

export const ObligationImpactSchema = z.strictObject({
  obligation_id: z.uuid(),
  at: IsoDay,
  /** Số ngày trễ (0 = đúng/sớm hạn). */
  late: z.number().int().min(0),
  /** Lỗi áp dụng (chỉ khi trễ; trễ mà không chọn ⇒ `unknown`). */
  fault: z.enum(IMPACT_FAULTS).nullable(),
  /** Uy tín đối tác (null = mốc không gắn đối tác / không góp điểm). `pending_fault` = lỗi chưa rõ ⇒ chưa trừ điểm, nhắc xác minh. */
  reputation: RepDeltaSchema.extend({
    party: z.string(),
    counted: z.boolean(),
    pending_fault: z.boolean(),
  }).nullable(),
  /** Kho theo thành phần (mốc giao của HĐ Mua/Bán); SL dạng chuỗi thập phân. */
  stock: z.array(
    z.strictObject({
      component_id: z.uuid(),
      name: z.string(),
      before: z.string(),
      after: z.string(),
    }),
  ),
  /** Còn phải thu (`receive`) / trả (`pay`) của HĐ — tổng mốc tiền đang mở; null = mốc không phải tiền. */
  debt: z
    .strictObject({
      direction: z.enum(["receive", "pay"]),
      before: z.number().int(),
      after: z.number().int(),
    })
    .nullable(),
});
export type ObligationImpact = z.infer<typeof ObligationImpactSchema>;
