// CR-181 · lát s1 · lõi chung «Chữ ký nội bộ»: giá trị cho phép + thiết lập theo công ty + hình dạng «Chữ ký của tôi».
// Khớp CHECK ở hub 0155 (`user_signatures_*_ck`, `signature_settings_*_ck`). Đổi giá trị ⇒ migration mới sửa CHECK.
// Route (lát s2, `apps/hub-api/src/modules/signatures`) dùng lại các schema này; ảnh KHÔNG đi kèm khi ký tài liệu (BR-K3) — chỉ máy chủ lấy từ DB.
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
/** Kích thước ảnh tối đa (điểm ảnh): đọc từ IHDR, chặn «PNG nhỏ khai khổng lồ» làm máy chủ in cấp canvas cỡ GB. */
export const SIGNATURE_PNG_MAX_WIDTH = 2000;
export const SIGNATURE_PNG_MAX_HEIGHT = 1000;
export const SIGNATURE_PROVIDER_MAX = 60;

/** Rộng × cao khai trong IHDR của PNG (chỉ đọc 24 byte đầu, không giải mã). Không phải PNG / IHDR sai / 0 ⇒ null. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const sigOk = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
  if (bytes.length < 24 || !sigOk) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(8) !== 13 || v.getUint32(12) !== 0x49484452) return null; // độ dài 13 + "IHDR"
  const width = v.getUint32(16);
  const height = v.getUint32(20);
  return width === 0 || height === 0 ? null : { width, height };
}

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

/** CR-188 · dòng dưới chữ ký tối đa 200 ký tự (khớp `user_signatures_caption_ck`). */
export const SIGNATURE_CAPTION_MAX = 200;

/** Một chữ ký của tôi: ảnh là data URL PNG (nét đen, nền trong suốt). `caption` = dòng dưới chữ ký đã lưu (null ⇒ máy chủ dựng từ hồ sơ lúc ký). */
export const MySignatureItemSchema = z.strictObject({
  id: UuidSchema,
  kind: SignatureKindSchema,
  method: SignatureMethodSchema,
  image: z.string().startsWith("data:image/png;base64,"),
  created_at: IsoDateTime,
  caption: z.string().max(SIGNATURE_CAPTION_MAX).nullable(),
});
export type MySignatureItem = z.infer<typeof MySignatureItemSchema>;

/** Trạng thái xin đổi: `none` chưa xin · `requested` chờ quản trị · `granted` được đổi một lần. */
export const SIGNATURE_CHANGE_STATES = ["none", "requested", "granted"] as const;
export const SignatureChangeStateSchema = z.enum(SIGNATURE_CHANGE_STATES);
export type SignatureChangeState = z.infer<typeof SignatureChangeStateSchema>;

/** Một dòng lịch sử của tôi (không kèm ảnh). `retired_at` = ngày dùng tới; null = đang dùng. */
export const MySignatureHistoryRowSchema = z.strictObject({
  id: UuidSchema,
  kind: SignatureKindSchema,
  method: SignatureMethodSchema,
  created_at: IsoDateTime,
  retired_at: IsoDateTime.nullable(),
});
export type MySignatureHistoryRow = z.infer<typeof MySignatureHistoryRowSchema>;

/** Chữ ký số (Q12): đợt 1 luôn `{ enabled:false, assigned:false }` — màn ký hiện khoá kèm lý do. */
export const MyDigitalStatusSchema = z.strictObject({
  enabled: z.boolean(),
  assigned: z.boolean(),
});

/**
 * `GET /me/signature`.
 * - `needs_create` = `on_doc_enabled` ∧ (chưa có bản main đang dùng ∨ cách tạo của bản main đã bị bỏ khỏi `methods` ∨
 *   (`initials = own` ∧ chưa có/đã bỏ cách tạo của bản initials)). `settings.required` quyết định có nút «Làm sau» (false ⇒ có).
 * - `can_change` = bấm «Đổi chữ ký» được ngay: `change_policy = self` ∨ có quyền đổi chưa dùng (`change = granted`) ∨ `needs_create`.
 */
export const MySignatureViewSchema = z.strictObject({
  settings: SignatureSettingsSchema,
  main: MySignatureItemSchema.nullable(),
  initials: MySignatureItemSchema.nullable(),
  history: z.array(MySignatureHistoryRowSchema),
  needs_create: z.boolean(),
  change: SignatureChangeStateSchema,
  can_change: z.boolean(),
  digital: MyDigitalStatusSchema,
  /** CR-188 · «Họ tên · Chức vụ · Phòng ban» dựng từ hồ sơ của tôi — điền sẵn ô «Dòng dưới chữ ký» (null ⇒ hồ sơ trống). */
  profile_caption: z.string().max(SIGNATURE_CAPTION_MAX).nullable(),
});
export type MySignatureView = z.infer<typeof MySignatureViewSchema>;

/** Base64 của PNG ≤ 200 KiB dài ≤ 273 068 ký tự; cho dư để vượt hạn trả 413 (không phải 400). */
export const SIGNATURE_PNG_BASE64_MAX_CHARS = 400_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** `POST /me/signature` — KHÔNG có tham số người dùng (BR-K2): chỉ tạo cho chính người gọi. */
export const CreateSignatureBodySchema = z.strictObject({
  kind: SignatureKindSchema,
  method: SignatureMethodSchema,
  /** PNG nét đen nền trong suốt (Q18), base64 thuần (không tiền tố data URL). */
  png: z
    .string()
    .min(8)
    .max(SIGNATURE_PNG_BASE64_MAX_CHARS)
    .regex(BASE64_RE, "phải là base64")
    .refine((v) => v.length % 4 === 0, "base64 sai độ dài"),
  /** CR-188 · dòng dưới chữ ký (≤ 200); thiếu/rỗng ⇒ lưu null ⇒ máy chủ dựng từ hồ sơ lúc ký. */
  caption: z.string().trim().max(SIGNATURE_CAPTION_MAX).nullish(),
});
export type CreateSignatureBody = z.infer<typeof CreateSignatureBodySchema>;

/** 201 của `POST /me/signature`: bản mới + id bản cũ vừa chuyển vào lịch sử (null = lần tạo đầu). */
export const CreateSignatureResponseSchema = z.strictObject({
  signature: MySignatureItemSchema,
  replaced_id: UuidSchema.nullable(),
});
export type CreateSignatureResponse = z.infer<typeof CreateSignatureResponseSchema>;

/** `POST /me/signature/change-request` → 201 (yêu cầu mới, đã báo chuông) | 200 (đã có yêu cầu / đã được cho phép, không báo lại). */
export const ChangeRequestResponseSchema = z.strictObject({
  change: z.enum(["requested", "granted"]),
  requested_at: IsoDateTime,
});
export type ChangeRequestResponse = z.infer<typeof ChangeRequestResponseSchema>;

/** `GET|PUT /company/signature-settings`. PUT nhận đúng `SignatureSettingsSchema` (strict, thay cả bộ). */
export const SignatureSettingsViewSchema = z.strictObject({
  settings: SignatureSettingsSchema,
  /** false ⇒ chưa lưu lần nào, `settings` là mặc định. */
  stored: z.boolean(),
  updated_by: UuidSchema.nullable(),
  updated_at: IsoDateTime.nullable(),
  /** Người gọi có sửa được không (Q15) — để web ẩn nút Lưu. */
  can_edit: z.boolean(),
});
export type SignatureSettingsView = z.infer<typeof SignatureSettingsViewSchema>;

/** `GET /company/signature-change-requests?limit=` (quản trị). */
export const SIGNATURE_CHANGE_LIST_MAX = 200;
export const SignatureChangeListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(SIGNATURE_CHANGE_LIST_MAX).default(100),
});
export const SignatureChangeRequestItemSchema = z.strictObject({
  user_id: UuidSchema,
  name: z.string(),
  requested_at: IsoDateTime,
  /** null = chưa cho phép. */
  granted_at: IsoDateTime.nullable(),
  granted_by: UuidSchema.nullable(),
});
export const SignatureChangeListSchema = z.strictObject({
  items: z.array(SignatureChangeRequestItemSchema),
});
export type SignatureChangeList = z.infer<typeof SignatureChangeListSchema>;

/** `POST /company/signature-change-grants` {user_id} (quản trị; không tự cấp cho mình). 201 lần đầu cho phép · 200 đã cho phép từ trước. */
export const GrantChangeBodySchema = z.strictObject({ user_id: UuidSchema });
export const GrantChangeResponseSchema = z.strictObject({
  user_id: UuidSchema,
  granted_at: IsoDateTime,
});
export type GrantChangeResponse = z.infer<typeof GrantChangeResponseSchema>;

/** Mã lỗi + HTTP status của API chữ ký (ngoài VALIDATION_ERROR 400 / AUTH_EXPIRED 401 chung). */
export const SIGNATURE_API_ERRORS = {
  SIGNATURE_FORBIDDEN: 403, // không phải quản trị công ty (BR-G1)
  SIGNATURE_CHANGE_NOT_ALLOWED: 403, // change_policy=admin, đã có chữ ký, chưa được cho phép (Q10)
  SIGNATURE_TOO_LARGE: 413, // PNG > SIGNATURE_PNG_MAX_BYTES
  SIGNATURE_NOT_PNG: 415, // không phải PNG thật (magic bytes + IHDR)
  SIGNATURE_IMAGE_TOO_LARGE: 422, // rộng > SIGNATURE_PNG_MAX_WIDTH hoặc cao > SIGNATURE_PNG_MAX_HEIGHT (khác SIGNATURE_TOO_LARGE 413 = quá dung lượng)
  SIGNATURE_METHOD_NOT_ALLOWED: 422, // cách tạo ngoài `methods` của công ty (BR-K4)
  SIGNATURE_INITIALS_NOT_ALLOWED: 422, // kind=initials khi công ty không chọn `initials = own`
  SIGNATURE_CHANGE_NOT_NEEDED: 409, // xin đổi khi không cần (policy self / chưa có chữ ký)
  SIGNATURE_USER_NOT_FOUND: 404, // cho phép đổi cho người ngoài công ty
  SIGNATURE_SELF_GRANT: 403, // quản trị tự cấp cho chính mình
} as const;
export type SignatureApiErrorCode = keyof typeof SIGNATURE_API_ERRORS;
