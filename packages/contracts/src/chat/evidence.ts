// CR-127 · E1 · spec §2.3, §4, §4.2 · MỘT khái niệm "Bằng chứng" (ý kiến + chữ ký/tệp) dùng chung mọi nơi + nhận việc nhóm + uỷ quyền.
// File LÁ (chỉ import `../common`) ⇒ `processes-entities`/`processes-api`/`flow/view` cùng dùng mà không vòng import.
// DDL/RLS/hàm: `migrations-hub/0131_cr127_evidence_claim_delegation.sql`. Mã lỗi: `CHAT_CLAIM_ERRORS` (processes-errors.ts).
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";

/** Giới hạn bằng chứng (khớp CHECK 0131 + `record_evidence`): ý kiến 1..4000, ≤ 5 tệp; chữ ký PNG ≤ 200 KB, tệp ≤ 10 MB. */
export const EVIDENCE_NOTE_MAX = 4000;
export const EVIDENCE_FILES_MAX = 5;
export const EVIDENCE_SIGNATURE_MAX_BYTES = 204_800;
export const EVIDENCE_FILE_MAX_BYTES = 10_485_760;

/** Đối tượng bằng chứng gắn vào (CHECK `evidence_subject_kind_ck`). */
export const EVIDENCE_SUBJECT_KINDS = [
  "task_decision",
  "milestone",
  "hold",
  "penalty",
  "exec_request",
  "effect_outcome",
  "sign_cancel",
  "unchanged_resubmit",
  "inbox_decision", // CR-127 K8 · người phụ trách quyết HĐ nhận (MIGC 0094)
] as const;
export type EvidenceSubjectKind = (typeof EVIDENCE_SUBJECT_KINDS)[number];

/** Đầu vào bằng chứng dùng chung (R#29). Tệp/chữ ký là id `hub.attachments` đã tải lên qua đường tải có sẵn. */
export const EvidenceInputSchema = z.strictObject({
  note: z.string().trim().min(1).max(EVIDENCE_NOTE_MAX),
  signature_attachment_id: UuidSchema.optional(),
  attachment_ids: z.array(UuidSchema).max(EVIDENCE_FILES_MAX).optional(),
});
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;

/** Một người ở hình gọn (khớp `UserRefSchema` của `processes-entities`, khai lại để file này là lá). */
const PersonSchema = z.strictObject({ id: UuidSchema, display_name: z.string().min(1).max(200) });

/** Bằng chứng khi đọc (người chỉ xem nhận bản đã ẩn nội dung — `run-redact`, E4; ở đây chỉ có hình đầy đủ). */
export const EvidenceViewSchema = z.strictObject({
  id: UuidSchema,
  subject_kind: z.enum(EVIDENCE_SUBJECT_KINDS),
  subject_id: UuidSchema,
  note: z.string().min(1).max(EVIDENCE_NOTE_MAX),
  signature_attachment_id: UuidSchema.nullable(),
  attachment_ids: z.array(UuidSchema).max(EVIDENCE_FILES_MAX),
  by_user: PersonSchema,
  /** Người được giao thật khi `by_user` làm thay (uỷ quyền); vắng/null = tự làm. */
  on_behalf_of: PersonSchema.nullable(),
  at: IsoDateTime,
});
export type EvidenceView = z.infer<typeof EvidenceViewSchema>;

/** `ReviewDecisionRequest.evidence_mode`: bước yêu cầu "Chỉ ý kiến" hay "Ý kiến + chữ ký hoặc tệp" (`after.review.evidence`). */
export const EVIDENCE_MODES = ["opinion", "opinion_plus"] as const;
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

// ── Nhận việc nhóm (E2–E5 dựng trên các trường này) ─────────────────────────────────────────────────────────────────
/** Trạng thái nhận của người xem: chưa ai nhận / mình giữ / người khác giữ. */
export const TaskClaimSchema = z.strictObject({
  state: z.enum(["unclaimed", "mine", "other"]),
  by: PersonSchema.optional(),
  at: IsoDateTime.optional(),
});
export type TaskClaim = z.infer<typeof TaskClaimSchema>;

/** "Cần: tất cả": số phiếu Đạt trên tổng người phải duyệt (n). */
export const TaskVotesSchema = z.strictObject({
  done: z.number().int().min(0).max(1000),
  total: z.number().int().min(0).max(1000),
});
export type TaskVotes = z.infer<typeof TaskVotesSchema>;

/**
 * Trường thêm của `TaskDetail`/`OpenTask`/`FlowTask` (spec §4.2) — spread vào `z.strictObject` của từng thực thể.
 * Toàn bộ `optional()` để snapshot/server cũ (trước 0131) vẫn khớp; `need` vắng ⇒ suy từ `head_only` (E2).
 */
export const TASK_CLAIM_FIELDS = {
  claim: TaskClaimSchema.optional(),
  need: z.enum(["one", "head", "all"]).optional(),
  votes: TaskVotesSchema.optional(),
  /** Việc đang giao cho mình THAY người này (uỷ quyền; badge "Thay A"). */
  delegated_from: PersonSchema.optional(),
  evidence_mode: z.enum(EVIDENCE_MODES).optional(),
  /** Người xem được «Chuyển cho người khác» việc nhóm này (trưởng phòng của nhóm / quản trị công ty; việc còn mở, nhận được) — cùng luật `POST /review-tasks/:id/reassign`. Chỉ có ở việc nhận được. */
  can_reassign: z.boolean().optional(),
} as const;

/** POST /review-tasks/:id/claim → `{claim}`; /release (người đang giữ, không body). */
export const ClaimTaskResponseSchema = z.strictObject({ claim: TaskClaimSchema });
export type ClaimTaskResponse = z.infer<typeof ClaimTaskResponseSchema>;
/** POST /review-tasks/:id/reassign — trưởng phòng / quản trị công ty giao lại cho một người trong phòng. */
export const ReassignReviewTaskRequestSchema = z.strictObject({
  to_user_id: UuidSchema,
  note: z.string().trim().min(1).max(500),
});
export type ReassignReviewTaskRequest = z.infer<typeof ReassignReviewTaskRequestSchema>;

/** Giờ tự trả việc đã nhận (`tenant_flow_settings.claim_release_h`, 1..168 — CLAIM_HOURS_RANGE). */
export const CLAIM_RELEASE_H = { min: 1, max: 168, default: 24 } as const;
export const FlowSettingsSchema = z.strictObject({
  claim_release_h: z.number().int().min(CLAIM_RELEASE_H.min).max(CLAIM_RELEASE_H.max),
});
export type FlowSettings = z.infer<typeof FlowSettingsSchema>;
export const PutFlowSettingsRequestSchema = FlowSettingsSchema;
export type PutFlowSettingsRequest = FlowSettings;

// ── Uỷ quyền (hub.delegations) ───────────────────────────────────────────────────────────────────────────────────────
/** Loại việc uỷ quyền được (CHECK `delegations_kinds_ck`): duyệt · điền form · xác nhận mốc · ký số. */
export const DELEGATION_KINDS = ["approve", "form", "milestone", "esign"] as const;
export type DelegationKind = (typeof DELEGATION_KINDS)[number];

/** POST /me/delegations · POST /tenants/:tid/delegations (`for_user_id` = đặt thay người khác: quản trị công ty / trưởng phòng). */
export const CreateDelegationRequestSchema = z
  .strictObject({
    to_user_id: UuidSchema,
    from_at: IsoDateTime,
    to_at: IsoDateTime,
    kinds: z.array(z.enum(DELEGATION_KINDS)).min(1).max(DELEGATION_KINDS.length),
    for_user_id: UuidSchema.optional(),
  })
  .refine((d) => Date.parse(d.to_at) > Date.parse(d.from_at), {
    path: ["to_at"],
    message: "to_at > from_at",
  });
export type CreateDelegationRequest = z.infer<typeof CreateDelegationRequestSchema>;

export const DelegationSchema = z.strictObject({
  id: UuidSchema,
  from_user: PersonSchema,
  to_user: PersonSchema,
  from_at: IsoDateTime,
  to_at: IsoDateTime,
  kinds: z.array(z.enum(DELEGATION_KINDS)).min(1),
  created_by: PersonSchema,
  revoked_at: IsoDateTime.nullable(),
});
export type Delegation = z.infer<typeof DelegationSchema>;
export const DelegationListResponseSchema = z.strictObject({
  items: z.array(DelegationSchema).max(200),
});
export type DelegationListResponse = z.infer<typeof DelegationListResponseSchema>;
