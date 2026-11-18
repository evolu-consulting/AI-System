// CR-102 · C5/C6 → CR-129 · bình luận phẳng theo bài (không còn "luồng" theo công ty). Ai thấy bình luận do server (RLS) quyết:
// chủ quản thấy tất cả; đối tác thấy bình luận của chủ quản + công ty mình + trên bài của mình + bình luận nhắc (@) tới mình.
// Nhắc công ty đối tác = `mentions` (id công ty); chỉ chủ quản nhắc được (hôm nay). CR-186: nhắc NGƯỜI bằng `mentionUserIds` (gợi ý `GET /mentionable-people`); `mentions` (công ty) chỉ còn cho dữ liệu cũ.
import { z } from "zod";
import { ContentHitSchema } from "./content-hit";

/** Công ty được nhắc (@) trong bình luận. User ngoài chỉ nhận phần tử là công ty MÌNH. */
export const MentionSchema = z.strictObject({ orgId: z.string(), name: z.string() });
export type Mention = z.infer<typeof MentionSchema>;

export const COMMENT_MENTIONS_MAX = 10;
export const COMMENT_PAGE_MAX = 100;
export const MENTIONABLES_MAX = 20;

export const CommentViewSchema = z.strictObject({
  id: z.string(),
  authorName: z.string(),
  authorOrgId: z.string(),
  authorOrgName: z.string(),
  authorSide: z.enum(["host", "partner"]),
  /** User ngoài: đã che (trừ nội dung của chủ quản gửi họ). */
  text: z.string(),
  hits: z.array(ContentHitSchema).optional(),
  createdAt: z.iso.datetime(),
  /** Chỉ chủ quản (bình luận đối tác bị ẩn). */
  hidden: z.boolean().optional(),
  /** Người xem được xoá/sửa bình luận này (của chính mình). */
  mine: z.boolean(),
  /** Công ty được nhắc (có thể rỗng). */
  mentions: z.array(MentionSchema),
});
export type CommentView = z.infer<typeof CommentViewSchema>;

/** `GET /posts/:id/comments`: cũ → mới, RLS lọc theo người xem. */
export const CommentListQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(COMMENT_PAGE_MAX).default(50),
  /** CR-147c · `desc` = mới → cũ (tải dần phần cũ hơn); `before` = id bình luận: chỉ lấy các bình luận CŨ HƠN nó. */
  dir: z.enum(["asc", "desc"]).default("asc"),
  before: z.uuid().optional(),
});
export type CommentListQuery = z.input<typeof CommentListQuerySchema>;

export const CommentPageSchema = z.strictObject({
  comments: z.array(CommentViewSchema),
  /** Có ⇒ còn trang sau (truyền lại làm `cursor`). */
  nextCursor: z.string().optional(),
});
export type CommentPage = z.infer<typeof CommentPageSchema>;

export const CreateCommentInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  /** CR-186 · NGƯỜI được nhắc (≤ 10, như bài đăng; chọn ở hộp «Nhắc tên», gợi ý `GET /mentionable-people`). Phải là người thấy được bài (đối tác: chỉ đồng nghiệp công ty mình), ngoài tập ⇒ 422 `MENTION_USER_NOT_ALLOWED`; người được nhắc nhận chuông. */
  mentionUserIds: z.array(z.uuid()).max(COMMENT_MENTIONS_MAX).default([]),
  /**
   * @deprecated CR-186: UI không còn gửi. Id công ty đối tác được nhắc (kiểu cũ CR-129) — server còn nhận để tương thích, ngoài tập
   * cho phép ⇒ 422 `MENTION_NOT_ALLOWED`. Dữ liệu cũ vẫn đọc ở `CommentView.mentions` (chỉ đọc, không backfill).
   */
  mentions: z.array(z.uuid()).max(COMMENT_MENTIONS_MAX).default([]),
});
export type CreateCommentInput = z.input<typeof CreateCommentInputSchema>;

/** C6: người viết sửa chữ bình luận của mình (không đổi lời nhắc). */
export const UpdateCommentInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
});
export type UpdateCommentInput = z.infer<typeof UpdateCommentInputSchema>;

/** C6: chủ quản ẩn/hiện bình luận trên bài của mình (đối tác không thấy bình luận bị ẩn — HT-46). */
export const HideCommentInputSchema = z.strictObject({ hidden: z.boolean() });
export type HideCommentInput = z.infer<typeof HideCommentInputSchema>;
