// V2-J2 · SP-04/05/06: tab "Nhà cung cấp & giá" của chi tiết sản phẩm (`/pack/contracts/products/:id/suppliers…`).
import type { SupplierOverviewOut, SupplierPriceInput, SupplierSearchOut } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/products";

export const supplierKeys = {
  overview: (id: string) => ["products", id, "suppliers"] as const,
};

export const fetchSuppliers = (id: string, signal?: AbortSignal) =>
  api<SupplierOverviewOut>(`${BASE}/${id}/suppliers`, { signal });
/** AI tìm giá — chỉ gọi khi người dùng bấm; thân rỗng (tên SP lấy từ máy chủ). */
export const searchSuppliers = (id: string) =>
  api<SupplierSearchOut>(`${BASE}/${id}/suppliers/search`, { method: "POST", body: {} });
export const saveSupplierPrices = (id: string, items: SupplierPriceInput[]) =>
  api<{ ids: string[] }>(`${BASE}/${id}/supplier-prices`, { method: "POST", body: { items } });
export const deleteSupplierPrice = (id: string, priceId: string) =>
  api<void>(`${BASE}/${id}/supplier-prices/${priceId}`, { method: "DELETE" });
