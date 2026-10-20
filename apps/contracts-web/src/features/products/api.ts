// V2-J1 · SP-01/02/07 · CD-06: điểm kinh doanh + danh sách / chi tiết SP (`/pack/contracts/business/*`). Khoá truy vấn bắt đầu `business`.
import type { BizConfigOut, BizContractOut, BizDetailOut, BizListOut } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/business";

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
