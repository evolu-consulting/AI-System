// CR-124 · q3 · FLOW4-FR-01/15 · cổng cấu hình node «Gửi đối tác xác nhận» (MỘT nguồn: cũng là schema args tool `contracts-partner-send`).
// Giá trị đơn (text/number) như node Ký số để panel chung dựng ô nhập và `args` HẰNG của stage lưu được; danh sách trường gửi kèm là
// chuỗi `a,b,c`. Chỉ zod, không I/O (luật `contracts-only-zod`).
import { z } from "zod";

/** Mức quan trọng A gợi ý; `auto` = theo giá trị HĐ (spec §3). Mức cuối do BÊN NHẬN quyết (max(gợi ý, luật bên nhận), §6). */
export const PARTNER_IMPORTANCE = ["auto", "normal", "important", "critical"] as const;
export type PartnerImportance = (typeof PARTNER_IMPORTANCE)[number];

/** Trường HĐ được phép gửi kèm (PDF HĐ luôn có). Khoá = khoá `contracts.fields`. */
export const PARTNER_SEND_FIELDS = [
  "total_value",
  "start_date",
  "end_date",
  "payment_term",
] as const;
export type PartnerSendField = (typeof PARTNER_SEND_FIELDS)[number];

export const PARTNER_REPLY_DAYS_DEFAULT = 7;
export const PARTNER_REPLY_DAYS_MAX = 30;

export const PartnerSendConfigSchema = z.object({
  /** Mã HĐ (đầu vào của flow, không phải ô cấu hình). */
  contract_id: z.string().optional(),
  importance: z.enum(PARTNER_IMPORTANCE).optional().describe("Mức quan trọng"),
  /** `total_value,end_date` — tập con của `PARTNER_SEND_FIELDS`. */
  send_fields: z
    .string()
    .max(120)
    .regex(/^[a-z_]+(,[a-z_]+)*$/)
    .optional()
    .describe("Gửi kèm (PDF luôn có): total_value, start_date, end_date, payment_term"),
  reply_days: z.coerce
    .number()
    .int()
    .min(1)
    .max(PARTNER_REPLY_DAYS_MAX)
    .optional()
    .describe("Hạn trả lời (ngày)"),
  message: z.string().max(1000).optional().describe("Lời nhắn"),
  /** Đổi đối tác so với HĐ (chọn từ danh bạ, q4). Vắng ⇒ lấy từ HĐ. */
  partner_tax_code: z
    .string()
    .regex(/^\d{10}(-\d{3})?$/)
    .optional()
    .describe("Gửi cho — mã số thuế (mặc định lấy từ hợp đồng)"),
  partner_email: z
    .string()
    .max(320)
    .email()
    .optional()
    .describe("Email liên hệ (mặc định lấy từ hợp đồng)"),
});
export type PartnerSendConfig = z.infer<typeof PartnerSendConfigSchema>;

/** `send_fields` ⇒ danh sách khoá hợp lệ (bỏ khoá lạ, bỏ trùng). */
export function parseSendFields(s: string | undefined): PartnerSendField[] {
  const ok = new Set<string>(PARTNER_SEND_FIELDS);
  return [...new Set((s ?? "").split(",").filter((k) => ok.has(k)))] as PartnerSendField[];
}
