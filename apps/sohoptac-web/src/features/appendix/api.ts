// HD-FR-54 · HD-FR-55 · S05: phụ lục gắn HĐ gốc (gợi ý + chọn tay) và bảng giá áp phụ lục.
import type {
  AttachParentResponse,
  ContractListResponse,
  ContractPricesResponse,
  ParentSuggestionsResponse,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";
const at = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const suggestionsKey = (id: string) => ["contract", id, "parent-suggestions"] as const;
export const pricesKey = (id: string) => ["contract", id, "prices"] as const;

export const fetchSuggestions = (id: string, signal?: AbortSignal) =>
  api<ParentSuggestionsResponse>(`${at(id)}/parent-suggestions`, { signal });
export const fetchPrices = (id: string, signal?: AbortSignal) =>
  api<ContractPricesResponse>(`${at(id)}/prices`, { signal });
export const attachParent = (id: string, version: number, parentId: string | null) =>
  api<AttachParentResponse>(`${at(id)}/parent`, {
    method: "PATCH",
    body: { version, parent_id: parentId },
  });
/** Chọn tay: tìm HĐ gốc theo chữ (≥ 2 ký tự), chỉ loại `contract`. */
export const searchParents = (q: string, signal?: AbortSignal) =>
  api<ContractListResponse>(
    `${BASE}?${new URLSearchParams({ q, kind: "contract", page_size: "5" }).toString()}`,
    { signal },
  );
