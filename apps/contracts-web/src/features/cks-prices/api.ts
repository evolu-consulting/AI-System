// HD-FR-96 · S08: giá CKS mua–bán (`GET /pack/contracts/cks/prices`). "Dò giá" (`/cks/scans`) đã gỡ ở V2-J2 — thay bằng
// "Tìm giá trên thị trường" ở tab NCC & giá của sản phẩm (`features/product-suppliers`).
import type { CksPackageFilter, CksPrices } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/cks";
export const pricesKey = (f: CksPackageFilter) => ["cks", "prices", f] as const;

export const fetchCksPrices = (filter: CksPackageFilter, signal?: AbortSignal) =>
  api<CksPrices>(`${BASE}/prices?filter=${encodeURIComponent(filter)}`, { signal });
