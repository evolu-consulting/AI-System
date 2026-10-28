// CR-102b · C7b/C8 · "Lưu báo giá" + gợi ý SHT dưới bài (CHỈ chủ quản). Mọi trường ở đây KHÔNG BAO GIỜ có trong JSON gửi user ngoài
// (HT-64, HT-68): `PostView.quotes` / `PostView.hostHint` chỉ được thêm cho chủ quản; route `/quote*` trả 403 cho đối tác.
import { z } from "zod";

export const QUOTE_KINDS = ["new", "renew"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];
export const QUOTE_KIND_LABEL: Record<QuoteKind, string> = { new: "Mua mới", renew: "Gia hạn" };

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Sản phẩm: có sẵn (`productId`) HOẶC tạo mới (`newProduct`) — đúng một. */
export const QuoteInputSchema = z
  .strictObject({
    /** Mặt hàng của bài (GĐ1 bài chỉ có mặt hàng 0; "Lưu thêm báo giá" dùng số kế tiếp). */
    itemIdx: z.number().int().min(0).max(49).default(0),
    /** Lưu từ bình luận của NCC (bài Cần mua của chủ quản); vắng ⇒ lưu từ chính bài Cần bán của NCC. */
    commentId: z.uuid().optional(),
    productId: z.uuid().optional(),
    newProduct: z
      .strictObject({
        name: z.string().trim().min(1).max(200),
        unit: z.string().trim().max(40).nullable().default(null),
        group: z.enum(["goods", "service"]).default("goods"),
      })
      .optional(),
    /** Đồng, số nguyên. */
    price: z.number().int().min(1).max(1_000_000_000_000),
    unit: z.string().trim().max(40).nullable().default(null),
    vatIncluded: z.boolean(),
    kind: z.enum(QUOTE_KINDS).default("new"),
    quotedAt: DATE,
    expiresOn: DATE.nullable().optional(),
    /** R27: báo chủ quản (chuông, C9) khi NCC sửa giá bài này. */
    notify: z.boolean().default(true),
  })
  .refine((q) => (q.productId === undefined) !== (q.newProduct === undefined), {
    message: "productId xor newProduct",
    path: ["productId"],
  });
export type QuoteInput = z.input<typeof QuoteInputSchema>;

export const QuoteCompareSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("first") }),
  z.strictObject({
    kind: z.enum(["equal", "cheaper", "dearer"]),
    refPrice: z.number(),
    refSupplier: z.string(),
    /** Giá mới − giá so (đồng; âm = rẻ hơn). */
    diff: z.number(),
    /** % lệch có dấu, 1 số lẻ. */
    pct: z.number(),
  }),
]);
export type QuoteCompare = z.infer<typeof QuoteCompareSchema>;

export const QuoteWarningSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("deviation"), pct: z.number(), refPrice: z.number() }),
  z.strictObject({ code: z.literal("vat_differs"), refPrice: z.number() }),
]);
export type QuoteWarning = z.infer<typeof QuoteWarningSchema>;

/** Lần lưu trước của cùng (bài, mặt hàng, bình luận) — R28 "đã lưu bởi … lúc …". */
export const QuoteExistingSchema = z.strictObject({ by: z.string(), at: z.iso.datetime() });

export const QuotePreviewSchema = z.strictObject({
  compare: QuoteCompareSchema,
  warnings: z.array(QuoteWarningSchema),
  /** Số giá Báo giá cũ (cùng NCC + loại) sẽ chuyển sang "Đã thay" khi lưu. */
  replaces: z.number().int().nonnegative(),
  existing: QuoteExistingSchema.nullable(),
});
export type QuotePreview = z.infer<typeof QuotePreviewSchema>;

/** Dấu "đã lưu" trên bài — chỉ chủ quản (HT-63). */
export const QuoteMarkSchema = z.strictObject({
  itemIdx: z.number().int(),
  commentId: z.string().optional(),
  /** Bình luận nguồn đã bị đối tác xoá — dấu vẫn giữ, hiện "bình luận đã xoá". */
  commentDeleted: z.boolean().optional(),
  by: z.string(),
  at: z.iso.datetime(),
  productId: z.string(),
  supplier: z.string(),
  price: z.number(),
  unit: z.string().nullable(),
  /** Bài được sửa sau khi lưu. */
  postEdited: z.boolean(),
  /** NCC sửa giá sau khi lưu và chủ quản chưa lưu lại (R27). */
  priceEdited: z.boolean(),
});
export type QuoteMark = z.infer<typeof QuoteMarkSchema>;

export const QuoteSavedSchema = QuotePreviewSchema.extend({
  productId: z.string(),
  productCreated: z.boolean(),
  supplierCreated: z.boolean(),
  mark: QuoteMarkSchema,
});
export type QuoteSaved = z.infer<typeof QuoteSavedSchema>;

/** Gợi ý SHT dưới bài (HT-67) — chỉ chủ quản; hàng đang giữ / giá vốn / giá tốt nhất / uy tín; Cần mua "khớp hàng đang có". */
export const HostHintSchema = z.strictObject({
  match: z
    .strictObject({
      productId: z.string(),
      name: z.string(),
      unit: z.string().nullable(),
      how: z.enum(["id", "exact", "prefix"]),
    })
    .nullable(),
  /** null ⇒ không theo dõi kho / không khớp SP. */
  onHand: z.string().nullable(),
  avgCost: z.number().nullable(),
  best: z
    .strictObject({
      price: z.number(),
      unit: z.string().nullable(),
      supplier: z.string(),
      vatIncluded: z.boolean().nullable(),
      seenOn: z.string(),
    })
    .nullable(),
  reputation: z
    .strictObject({
      band: z.enum(["good", "fair", "watch", "new"]),
      score: z.number().nullable(),
    })
    .nullable(),
  /** Đã có hàng đang giữ khớp mặt hàng của bài (nguồn thông báo "khớp hàng đang có", C9). */
  inStock: z.boolean(),
});
export type HostHint = z.infer<typeof HostHintSchema>;

/** `GET /pack/community/quote/match?q=` — gợi ý SP khớp tên gõ (một SP tốt nhất + giá/tồn). */
export const QuoteMatchSchema = z.strictObject({ hint: HostHintSchema });
export type QuoteMatch = z.infer<typeof QuoteMatchSchema>;
