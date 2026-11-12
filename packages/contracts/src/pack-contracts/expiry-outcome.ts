// CR-127 · SG1 · BR-67/68 · spec §4.1: `POST /contracts/:id/expiry-outcome` — người phụ trách / trưởng phòng của họ / quản trị công ty quyết kết cục
// của HĐ ĐÃ DUYỆT sắp hết hạn: Gia hạn / Chấm dứt / Để hết hạn (bằng chứng bắt buộc, kiểm ở use case ⇒ 422 `EVIDENCE_REQUIRED`).
// Công ty có quy trình `contract.expiring` khớp HĐ ⇒ quyết trong việc của quy trình (409 `EXPIRY_IN_FLOW`). Cùng logic với kết cục của quy trình.
import { z } from "zod";
import { EvidenceInputSchema } from "../chat/evidence";

export const EXPIRY_OUTCOMES = ["renew", "terminate", "let_expire"] as const;
export const ExpiryOutcomeSchema = z.enum(EXPIRY_OUTCOMES);
export type ExpiryOutcome = z.infer<typeof ExpiryOutcomeSchema>;

export const ExpiryOutcomeRequestSchema = z.strictObject({
  outcome: ExpiryOutcomeSchema,
  evidence: EvidenceInputSchema.optional(),
});
export type ExpiryOutcomeRequest = z.infer<typeof ExpiryOutcomeRequestSchema>;

/** `renewal_id` = HĐ gia hạn DRAFT vừa tạo (chỉ khi `renew`); Chấm dứt / Để hết hạn ⇒ null. */
export type ExpiryOutcomeOut = { state: "applied"; renewal_id: string | null };

/** Mã lỗi thêm (HTTP theo spec §4); `EVIDENCE_REQUIRED` dùng chung với `EXEC_ERRORS`. */
export const EXPIRY_ERRORS = {
  EXPIRY_FORBIDDEN: 403,
  EXPIRY_NOT_ALLOWED: 409,
  EXPIRY_IN_FLOW: 409,
  EXPIRY_DECIDED: 409,
} as const;
export type ExpiryErrorCode = keyof typeof EXPIRY_ERRORS;
