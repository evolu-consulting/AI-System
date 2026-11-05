// gap-d1 · Sản phẩm & Giá: tạo SP tay, kho + lô, quy tắc nhận diện, cách lấy hàng (`/pack/contracts/products…`). Khoá truy vấn bắt đầu `catalog`.
import type {
  ProductCreate,
  ProductDetailOut,
  ProductLotCreate,
  ProductLotResultOut,
  ProductOut,
  ProductRuleCreate,
  ProductRuleOut,
  ProductSourceCreate,
  ProductSourceOut,
  ProductSourcesOut,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/products";

export const catalogKeys = {
  detail: (id: string) => ["catalog", "product", id] as const,
  sources: (id: string) => ["catalog", "product", id, "sources"] as const,
};

export const createProduct = (body: ProductCreate) =>
  api<ProductOut>(BASE, { method: "POST", body });
export const fetchProduct = (id: string, signal?: AbortSignal) =>
  api<ProductDetailOut>(`${BASE}/${id}`, { signal });
export const addLot = (id: string, body: ProductLotCreate) =>
  api<ProductLotResultOut>(`${BASE}/${id}/lots`, { method: "POST", body });
export const addRule = (id: string, body: ProductRuleCreate) =>
  api<ProductRuleOut>(`${BASE}/${id}/rules`, { method: "POST", body });
export const deleteRule = (id: string, ruleId: string) =>
  api<void>(`${BASE}/${id}/rules/${ruleId}`, { method: "DELETE" });
export const fetchSources = (id: string, signal?: AbortSignal) =>
  api<ProductSourcesOut>(`${BASE}/${id}/sources`, { signal });
export const addSource = (id: string, body: ProductSourceCreate) =>
  api<ProductSourceOut>(`${BASE}/${id}/sources`, { method: "POST", body });
export const deleteSource = (id: string, sourceId: string) =>
  api<void>(`${BASE}/${id}/sources/${sourceId}`, { method: "DELETE" });
