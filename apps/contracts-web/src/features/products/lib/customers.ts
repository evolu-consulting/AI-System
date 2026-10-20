// V2-H · tab "Khách đang dùng" (mockup NITI `custPanel`): nút lọc Tất cả / Hết hạn / Sắp hết hạn / Còn hạn kèm số, nhãn hạn
// "còn n ngày" / "đã hết n ngày", sắc thái trạng thái, khi nào hiện "Nhắc gia hạn". Thuần (máy chủ đã phân loại + sắp xếp).
import type { ServiceCustomer, ServiceCustomerStatus } from "@ai/contracts";
import type { TagTone } from "~/components/shared/tag";

export type CustomerFilter = ServiceCustomerStatus | "all";

export const CUSTOMER_FILTERS: readonly CustomerFilter[] = ["all", "expired", "soon", "active"];

export const STATUS_TONE: Record<ServiceCustomerStatus, TagTone> = {
  expired: "late",
  soon: "soon",
  active: "ok",
};

export const filterCustomers = (
  items: readonly ServiceCustomer[],
  f: CustomerFilter,
): ServiceCustomer[] => (f === "all" ? [...items] : items.filter((c) => c.status === f));

/** Nhãn phụ dưới ngày hết hạn: khoá i18n `contracts.svc.<key>` + số ngày. */
export function daysLabel(daysLeft: number | null): {
  key: "noEnd" | "over" | "today" | "left";
  n: number;
} {
  if (daysLeft === null) return { key: "noEnd", n: 0 };
  if (daysLeft < 0) return { key: "over", n: -daysLeft };
  return daysLeft === 0 ? { key: "today", n: 0 } : { key: "left", n: daysLeft };
}

/** Mockup: "Nhắc gia hạn" chỉ cho khách đã hết hạn hoặc sắp hết hạn. */
export const canRemind = (c: Pick<ServiceCustomer, "status">): boolean => c.status !== "active";
