// CR-121 c21b (D4) · `POST /internal/mail` — admin-api gửi mail nền tảng QUA Hub (cấu hình mail chỉ ở kho secret Hub). Token dịch vụ
// `HUB_INTERNAL_TOKEN` (cùng cơ chế `/internal/test-run`). Thân KHÔNG có html (Hub gửi text); mọi object strict.
import { z } from "zod";
import { EmailSchema } from "../common";

export const MAIL_RELAY_TO_MAX = 50;
export const MAIL_RELAY_SUBJECT_MAX = 200;
export const MAIL_RELAY_TEXT_MAX_BYTES = 100 * 1024;

export const MailRelayRequestSchema = z.strictObject({
  to: z.array(EmailSchema).min(1).max(MAIL_RELAY_TO_MAX),
  subject: z
    .string()
    .min(1)
    .max(MAIL_RELAY_SUBJECT_MAX)
    .refine((s) => !/[\r\n]/.test(s)),
  text: z
    .string()
    .min(1)
    .refine((s) => new TextEncoder().encode(s).length <= MAIL_RELAY_TEXT_MAX_BYTES),
});
export type MailRelayRequest = z.infer<typeof MailRelayRequestSchema>;

/** `sent` = đã giao SMTP; `skipped` = miền dành riêng (không gửi thật, không phải lỗi). */
export const MailRelayResponseSchema = z.strictObject({
  sent: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type MailRelayResponse = z.infer<typeof MailRelayResponseSchema>;
