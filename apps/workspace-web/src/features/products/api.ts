// V2-J1 · SP-01/02/07 · CD-06: điểm kinh doanh + danh sách / chi tiết SP (`/pack/contracts/business/*`). Khoá truy vấn bắt đầu `business`.
// V2-H · SP-03: khách đang dùng của một SP + "Nhắc gia hạn" (việc vào Cần xử lý) + số ngày nhắc mặc định (Cài đặt).
import type {
  BizConfigOut,
  BizContractOut,
  BizDetailOut,
  BizListOut,
  BusinessSettings,
  RenewalRemindOut,
  ServiceCustomersOut,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const PACK = "/pack/contracts";
const BASE = `${PACK}/business`;

export const bizKeys = {
  list: ["business", "products"] as const,
  detail: (id: string) => ["business", "product", id] as const,
  contracts: (id: string) => ["business", "product", id, "contracts"] as const,
  config: ["business", "config"] as const,
};

export const fetchBizProducts = (signal?: AbortSignal) =>
  api<BizListOut>(`${BASE}/products`, { signal });
export const fetchBizDetail = (id: string, signal?: AbortSignal) =>
  api<BizDetailOut>(`${BASE}/products/${id}`, { signal });
export const fetchBizContracts = (id: string, signal?: AbortSignal) =>
  api<{ items: BizContractOut[] }>(`${BASE}/products/${id}/contracts`, { signal });
export const fetchBizConfig = (signal?: AbortSignal) =>
  api<BizConfigOut>(`${BASE}/config`, { signal });

// ---------- V2-H ----------
export const customersKey = (productId: string) => ["products", productId, "customers"] as const;
export const BUSINESS_SETTINGS_KEY = ["business-settings"] as const;

/** Lấy cả tập (đếm từng nhóm cho nút lọc); lọc ở máy khách để đổi nhóm không gọi lại. */
export const fetchServiceCustomers = (
  productId: string,
  signal?: AbortSignal,
): Promise<ServiceCustomersOut> =>
  api<ServiceCustomersOut>(`${PACK}/products/${encodeURIComponent(productId)}/customers`, {
    signal,
  });

export const remindRenewal = (productId: string, customerId: string): Promise<RenewalRemindOut> =>
  api<RenewalRemindOut>(
    `${PACK}/products/${encodeURIComponent(productId)}/customers/${encodeURIComponent(customerId)}/remind`,
    { method: "POST", body: {} },
  );

export const fetchBusinessSettings = (signal?: AbortSignal): Promise<BusinessSettings> =>
  api<BusinessSettings>(`${PACK}/business-settings`, { signal });
