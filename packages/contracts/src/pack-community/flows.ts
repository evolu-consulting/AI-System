// CR-120 · cr120-community-flows · contract 3 khe Community (REST `/pack/community/moderation|join-requests|reports`). Trạng thái
// chi tiết từng bước đi qua FlowView chung (`/pack/community/flow/:slot/:ref`); ở đây là hàng danh sách + đầu vào form/quyết định.
import { z } from "zod";
import { PARTNER_LABELS } from "./viewer";

const Id = z.uuid();
const At = z.string().min(10).max(40);
const Txt = (max: number) => z.string().trim().max(max);

export const MODERATION_STATES = ["none", "pending", "approved", "rejected"] as const;
export const ModerationItemSchema = z.strictObject({
  id: Id,
  taskId: Id.nullable(),
  moderation: z.enum(MODERATION_STATES),
  /** `running` = agent đang sàng lọc; `flagged`/`error` = chờ người duyệt. */
  screen: z.enum(["running", "clean", "flagged", "error"]).nullable(),
  reason: Txt(1000).nullable(),
  /** true ⇒ đang chờ người duyệt quyết (agent gắn cờ/lỗi/treo). */
  awaitingReview: z.boolean(),
  type: z.enum(["sell", "buy", "note"]),
  title: Txt(2000),
  authorName: Txt(200),
  createdAt: At,
  decidedBy: Txt(200).nullable(),
  feedback: Txt(4000).nullable(),
});
export type ModerationItem = z.infer<typeof ModerationItemSchema>;
export const ModerationListSchema = z.strictObject({
  items: z.array(ModerationItemSchema).max(100),
});
export type ModerationList = z.infer<typeof ModerationListSchema>;

/** Quyết một bước duyệt (dùng chung 3 khe). `taskId` vắng ⇒ task đang mở hiện tại. */
export const FlowDecideInputSchema = z.strictObject({
  action: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  taskId: Id.optional(),
  feedback: Txt(4000).optional(),
});
export type FlowDecideInput = z.infer<typeof FlowDecideInputSchema>;

export const JoinRequestInputSchema = z.strictObject({
  company: Txt(200).min(1),
  contact: Txt(200).min(1),
  email: z.email().max(200),
  reason: Txt(2000).default(""),
  labels: z.array(z.enum(PARTNER_LABELS)).max(2).default([]),
});
export type JoinRequestInput = z.input<typeof JoinRequestInputSchema>;
export const JoinRequestSchema = z.strictObject({
  id: Id,
  taskId: Id,
  status: z.enum(["pending", "approved", "rejected"]),
  company: Txt(200),
  contact: Txt(200),
  email: Txt(200),
  reason: Txt(2000),
  labels: z.array(z.enum(PARTNER_LABELS)).max(2),
  createdAt: At,
  decidedBy: Txt(200).nullable(),
  feedback: Txt(4000).nullable(),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;
export const JoinRequestListSchema = z.strictObject({ items: z.array(JoinRequestSchema).max(100) });

export const ReportInputSchema = z.strictObject({ reason: Txt(1000).min(1) });
export const ReportSchema = z.strictObject({
  id: Id,
  taskId: Id,
  postId: Id,
  reason: Txt(1000),
  status: z.enum(["pending", "resolved"]),
  triage: z.enum(["running", "done", "error"]),
  kind: z.enum(["spam", "abuse", "contact", "fraud", "other"]).nullable(),
  level: z.enum(["low", "medium", "high"]).nullable(),
  action: z.enum(["hide", "warn", "dismiss"]).nullable(),
  createdAt: At,
  decidedBy: Txt(200).nullable(),
});
export type Report = z.infer<typeof ReportSchema>;
export const ReportListSchema = z.strictObject({ items: z.array(ReportSchema).max(100) });
