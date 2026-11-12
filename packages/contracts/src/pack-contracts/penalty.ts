// CR-127 · X4 · spec §4.1 `POST /obligations/:id/penalty`, `GET /contracts/:id/penalties` · BR-56: phạt chậm. Mốc trễ ⇒ phạt ước tính theo điều khoản
// (`penalty_terms`); người phụ trách chọn "Ghi vào công nợ" (book: sinh mốc `kind='penalty'` đúng chiều) hoặc "Miễn phạt" (waive, bằng chứng). Một mốc
// chỉ quyết MỘT lần (409 `PENALTY_DECIDED`). Hệ thống KHÔNG tự trừ tiền.
import { z } from "zod";
import { EvidenceInputSchema } from "../chat/evidence";

export const PENALTY_AMOUNT_MAX = 1_000_000_000_000_000;

/**
 * Thân quyết định. `book` = "Ghi vào công nợ": cần `amount` (đồng nguyên dương); số KHÁC phạt ước tính (hoặc không có ước tính) cần bằng chứng, và không vượt trần
 * (kiểm ở use case ⇒ 422). `waive` = "Không tính phạt" (mốc trễ này không bị phạt) — cần bằng chứng; KHÁC "Miễn khoản phạt đã ghi" (X3 `waive_penalty`, huỷ mốc phạt đã ghi).
 */
export const PenaltyDecisionSchema = z
  .strictObject({
    decision: z.enum(["book", "waive"]),
    amount: z.number().int().positive().max(PENALTY_AMOUNT_MAX).optional(),
    evidence: EvidenceInputSchema.optional(),
  })
  .refine((b) => b.decision !== "book" || b.amount !== undefined, {
    message: "book cần amount",
    path: ["amount"],
  });
export type PenaltyDecision = z.infer<typeof PenaltyDecisionSchema>;

export const PenaltyOutSchema = z.strictObject({
  state: z.enum(["booked", "waived"]),
  /** Mốc `kind='penalty'` vừa ghi vào công nợ (chỉ `book`). */
  penalty_obligation_id: z.uuid().nullable(),
});
export type PenaltyOut = z.infer<typeof PenaltyOutSchema>;

/** Phạt ước tính + quyết định của MỘT mốc trễ (đọc: chi tiết HĐ / mốc). */
export const PenaltyViewSchema = z.strictObject({
  obligation_id: z.uuid(),
  days_late: z.number().int().min(0),
  /** null ⇒ chưa có điều khoản khớp / thiếu cơ sở tính — người phụ trách vẫn ghi số tay. */
  estimate: z
    .strictObject({
      amount: z.number().int(),
      uncapped: z.number().int(),
      capped: z.boolean(),
      /** Trần áp dụng (đồng); null ⇒ không có trần. */
      cap: z.number().int().nullable(),
      basis: z.enum(["per_day_of_value", "per_day_of_milestone", "fixed"]),
      term_id: z.uuid(),
    })
    .nullable(),
  /** Vì sao không có ước tính (chỉ khi `estimate` = null): chưa trễ · chưa có điều khoản khớp · điều khoản thiếu số (vd mức phạt cố định). */
  reason: z.enum(["not_late", "no_term", "missing_amount"]).nullable(),
  /** `receive`: đối tác trễ ⇒ mình được phạt; `pay`: mình trễ ⇒ mình chịu. */
  direction: z.enum(["receive", "pay"]),
  decision: z.enum(["booked", "waived"]).nullable(),
  penalty_obligation_id: z.uuid().nullable(),
});
export type PenaltyView = z.infer<typeof PenaltyViewSchema>;

/** Mã lỗi (HTTP theo spec §4; câu VI ở `penalty.routes`). */
export const PENALTY_ERRORS = {
  PENALTY_DECIDED: 409,
  PENALTY_FORBIDDEN: 403,
  PENALTY_NOT_APPLICABLE: 422,
  PENALTY_OVER_CAP: 422,
  CHANGE_PENDING: 409,
  EVIDENCE_REQUIRED: 422,
} as const;
export type PenaltyErrorCode = keyof typeof PENALTY_ERRORS;
