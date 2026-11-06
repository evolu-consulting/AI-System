// V2-F · HD-10 · 5.5: API form hợp đồng — gợi ý đối tác (V2-C `partners/lookup`), danh mục SP + gợi ý dòng (V2-B `products`).
import type {
  ContractDeal,
  PartnerLookup,
  PartnerRoleV2,
  PartnerSearchHit,
  ProductCreate,
  ProductMatchOut,
  ProductOut,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";

export const lookupKey = (name: string, taxId: string, deal: ContractDeal) =>
  ["partner-lookup", name, taxId, deal] as const;
export const PRODUCTS_KEY = ["products", "catalog"] as const;

export function lookupPartner(
  name: string,
  taxId: string,
  deal: ContractDeal,
  signal?: AbortSignal,
): Promise<PartnerLookup> {
  const u = new URLSearchParams({ name, deal });
  if (taxId.trim()) u.set("tax_id", taxId.trim());
  return api<PartnerLookup>(`${BASE}/partners/lookup?${u}`, { signal });
}

/** CR-122 p10: tìm trong sổ đối tác (server giới hạn + index), lọc vai theo loại HĐ. */
export function searchPartners(
  q: string,
  role: PartnerRoleV2,
  signal?: AbortSignal,
  limit = 20,
): Promise<PartnerSearchHit[]> {
  const u = new URLSearchParams({ q, role, limit: String(limit) });
  return api<PartnerSearchHit[]>(`${BASE}/partners/search?${u}`, { signal });
}

export const fetchProducts = async (signal?: AbortSignal): Promise<ProductOut[]> =>
  (await api<{ items: ProductOut[] }>(`${BASE}/products?limit=200`, { signal })).items;

export const matchProduct = (text: string, deal: ContractDeal): Promise<ProductMatchOut> =>
  api<ProductMatchOut>(`${BASE}/products/match`, { method: "POST", body: { text, deal } });

export const createProduct = (body: ProductCreate): Promise<ProductOut> =>
  api<ProductOut>(`${BASE}/products`, { method: "POST", body });
