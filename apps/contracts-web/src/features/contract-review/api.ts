// HD-FR-24 · HD-FR-26 · S05: chi tiết HĐ (HD1), sửa trường (PATCH HD1, khoá `version`), trích lại (HD2). Bearer + refresh
// do web-kit lo.
import type {
  ContractDetail,
  ContractFieldKey,
  ExtractResponse,
  PatchFieldsResponse,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

export const contractKey = (id: string) => ["contract", id] as const;

export function fetchContract(id: string, signal?: AbortSignal): Promise<ContractDetail> {
  return api<ContractDetail>(`${BASE}/${encodeURIComponent(id)}`, { signal });
}

export function patchContractFields(
  id: string,
  version: number,
  fields: Partial<Record<ContractFieldKey, string | number | null>>,
): Promise<PatchFieldsResponse> {
  return api<PatchFieldsResponse>(`${BASE}/${encodeURIComponent(id)}/fields`, {
    method: "PATCH",
    body: { version, fields },
  });
}

export function requestExtract(id: string): Promise<ExtractResponse> {
  return api<ExtractResponse>(`${BASE}/${encodeURIComponent(id)}/extract`, { method: "POST" });
}

/** Đường dẫn mở tệp gốc (302 tới link FileBox ngắn hạn). */
export const fileHref = (id: string) => `${BASE}/${encodeURIComponent(id)}/file`;
