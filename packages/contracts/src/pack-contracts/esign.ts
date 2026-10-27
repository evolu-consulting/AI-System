// cf-esign-docusign · ký số HĐ, trung lập nhà cung cấp (DocuSign / ký thử selfsign / CA VN sau này): contract `/pack/contracts/contracts/:id/esign*` + `/pack/contracts/esign/settings`.
import { z } from "zod";

/** Mã lỗi ⇒ HTTP status. */
export const ESIGN_ERRORS = {
  /** Thiếu cấu hình nhà cung cấp ký số ở server hoặc công ty chưa bật ký số. */
  ESIGN_DISABLED: 409,
  /** HĐ chưa duyệt xong (chưa khoá) / đã có envelope đang chờ / không có envelope đang chờ. */
  ESIGN_STATE: 409,
  /** Tệp HĐ không phải PDF (DOCX/ảnh chưa hỗ trợ) hoặc không có tệp. */
  ESIGN_UNSUPPORTED_FILE: 422,
  /** Nhà cung cấp ký số / FileBox lỗi hoặc không phản hồi. */
  ESIGN_PROVIDER: 502,
  /** Webhook: chữ ký HMAC sai/thiếu, hoặc server chưa đặt khoá HMAC. */
  ESIGN_WEBHOOK_REJECTED: 401,
  /** esign-multi · nhà cung cấp chỉ định không có / không khả dụng (thiếu cấu hình) / sai loại. */
  ESIGN_PROVIDER_UNAVAILABLE: 422,
  /** esign-multi · tài khoản gửi ký (người ký phía công ty) không có email. */
  ESIGN_SIGNER_NO_EMAIL: 422,
  /** esign-multi · "Ký ngay" chỉ cho đúng người ký phía công ty của phong bì. */
  ESIGN_NOT_SIGNER: 403,
} as const;
export type ESignErrorCode = keyof typeof ESIGN_ERRORS;

export const ESIGN_STATUSES = ["sent", "delivered", "completed", "declined", "voided"] as const;
export type ESignStatus = (typeof ESIGN_STATUSES)[number];

const Name = z
  .string()
  .transform((v) => v.trim().normalize("NFC"))
  .pipe(z.string().min(1).max(100));
const Email = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email().max(200));

/** Khoá nhà cung cấp (khớp CHECK `provider` của 0054). */
export const ESignProviderKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,30}$/)
  .max(31);

/** esign-multi · người ký phía công ty = CHÍNH tài khoản bấm "Gửi ký": server lấy họ tên + email từ tài khoản, bỏ qua
 *  name/email client gửi (vẫn nhận để tương thích UI cũ). Đối tác: họ tên + email bắt buộc. */
export const ESignSignerSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("company"),
    name: z.string().max(200).optional(),
    email: z.string().max(300).optional(),
  }),
  z.strictObject({ role: z.literal("partner"), name: Name, email: Email }),
]);
export type ESignSignerIn = z.infer<typeof ESignSignerSchema>;

/** Gửi ký: người ký theo THỨ TỰ ký (tuần tự); tối đa MỘT người ký phía công ty. `provider` vắng ⇒ mặc định của công ty. */
export const ESignSendSchema = z
  .strictObject({
    signers: z.array(ESignSignerSchema).min(1).max(4),
    provider: ESignProviderKey.optional(),
  })
  .refine((b) => b.signers.filter((s) => s.role === "company").length <= 1, {
    message: "one company signer",
    path: ["signers"],
  });
export type ESignSendIn = z.infer<typeof ESignSendSchema>;

export const ESignVoidSchema = z.strictObject({
  reason: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(200)),
});

/** "Ký ngay" (người ký nội bộ): trang quay về sau khi ký (phải là http(s) và trỏ về chính HĐ). */
/** esign-multi · `provider` tuỳ chọn chỉ cho phong bì loại "ca" (hệ thống điều phối, mỗi người ký chọn chứng thư lúc ký). */
export const ESignSignUrlSchema = z.strictObject({
  return_url: z.url().max(500),
  provider: ESignProviderKey.optional(),
});

/** esign-multi · bật/tắt và/hoặc nhà cung cấp mặc định (phải khả dụng) — ít nhất một trường. */
export const ESignSettingsSchema = z
  .strictObject({ enabled: z.boolean().optional(), default_provider: ESignProviderKey.optional() })
  .refine((b) => b.enabled !== undefined || b.default_provider !== undefined, {
    message: "empty",
  });
export type ESignSettingsIn = z.infer<typeof ESignSettingsSchema>;

/** esign-multi · "envelope" = cả luồng ký trên nền tảng nhà cung cấp (DocuSign, chọn lúc gửi); "ca" = hệ thống mình điều phối,
 *  mỗi người ký chọn chứng thư lúc ký (selfsign, MISA, VNPT SmartCA… — lát `esign-cks`). */
export type ESignProviderKind = "envelope" | "ca";

export type ESignProviderOut = {
  key: string;
  label: string;
  kind: ESignProviderKind;
  /** Đủ cấu hình ở server ⇒ chọn được. */
  available: boolean;
  /** Có giá trị pháp lý (ký thử ⇒ false). */
  legal: boolean;
};

export type ESignSettingsOut = {
  /** Server có ít nhất một nhà cung cấp khả dụng. */
  configured: boolean;
  /** Công ty bật ký số (Cài đặt). */
  enabled: boolean;
  /** Nhà cung cấp mặc định HIỆU LỰC (đã chọn và còn khả dụng, vắng ⇒ khả dụng đầu tiên), null khi chưa cấu hình. */
  provider: string | null;
  /** Mặc định hiệu lực là ký thử (demo) — không có giá trị pháp lý. */
  demo: boolean;
  /** esign-multi · nhà cung cấp server liệt kê (`ESIGN_PROVIDERS`, theo thứ tự). */
  providers: ESignProviderOut[];
  /** esign-multi · = `provider` (mặc định hiệu lực của công ty). */
  default_provider: string | null;
};

export type ESignSignerOut = {
  role: "company" | "partner";
  name: string;
  email: string;
  order: number;
  /** Người ký nội bộ ký ngay trong app (embedded). */
  embedded: boolean;
  status: string | null;
  signed_at: string | null;
  /** esign-multi · nhà cung cấp/chứng thư người này dùng khi ký (phong bì loại "ca"); null = theo phong bì. */
  provider: string | null;
  certificate_ref: string | null;
};

export type ESignEnvelopeOut = {
  id: string;
  provider: string;
  /** esign-multi · nhãn nhà cung cấp của phong bì (lưu trên phong bì, không theo mặc định hiện tại). */
  provider_label: string;
  /** Envelope ký thử (selfsign) — không có giá trị pháp lý. */
  demo: boolean;
  status: ESignStatus;
  signers: ESignSignerOut[];
  reason: string | null;
  completed_at: string | null;
  created_at: string;
  /** Có "Bản đã ký" (tải qua `/contracts/:id/esign/signed`). */
  has_signed_file: boolean;
};

export type ESignStateOut = ESignSettingsOut & {
  /** HĐ đã duyệt xong (đã khoá) và có tệp PDF. */
  ready: boolean;
  envelope: ESignEnvelopeOut | null;
  /** Người ký gợi ý (sửa được). */
  defaults: { role: "company" | "partner"; name: string; email: string }[];
};
