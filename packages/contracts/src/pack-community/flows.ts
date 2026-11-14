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
/** CR-151 · phân trang 3 danh sách người duyệt + «bài của tôi»: `limit` ≤ FLOW_PAGE_MAX (mặc định 50), `offset`; `nextOffset` null ⇒ hết. */
export const FLOW_PAGE_MAX = 100;
export const FlowPageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(FLOW_PAGE_MAX).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  pending: z.enum(["1"]).optional(),
});
export type FlowPageQuery = z.infer<typeof FlowPageQuerySchema>;
const NextOffset = z.number().int().min(0).nullable();
export const ModerationListSchema = z.strictObject({
  items: z.array(ModerationItemSchema).max(FLOW_PAGE_MAX),
  nextOffset: NextOffset,
});
export type ModerationList = z.infer<typeof ModerationListSchema>;

/** Quyết một bước duyệt (dùng chung 3 khe). `taskId` vắng ⇒ task đang mở hiện tại. */
export const FlowDecideInputSchema = z.strictObject({
  action: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  taskId: Id.optional(),
  feedback: Txt(4000).optional(),
  /** Chỉ khe «đơn xin tham gia» + `approve`: đối tác SHT (`party_key`) Admin chọn để gắn tài khoản công ty; vắng ⇒ tạo đối tác mới. */
  partyKey: z.string().trim().min(1).max(300).optional(),
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
export const JoinRequestListSchema = z.strictObject({
  items: z.array(JoinRequestSchema).max(FLOW_PAGE_MAX),
  nextOffset: NextOffset,
});
export type JoinRequestList = z.infer<typeof JoinRequestListSchema>;

export const ReportInputSchema = z.strictObject({ reason: Txt(1000).min(1) });
export const ReportSchema = z.strictObject({
  id: Id,
  taskId: Id,
  postId: Id,
  /** Tiêu đề bài bị báo cáo (người duyệt biết bài nào) — cùng câu SQL với danh sách, không gọi theo hàng. */
  postTitle: Txt(2000),
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
export const ReportListSchema = z.strictObject({
  items: z.array(ReportSchema).max(FLOW_PAGE_MAX),
  nextOffset: NextOffset,
});
export type ReportList = z.infer<typeof ReportListSchema>;

/** Màn nào của 3 luồng người xem này được dùng (nav shell): tính ở server theo vai + khe đã bật, UI không đoán. */
export const FlowNavSchema = z.strictObject({
  /** Hàng chờ duyệt bài: người duyệt + tenant đã bật duyệt bài. */
  moderationQueue: z.boolean(),
  /** Xem trạng thái duyệt bài của tôi: tenant đã bật duyệt bài. */
  moderationOn: z.boolean(),
  /** Đối tác gửi yêu cầu tham gia. */
  joinSubmit: z.boolean(),
  /** Người duyệt xem/quyết yêu cầu tham gia + báo cáo vi phạm. */
  joinReview: z.boolean(),
  reports: z.boolean(),
});
export type FlowNav = z.infer<typeof FlowNavSchema>;
