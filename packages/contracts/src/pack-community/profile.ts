// CR-110 · COM-FR-37 · tab "Ảnh & tệp" của hồ sơ (`GET /pack/community/profile/:orgId/media`) + cột uy tín tab "Đối tác"
// (`GET /pack/community/partners?rep=1`, chỉ chủ quản). Media = đính kèm của bài công ty `orgId` mà NGƯỜI XEM được thấy (RLS bài,
// cùng luật bảng tin); nhãn đã che liên hệ như bài. Mới nhất trước, phân trang con trỏ.
import { z } from "zod";
import { POST_TYPES } from "./post";

export const ProfileMediaQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(60).default(30),
});
export type ProfileMediaQuery = z.input<typeof ProfileMediaQuerySchema>;

export const ProfileMediaItemSchema = z.strictObject({
  id: z.string(),
  postId: z.string(),
  postType: z.enum(POST_TYPES),
  kind: z.enum(["image", "video"]),
  /** Nhãn (đã che liên hệ như nội dung bài). */
  label: z.string(),
  /** http(s) — vắng khi đính kèm chưa có url. */
  url: z.string().optional(),
  /** Thời điểm đăng bài chứa đính kèm (ISO). */
  createdAt: z.string(),
});
export type ProfileMediaItem = z.infer<typeof ProfileMediaItemSchema>;

export const ProfileMediaSchema = z.strictObject({
  items: z.array(ProfileMediaItemSchema),
  nextCursor: z.string().optional(),
});
export type ProfileMedia = z.infer<typeof ProfileMediaSchema>;

/** Điểm uy tín đối tác (cổng `HostBookReader`): chỉ chủ quản có quyền đọc gói contracts, chỉ đối tác đã liên kết SHT. */
export const PartnerReputationSchema = z.strictObject({
  band: z.enum(["good", "fair", "watch", "new"]).nullable(),
  score: z.number().nullable(),
});
export type PartnerReputation = z.infer<typeof PartnerReputationSchema>;
