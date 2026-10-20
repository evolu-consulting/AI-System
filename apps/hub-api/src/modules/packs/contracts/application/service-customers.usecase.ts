// V2-H · SP-03 · §5.8 · §5.9: khách đang dùng của một SP (đọc theo luật thấy M1 — RLS `service_customers`), "Nhắc gia hạn" ⇒ việc
// "Liên hệ mời gia hạn" của chính người bấm trong Cần xử lý, Cài đặt kinh doanh (số ngày nhắc mặc định). Mỗi ca MỘT tx `PackUow`.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import {
  buildServiceCustomers,
  type RawServiceCustomer,
  RENEWAL_NOTICE_DEFAULT,
  renewalTaskTitle,
  SERVICE_CUSTOMERS_MAX,
  type ServiceCustomerRow,
  type ServiceCustomerStatus,
} from "../domain/service-customers.rules";

export type RawCustomersPage = {
  product: { id: string; name: string; group: string } | null;
  notice_default: number | null;
  rows: RawServiceCustomer[];
};

export type ServiceCustomersRepo = {
  /** Một câu: SP + mặc định Cài đặt + ≤ `limit` dòng khách thấy được. SP không có ⇒ `product` null. */
  page(productId: string, limit: number): Promise<RawCustomersPage>;
  /** Dòng khách thấy được của đúng SP; không có / không thấy / khác SP ⇒ null. */
  target(
    productId: string,
    customerId: string,
  ): Promise<{ customer_name: string | null; product_name: string; contract_id: string } | null>;
  /** Việc mở của mình cho khách này (bấm lại ⇒ giữ việc đang mở, không tạo trùng). */
  addTask(customerId: string, contractId: string, title: string): Promise<string>;
  noticeDefault(): Promise<number | null>;
  saveNoticeDefault(days: number): Promise<void>;
};
export type ServiceCustomersRepos = { serviceCustomers: ServiceCustomersRepo };

export class ServiceCustomersFail extends Error {
  constructor(readonly kind: "not_found") {
    super(kind);
  }
}

type Deps = {
  uow: PackUow<ServiceCustomersRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
};

export type CustomersOut = {
  product: { id: string; name: string; group: string };
  today: string;
  notice_default: number;
  counts: Record<ServiceCustomerStatus | "all", number>;
  items: ServiceCustomerRow[];
  truncated: boolean;
};

export function serviceCustomersUsecases(d: Deps) {
  const list = async (
    who: PackWho,
    productId: string,
    filter: ServiceCustomerStatus | "all",
  ): Promise<CustomersOut> => {
    const today = localDate(d.now(), await d.timeZoneOf(who.tenantId));
    const raw = await d.uow.tenant(who, ({ serviceCustomers: r }) =>
      r.page(productId, SERVICE_CUSTOMERS_MAX + 1),
    );
    if (!raw.product) throw new ServiceCustomersFail("not_found");
    const notice = raw.notice_default ?? RENEWAL_NOTICE_DEFAULT;
    const rows = raw.rows.slice(0, SERVICE_CUSTOMERS_MAX);
    const v = buildServiceCustomers(rows, today, notice, filter);
    return {
      product: raw.product,
      today,
      notice_default: notice,
      ...v,
      truncated: raw.rows.length > SERVICE_CUSTOMERS_MAX,
    };
  };
  const remind = async (who: PackWho, productId: string, customerId: string) => {
    const out = await d.uow.tenant(who, async ({ serviceCustomers: r }) => {
      const t = await r.target(productId, customerId);
      if (!t) return null;
      const title = renewalTaskTitle(t.customer_name, t.product_name);
      return { id: await r.addTask(customerId, t.contract_id, title), title };
    });
    if (!out) throw new ServiceCustomersFail("not_found");
    return out;
  };
  const settings = async (who: PackWho) => ({
    renewal_notice_days:
      (await d.uow.tenant(who, ({ serviceCustomers: r }) => r.noticeDefault())) ??
      RENEWAL_NOTICE_DEFAULT,
  });
  const saveSettings = async (who: PackWho, b: { renewal_notice_days: number }) => {
    await d.uow.tenant(who, ({ serviceCustomers: r }) =>
      r.saveNoticeDefault(b.renewal_notice_days),
    );
    return { renewal_notice_days: b.renewal_notice_days };
  };
  return { list, remind, settings, saveSettings };
}
export type ServiceCustomersUsecases = ReturnType<typeof serviceCustomersUsecases>;
