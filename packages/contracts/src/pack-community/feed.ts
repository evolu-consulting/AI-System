// CR-102 · C5 · bảng tin: `GET /pack/community/feed?...` (lọc chữ thường; tìm tên sản phẩm).
import { z } from "zod";
import { PostViewSchema } from "./post";

/** Tab của chip lọc: Tất cả (gồm Cần bán/Cần mua/Thông báo không lưu trữ), từng loại, hoặc Đã lưu trữ. */
export const FEED_TABS = ["all", "sell", "buy", "note", "archived"] as const;
export type FeedTab = (typeof FEED_TABS)[number];

export const FeedQuerySchema = z.strictObject({
  tab: z.enum(FEED_TABS).default("all"),
  cat: z.string().max(80).optional(),
  area: z.string().max(100).optional(),
  /** Người đăng = id công ty. */
  authorOrgId: z.string().max(64).optional(),
  /** Tìm chữ thường trong tiêu đề, sản phẩm, nội dung (đã che với user ngoài). */
  q: z.string().trim().max(100).optional(),
  /** Chỉ bài của công ty mình (trang hồ sơ "Bài của tôi"). */
  mine: z.boolean().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type FeedQuery = z.input<typeof FeedQuerySchema>;

export const FeedCountsSchema = z.strictObject({
  all: z.number().int(),
  sell: z.number().int(),
  buy: z.number().int(),
  note: z.number().int(),
  archived: z.number().int(),
});
export type FeedCounts = z.infer<typeof FeedCountsSchema>;

export const FeedResponseSchema = z.strictObject({
  items: z.array(PostViewSchema),
  /** Đếm theo tab với bộ lọc (không tính tab) hiện tại. */
  counts: FeedCountsSchema,
  /** Giá trị để lọc nhóm hàng/khu vực trong phạm vi người xem được thấy. */
  facets: z.strictObject({ cats: z.array(z.string()), areas: z.array(z.string()) }),
  nextCursor: z.string().optional(),
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;
