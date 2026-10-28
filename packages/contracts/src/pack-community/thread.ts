// CR-102 · C5/C6 · luồng bình luận riêng theo (bài × công ty đối tác) (D3) + thông báo.
// Chủ quản: `GET /posts/:id/threads` (tóm tắt mọi luồng) + `GET /posts/:id/threads/:orgId`; đối tác: chỉ luồng của công ty mình (orgId = công ty mình, server bỏ qua giá trị khác).
import { z } from "zod";
import { ContentHitSchema } from "./post";
import { NOTIFY_KINDS } from "./viewer";

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
});
export type CommentView = z.infer<typeof CommentViewSchema>;

export const ThreadSummarySchema = z.strictObject({
  postId: z.string(),
  orgId: z.string(),
  orgName: z.string(),
  count: z.number().int(),
  lastAt: z.iso.datetime().optional(),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const ThreadSchema = ThreadSummarySchema.extend({ comments: z.array(CommentViewSchema) });
export type Thread = z.infer<typeof ThreadSchema>;

export const CreateCommentInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  /** Chủ quản chọn luồng (công ty); đối tác bỏ trống. */
  orgId: z.string().max(64).optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>;

export const CommunityNotificationSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(NOTIFY_KINDS),
  actorName: z.string(),
  text: z.string(),
  postId: z.string().optional(),
  /** Luồng cần mở (chủ quản). */
  orgId: z.string().optional(),
  createdAt: z.iso.datetime(),
  unread: z.boolean(),
});
export type CommunityNotification = z.infer<typeof CommunityNotificationSchema>;

export const NotificationsResponseSchema = z.strictObject({
  items: z.array(CommunityNotificationSchema),
  unread: z.number().int(),
});
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;
