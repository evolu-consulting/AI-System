// V2-H · BA v2 §3.3 SP-03 · §5.8: "Khách đang dùng" của một SP dịch vụ có hạn — phân loại Hết hạn / Sắp hết hạn / Còn hạn theo MỘT
// nguồn nhắc: "Nhắc trước khi hết hạn" của HĐ hiện tại của khách, vắng ⇒ mặc định Cài đặt (60 ngày). Thuần (không đọc đồng hồ:
// `today` là ngày lịch theo múi tenant do use case đưa vào). Kiểu riêng lớp domain (ADR-0023); DTO ở `@ai/contracts`.
import { daysBetween } from "./local-time.rules";

export const SERVICE_CUSTOMER_STATUSES = ["expired", "soon", "active"] as const;
export type ServiceCustomerStatus = (typeof SERVICE_CUSTOMER_STATUSES)[number];
export const RENEWAL_NOTICE_DEFAULT = 60;
/** Trần số dòng một lần đọc (đếm + lọc làm trên tập này; vượt ⇒ `truncated`). */
export const SERVICE_CUSTOMERS_MAX = 2000;

export type RawServiceCustomer = {
  id: string;
  customer_name: string | null;
  party_key: string;
  contract_id: string;
  contract_number: string | null;
  contract_title: string | null;
  started_on: string | null;
  expires_on: string | null;
  /** "Nhắc trước khi hết hạn" của HĐ (0…3650), null = HĐ không ghi. */
  notice_days: number | null;
  renewals: number;
  reminded: boolean;
};

export type ServiceCustomerRow = Omit<RawServiceCustomer, "notice_days"> & {
  notice_days: number;
  /** Ngày còn lại (âm = đã hết); null = HĐ không có ngày kết thúc. */
  days_left: number | null;
  status: ServiceCustomerStatus;
};

/** Hết hạn: hạn < hôm nay · Sắp hết hạn: còn ≤ số ngày nhắc · Còn hạn: còn lại (kể cả không có ngày kết thúc). */
export function statusOf(daysLeft: number | null, notice: number): ServiceCustomerStatus {
  if (daysLeft === null) return "active";
  if (daysLeft < 0) return "expired";
  return daysLeft <= notice ? "soon" : "active";
}

export function classify(
  r: RawServiceCustomer,
  today: string,
  noticeDefault: number,
): ServiceCustomerRow {
  const notice = r.notice_days ?? noticeDefault;
  const days = r.expires_on ? daysBetween(today, r.expires_on) : null;
  return { ...r, notice_days: notice, days_left: days, status: statusOf(days, notice) };
}

export type ServiceCustomersView = {
  counts: Record<ServiceCustomerStatus | "all", number>;
  items: ServiceCustomerRow[];
};

/** Phân loại, đếm theo trạng thái, lọc; sắp hết hạn / gần hạn nhất lên đầu (không có hạn xuống cuối) — như mockup. */
export function buildServiceCustomers(
  rows: readonly RawServiceCustomer[],
  today: string,
  noticeDefault: number,
  filter: ServiceCustomerStatus | "all",
): ServiceCustomersView {
  const all = rows.map((r) => classify(r, today, noticeDefault));
  const counts = { all: all.length, expired: 0, soon: 0, active: 0 };
  for (const r of all) counts[r.status] += 1;
  const items = (filter === "all" ? all : all.filter((r) => r.status === filter)).sort(
    (a, b) =>
      (a.days_left ?? Number.POSITIVE_INFINITY) - (b.days_left ?? Number.POSITIVE_INFINITY) ||
      a.id.localeCompare(b.id),
  );
  return { counts, items };
}

/** Tiêu đề việc "Liên hệ mời gia hạn" trong Cần xử lý (trần 200 = `hub.notifications.title`). */
export function renewalTaskTitle(customer: string | null, product: string): string {
  const who = customer?.trim() || "khách";
  return `Liên hệ ${who} mời gia hạn ${product.trim()}`.slice(0, 200);
}
