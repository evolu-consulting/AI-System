// CR-102 · C5 · contract bài đăng Community (`/pack/community/posts*`). C3 cài đúng hình này; UI (community-web) chỉ đọc qua đây.
// Quy tắc hiển thị: `docs/current/community/hien-thi.md`. "Không thấy" = 404/0 hàng từ API, không phải ẩn ở UI.
// Nội dung đối tác đến user ngoài đã được che (D4); chủ quản nhận raw + `hits` (khoảng ký tự bị che nếu là user ngoài).
import { z } from "zod";

export const POST_TYPES = ["sell", "buy", "note"] as const;
export type PostType = (typeof POST_TYPES)[number];
export const POST_TYPE_LABEL: Record<PostType, string> = {
  sell: "Cần bán",
  buy: "Cần mua",
  note: "Thông báo",
};

/** Người xem bài chủ quản (D2): trần = bạn bè của chủ quản. */
export const AUDIENCE_MODES = ["all", "suppliers", "buyers", "cats", "companies"] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];
export const PostAudienceSchema = z.strictObject({
  mode: z.enum(AUDIENCE_MODES),
  /** Dùng khi `mode=cats` (nhóm hàng). */
  cats: z.array(z.string().min(1).max(80)).max(50).default([]),
  /** Dùng khi `mode=companies` (id công ty đối tác). */
  companies: z.array(z.string().min(1).max(64)).max(200).default([]),
});
export type PostAudience = z.infer<typeof PostAudienceSchema>;

export const POST_STATUSES = ["active", "archived", "done", "expired"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Việc người xem được làm trên bài — do server tính; `saveQuote` KHÔNG BAO GIỜ có cho user ngoài (HT-64). */
export const POST_ACTIONS = [
  "edit",
  "archive",
  "unarchive",
  "done",
  "delete",
  "hide",
  "unhide",
  "saveQuote",
] as const;
export type PostAction = (typeof POST_ACTIONS)[number];

export const MediaItemSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  label: z.string().max(200),
  url: z.string().max(2000).optional(),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;
export const MEDIA_LIMITS = { image: 10, video: 2 } as const;

/** Khoảng bị che (chỉ chủ quản nhận, dùng tô đậm raw). `field`: trường chứa khoảng này. */
export const CONTACT_HIT_KINDS = ["phone", "email", "link", "taxId", "company"] as const;
export const ContentHitSchema = z.strictObject({
  field: z.enum(["title", "body"]),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  kind: z.enum(CONTACT_HIT_KINDS),
});
export type ContentHit = z.infer<typeof ContentHitSchema>;

const Text = (max: number) => z.string().trim().max(max);
const Req = (max: number) => z.string().trim().min(1).max(max);

/** Trường theo loại. Cần bán: giá hoặc "liên hệ" (`price=null`). Cần mua: khu vực + ngày cần bắt buộc. */
export const SellFieldsSchema = z.strictObject({
  product: Req(200),
  qty: Req(100),
  price: Text(100).nullable(),
  area: Text(100).default(""),
});
export const BuyFieldsSchema = z.strictObject({
  product: Req(200),
  qty: Req(100),
  area: Req(100),
  /** yyyy-mm-dd */
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budget: Text(100).default(""),
});
export type SellFields = z.infer<typeof SellFieldsSchema>;
export type BuyFields = z.infer<typeof BuyFieldsSchema>;

const Body = Text(5000);
const Title = Text(200);
const Cats = z.array(z.string().min(1).max(80)).max(10).default([]);

export const CreatePostInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("sell"),
    title: Title.default(""),
    body: Body.default(""),
    fields: SellFieldsSchema,
    cats: Cats,
    media: z.array(MediaItemSchema).max(12).default([]),
    /** Chỉ chủ quản; bỏ trống ⇒ mặc định theo loại (D2). Đối tác gửi trường này ⇒ 422. */
    audience: PostAudienceSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("buy"),
    title: Title.default(""),
    body: Body.default(""),
    fields: BuyFieldsSchema,
    cats: Cats,
    media: z.array(MediaItemSchema).max(12).default([]),
    audience: PostAudienceSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("note"),
    title: Title.default(""),
    body: Req(5000),
    fields: z.strictObject({}).default({}),
    cats: Cats,
    media: z.array(MediaItemSchema).max(12).default([]),
    audience: PostAudienceSchema.optional(),
  }),
]);
export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;

/** Sửa: người đăng sửa mọi trường (loại bài không đổi). Đặt `edited=true`. */
export const UpdatePostInputSchema = z.strictObject({
  title: Title.optional(),
  body: Body.optional(),
  fields: z.record(z.string(), z.string().nullable()).optional(),
  cats: Cats.optional(),
  media: z.array(MediaItemSchema).max(12).optional(),
  audience: PostAudienceSchema.optional(),
});
export type UpdatePostInput = z.infer<typeof UpdatePostInputSchema>;

/** Chuyển trạng thái / thao tác một bước (`POST /pack/community/posts/:id/actions`). */
export const PostActionInputSchema = z.strictObject({
  action: z.enum(["archive", "unarchive", "done", "delete", "hide", "unhide"]),
});
export type PostActionInput = z.infer<typeof PostActionInputSchema>;

export const PostViewSchema = z.strictObject({
  id: z.string(),
  type: z.enum(POST_TYPES),
  authorOrgId: z.string(),
  authorOrgName: z.string(),
  authorName: z.string(),
  authorSide: z.enum(["host", "partner"]),
  /** Đối tác đã vô hiệu (chỉ chủ quản thấy nhãn "đối tác đã rời"). */
  authorLeft: z.boolean().optional(),
  createdAt: z.iso.datetime(),
  /** Hạn tự lưu trữ (30 ngày); có cho người đăng và chủ quản. */
  expiresAt: z.iso.datetime().optional(),
  edited: z.boolean(),
  status: z.enum(POST_STATUSES),
  title: z.string(),
  /** User ngoài: đã che. Chủ quản: raw. */
  body: z.string(),
  fields: z.record(z.string(), z.string().nullable()),
  cats: z.array(z.string()),
  media: z.array(MediaItemSchema),
  commentCount: z.number().int().nonnegative(),
  /** Chỉ chủ quản nhận; user ngoài: không có trường này. */
  hidden: z.boolean().optional(),
  hits: z.array(ContentHitSchema).optional(),
  /** Người xem bài chủ quản: chỉ cho chủ quản và người đăng bài chủ quản. */
  audience: PostAudienceSchema.optional(),
  actions: z.array(z.enum(POST_ACTIONS)),
});
export type PostView = z.infer<typeof PostViewSchema>;

/** C3 · HT-52: `GET /pack/community/posts/:id/source` — nội dung gốc (raw) CHỈ cho chính người đăng, để sửa bài. */
export const PostSourceSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  fields: z.record(z.string(), z.string().nullable()),
});
export type PostSource = z.infer<typeof PostSourceSchema>;
