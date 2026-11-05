// V2-J2 · SP-04/05/06: tab "Nhà cung cấp & giá" của chi tiết sản phẩm (`/pack/contracts/products/:id/suppliers…`).
import type {
  PriceScoutOverride,
  PriceScoutProductOut,
  QuoteReadOut,
  SupplierOverviewOut,
  SupplierPriceInput,
  SupplierSearchOut,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/products";

export const supplierKeys = {
  overview: (id: string) => ["products", id, "suppliers"] as const,
  scout: (id: string) => ["products", id, "price-scout"] as const,
};

/** price-scout · cấu hình dò giá của SP (`GET|PUT /products/:id/price-scout`); PUT `{}` = theo mặc định nhóm. */
export const fetchProductScout = (id: string, signal?: AbortSignal) =>
  api<PriceScoutProductOut>(`${BASE}/${id}/price-scout`, { signal });
export const saveProductScout = (id: string, body: PriceScoutOverride) =>
  api<PriceScoutProductOut>(`${BASE}/${id}/price-scout`, { method: "PUT", body });

export const fetchSuppliers = (id: string, signal?: AbortSignal) =>
  api<SupplierOverviewOut>(`${BASE}/${id}/suppliers`, { signal });
/** AI tìm giá — chỉ gọi khi người dùng bấm; thân rỗng (tên SP lấy từ máy chủ). */
export const searchSuppliers = (id: string) =>
  api<SupplierSearchOut>(`${BASE}/${id}/suppliers/search`, { method: "POST", body: {} });
export const saveSupplierPrices = (id: string, items: SupplierPriceInput[]) =>
  api<{ ids: string[] }>(`${BASE}/${id}/supplier-prices`, { method: "POST", body: { items } });
export const deleteSupplierPrice = (id: string, priceId: string) =>
  api<void>(`${BASE}/${id}/supplier-prices/${priceId}`, { method: "DELETE" });

/** gap-d1 #21 · tải báo giá (PDF/văn bản): AI đọc ⇒ dòng giá chưa lưu. */
export function readQuote(id: string, file: File): Promise<QuoteReadOut> {
  const form = new FormData();
  form.append("file", file);
  return api<QuoteReadOut>(`${BASE}/${id}/supplier-prices/read-quote`, {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
}
/** gap-d1 #22 · thêm NCC vào danh bạ Đối tác (`POST /companies`). */
export const addCompany = (body: { name: string; tax_id?: string }) =>
  api<unknown>("/pack/contracts/companies", { method: "POST", body });
