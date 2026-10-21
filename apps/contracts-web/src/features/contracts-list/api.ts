// HD-FR-51…53 · S03: danh sách HĐ phía server (HD1 `GET /contracts` + `/contracts/facets`), loại hàng, danh bạ, tải lên.
// Bearer + refresh do web-kit lo.
import type {
  CategoriesResponse,
  ContractCategory,
  ContractFacets,
  ContractListResponse,
  MembersResponse,
  UploadContractResponse,
} from "@ai/contracts";
import { api, apiResponse } from "@ai/web-kit/http";
import type { ExportFile } from "./lib/export-file";

const BASE = "/pack/contracts";

export const listKey = (qs: string) => ["contracts", "list", qs] as const;
export const FACETS_KEY = ["contracts", "facets"] as const;
export const CATEGORIES_KEY = ["contracts", "categories"] as const;
export const MEMBERS_KEY = ["contracts", "members"] as const;

export const fetchList = (qs: string, signal?: AbortSignal): Promise<ContractListResponse> =>
  api<ContractListResponse>(`${BASE}/contracts?${qs}`, { signal });
export const fetchFacets = (signal?: AbortSignal): Promise<ContractFacets> =>
  api<ContractFacets>(`${BASE}/contracts/facets`, { signal });
export const fetchCategories = (signal?: AbortSignal): Promise<CategoriesResponse> =>
  api<CategoriesResponse>(`${BASE}/categories`, { signal });
export const fetchMembers = (signal?: AbortSignal): Promise<MembersResponse> =>
  api<MembersResponse>(`${BASE}/members`, { signal });

export const createCategory = (name: string): Promise<ContractCategory> =>
  api<ContractCategory>(`${BASE}/categories`, { method: "POST", body: { name } });

/** `POST /pack/contracts/contracts` (multipart `file`); HĐ vào hàng đợi đọc, trả id để mở màn kiểm. */
export function uploadContract(file: File): Promise<UploadContractResponse> {
  const form = new FormData();
  form.append("file", file);
  return api<UploadContractResponse>(`${BASE}/contracts`, {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
}

/** Gap #8 · `GET /pack/contracts/contracts/export?…` (Bearer qua web-kit): tệp xlsx/csv theo đúng bộ lọc đang hiện. */
export async function exportContracts(qs: string, signal?: AbortSignal): Promise<ExportFile> {
  const res = await apiResponse(`${BASE}/contracts/export?${qs}`, { signal });
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  return {
    blob: await res.blob(),
    filename: name ?? "hop-dong",
    total: Number(res.headers.get("x-export-total") ?? 0),
    truncated: res.headers.get("x-export-truncated") === "1",
  };
}
