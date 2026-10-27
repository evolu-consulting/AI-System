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

export const ESignSignerSchema = z.strictObject({
  role: z.enum(["company", "partner"]),
  name: Name,
  email: Email,
});
export type ESignSignerIn = z.infer<typeof ESignSignerSchema>;

/** Gửi ký: người ký theo THỨ TỰ ký (tuần tự). */
export const ESignSendSchema = z.strictObject({
  signers: z.array(ESignSignerSchema).min(1).max(4),
});
export type ESignSendIn = z.infer<typeof ESignSendSchema>;

export const ESignVoidSchema = z.strictObject({
  reason: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(200)),
});

/** "Ký ngay" (người ký nội bộ): trang quay về sau khi ký (phải là http(s) và trỏ về chính HĐ). */
export const ESignSignUrlSchema = z.strictObject({ return_url: z.url().max(500) });

export const ESignSettingsSchema = z.strictObject({ enabled: z.boolean() });

export type ESignSettingsOut = {
  /** Server có đủ cấu hình DocuSign. */
  configured: boolean;
  /** Công ty bật ký số (Cài đặt). */
  enabled: boolean;
  /** Nhà cung cấp đang dùng (`ESIGN_PROVIDER`), null khi chưa cấu hình. */
  provider: string | null;
  /** Ký thử (demo) — không có giá trị pháp lý. */
  demo: boolean;
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
};

export type ESignEnvelopeOut = {
  id: string;
  provider: string;
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
