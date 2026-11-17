// CR-181 · lát s1 · lõi chung «Chữ ký nội bộ»: giá trị cho phép + thiết lập theo công ty + hình dạng «Chữ ký của tôi».
// Khớp CHECK ở hub 0155 (`user_signatures_*_ck`, `signature_settings_*_ck`). Đổi giá trị ⇒ migration mới sửa CHECK.
// Route (lát s2) dùng lại các schema này; ảnh KHÔNG đi kèm khi ký tài liệu (BR-K3) — chỉ máy chủ lấy từ DB.
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "./common";

export const SIGNATURE_KINDS = ["main", "initials"] as const;
export const SIGNATURE_METHODS = ["draw", "upload", "type"] as const;
export const SIGNATURE_CAPTIONS = ["name", "title", "date", "time"] as const;
export const SIGNATURE_INKS = ["blue", "black"] as const;
export const SIGNATURE_INITIALS_MODES = ["shrink", "own"] as const;
export const SIGNATURE_CHANGE_POLICIES = ["self", "admin"] as const;
/** Ảnh PNG tối đa 200 KiB (khớp `user_signatures_png_ck`). */
export const SIGNATURE_PNG_MAX_BYTES = 204800;
export const SIGNATURE_PROVIDER_MAX = 60;

export const SignatureKindSchema = z.enum(SIGNATURE_KINDS);
export const SignatureMethodSchema = z.enum(SIGNATURE_METHODS);
export type SignatureKind = z.infer<typeof SignatureKindSchema>;
export type SignatureMethod = z.infer<typeof SignatureMethodSchema>;

const uniqueArray = <T extends z.ZodType>(item: T, min: number, max: number) =>
  z
    .array(item)
    .min(min)
    .max(max)
    .refine((a) => new Set(a).size === a.length, "không được trùng");

/** Thiết lập chữ ký của một công ty (không có hàng ở DB ⇒ `SIGNATURE_SETTINGS_DEFAULT`). */
export const SignatureSettingsSchema = z.strictObject({
  /** Cách tạo cho phép (≥ 1). */
  methods: uniqueArray(z.enum(SIGNATURE_METHODS), 1, SIGNATURE_METHODS.length),
  /** Bắt buộc tạo chữ ký (màn chặn sau đăng nhập khi bật ký trên tài liệu). */
  required: z.boolean(),
  /** Dòng chữ dưới chữ ký khi in (thứ tự do máy chủ in quyết, không theo mảng). */
  caption: uniqueArray(z.enum(SIGNATURE_CAPTIONS), 0, SIGNATURE_CAPTIONS.length),
  ink: z.enum(SIGNATURE_INKS),
  initials: z.enum(SIGNATURE_INITIALS_MODES),
  change_policy: z.enum(SIGNATURE_CHANGE_POLICIES),
  /** Công tắc ký trên tài liệu (Q5); tắt ⇒ mọi thứ như cũ. */
  on_doc_enabled: z.boolean(),
  /** Chữ ký số (đợt 1 chỉ làm sẵn khung, luôn khoá ở màn ký). */
  digital_enabled: z.boolean(),
  digital_provider: z.string().trim().min(1).max(SIGNATURE_PROVIDER_MAX).nullable(),
});
export type SignatureSettings = z.infer<typeof SignatureSettingsSchema>;

export const SIGNATURE_SETTINGS_DEFAULT: SignatureSettings = {
  methods: ["draw", "upload", "type"],
  required: true,
  caption: ["name", "date"],
  ink: "blue",
  initials: "shrink",
  change_policy: "self",
  on_doc_enabled: false,
  digital_enabled: false,
  digital_provider: null,
};

/** Một chữ ký của tôi: ảnh là data URL PNG (nét đen, nền trong suốt). */
export const MySignatureItemSchema = z.strictObject({
  id: UuidSchema,
  kind: SignatureKindSchema,
  method: SignatureMethodSchema,
  image: z.string().startsWith("data:image/png;base64,"),
  created_at: IsoDateTime,
});
export type MySignatureItem = z.infer<typeof MySignatureItemSchema>;

/** Trạng thái xin đổi: `none` chưa xin · `requested` chờ quản trị · `granted` được đổi một lần. */
export const SIGNATURE_CHANGE_STATES = ["none", "requested", "granted"] as const;

/** `GET /me/signature`. `needs_create` = bật + bắt buộc + (chưa có chữ ký chính | cách tạo đã bị bỏ). */
export const MySignatureViewSchema = z.strictObject({
  settings: SignatureSettingsSchema,
  main: MySignatureItemSchema.nullable(),
  initials: MySignatureItemSchema.nullable(),
  needs_create: z.boolean(),
  change: z.enum(SIGNATURE_CHANGE_STATES),
});
export type MySignatureView = z.infer<typeof MySignatureViewSchema>;
