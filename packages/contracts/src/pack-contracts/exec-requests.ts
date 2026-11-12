// CR-127 · X3 · spec §4.1 (`POST /contracts/:id/hold|release`, `POST /obligations/:id/change-requests`), §12.5 business · BR-41, BR-42, BR-52,
// BR-53, BR-75, BR-76: tạm khoá / mở khoá và yêu cầu thay đổi thực hiện (dời hạn, tách mốc, miễn phạt). Bằng chứng là bắt buộc nhưng kiểm ở use case
// (thiếu ⇒ 422 `EVIDENCE_REQUIRED`, không phải 400 của schema). Có quy trình khớp ⇒ `pending` (chờ duyệt), không ⇒ `applied` ngay.
import { z } from "zod";
import { EvidenceInputSchema } from "../chat/evidence";

const Day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "invalid date");
export const EXEC_REASON_MAX = 2000;
export const EXEC_NOTE_MAX = 500;

/** Thân `hold` / `release`: lý do (tuỳ chọn) + bằng chứng (kiểm ở use case). */
export const HoldRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(EXEC_REASON_MAX).optional(),
  evidence: EvidenceInputSchema.optional(),
});
export type HoldRequest = z.infer<typeof HoldRequestSchema>;

const evidence = EvidenceInputSchema.optional();
export const ChangeRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("postpone"),
    payload: z.strictObject({
      to: Day,
      note: z.string().trim().min(1).max(EXEC_NOTE_MAX).nullish(),
    }),
    evidence,
  }),
  z.strictObject({
    kind: z.literal("split"),
    payload: z.strictObject({
      due_date: Day,
      amount: z.number().int().positive().max(1_000_000_000_000_000),
      title: z.string().trim().min(1).max(300).optional(),
    }),
    evidence,
  }),
  z.strictObject({
    kind: z.literal("waive_penalty"),
    payload: z.strictObject({}).default({}),
    evidence,
  }),
]);
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

/** Đường cũ `POST /obligations/:id/postpone` (bọc): thêm bằng chứng. */
export const PostponeEvidenceSchema = z.strictObject({
  to: Day,
  note: z.string().max(EXEC_NOTE_MAX).nullish(),
  evidence,
});
/** Đường cũ `PATCH /milestones/:id` trên HĐ DONE: chỉ `due_date` (+ bằng chứng); khoá khác ⇒ `USE_NEW_VERSION`. */
export const MilestonePostponeSchema = z.strictObject({ due_date: Day, evidence });

/** Loại yêu cầu trong `contracts.exec_requests.kind` (ngoài `transaction` của X2). */
export const EXEC_KINDS = ["postpone", "split", "waive_penalty", "hold", "release"] as const;
export type ExecKind = (typeof EXEC_KINDS)[number];

/** Kết quả: áp ngay (`applied`) hoặc chờ quy trình duyệt (`pending`, mốc hiện "Chờ duyệt thay đổi"). */
export type ExecRequestOut = { state: "applied" | "pending"; request_id: string };

/** Mã lỗi thêm của tạm khoá / yêu cầu thay đổi (HTTP theo spec §4; câu VI: tasks §9). */
export const EXEC_ERRORS = {
  HOLD_EXISTS: 409,
  NOT_HELD: 409,
  HOLD_NOT_ALLOWED: 409,
  HOLD_FORBIDDEN: 403,
  CHANGE_FORBIDDEN: 403,
  EVIDENCE_REQUIRED: 422,
  CHANGE_INVALID: 422,
  CHANGE_PENDING_EXISTS: 409,
  USE_NEW_VERSION: 409,
} as const;
export type ExecErrorCode = keyof typeof EXEC_ERRORS;
