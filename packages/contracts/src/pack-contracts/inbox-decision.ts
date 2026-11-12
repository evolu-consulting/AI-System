// CR-127 K8 · BR-57/58 · spec §3 #9b, §4.1: `POST /contracts/:id/inbox-decision` — người phụ trách HĐ nhận quyết khi công ty chưa có quy trình
// nhận hợp đồng. Ý kiến (evidence.note) bắt buộc khi Trả lại / Từ chối. Mã lỗi + HTTP: tasks §9.
import { z } from "zod";
import { EvidenceInputSchema } from "../chat/evidence";

export const INBOX_DECISIONS = ["accept", "return", "reject"] as const;
export type InboxDecisionValue = (typeof INBOX_DECISIONS)[number];

export const INBOX_DECISION_ERRORS = {
  INBOX_NOT_AWAITING: 409,
  INBOX_REPLY_CLOSED: 409,
  FEEDBACK_REQUIRED: 422,
  INBOX_DECISION_FORBIDDEN: 403,
} as const;
export type InboxDecisionErrorCode = keyof typeof INBOX_DECISION_ERRORS;

export const InboxDecisionRequestSchema = z.strictObject({
  decision: z.enum(INBOX_DECISIONS),
  evidence: EvidenceInputSchema.optional(),
});
export type InboxDecisionRequest = z.infer<typeof InboxDecisionRequestSchema>;

export const InboxDecisionResponseSchema = z.strictObject({
  status: z.enum(["done", "draft", "reject"]),
});
export type InboxDecisionResponse = z.infer<typeof InboxDecisionResponseSchema>;
