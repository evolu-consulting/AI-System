// V2-H · BA v2 §3.3 SP-03 · §5.8 · §5.9: "Khách đang dùng" của SP dịch vụ có hạn + "Nhắc gia hạn" ⇒ việc "Liên hệ mời gia hạn" trong
// Cần xử lý (đóng bằng `POST /my-work/followups/:id/done`) + Cài đặt kinh doanh (số ngày nhắc mặc định, 60).
// `GET /pack/contracts/products/:id/customers?status=`, `POST /products/:id/customers/:customerId/remind`,
// `GET|PUT /pack/contracts/business-settings`.
import { z } from "zod";

export const SERVICE_CUSTOMER_STATUSES = ["expired", "soon", "active"] as const;
export type ServiceCustomerStatus = (typeof SERVICE_CUSTOMER_STATUSES)[number];
export const RENEWAL_NOTICE_DEFAULT = 60;

export const ServiceCustomersQuerySchema = z.strictObject({
  status: z.enum([...SERVICE_CUSTOMER_STATUSES, "all"]).optional(),
});

export type ServiceCustomer = {
  id: string;
  customer_name: string | null;
  party_key: string;
  contract_id: string;
  contract_number: string | null;
  contract_title: string | null;
  started_on: string | null;
  expires_on: string | null;
  /** Số ngày nhắc áp cho dòng: của HĐ, vắng ⇒ mặc định Cài đặt. */
  notice_days: number;
  /** Âm = đã hết; null = HĐ không có ngày kết thúc. */
  days_left: number | null;
  status: ServiceCustomerStatus;
  /** "Gia hạn qua mình" (V2-D). */
  renewals: number;
  /** Mình đã có việc "Liên hệ mời gia hạn" chưa xong cho khách này. */
  reminded: boolean;
};

export type ServiceCustomersOut = {
  product: { id: string; name: string; group: string };
  today: string;
  notice_default: number;
  counts: Record<ServiceCustomerStatus | "all", number>;
  items: ServiceCustomer[];
  truncated: boolean;
};

export type RenewalRemindOut = { id: string; title: string };

export const BusinessSettingsSchema = z.strictObject({
  renewal_notice_days: z.number().int().min(0).max(3650),
});
export type BusinessSettings = z.infer<typeof BusinessSettingsSchema>;
