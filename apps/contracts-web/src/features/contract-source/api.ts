// gap-a2 #3: văn bản gốc (Markdown) của HĐ — `GET /pack/contracts/contracts/:id/source` (RLS: chỉ người thấy HĐ; 404 giống hệt id lạ).
import { apiResponse } from "@ai/web-kit/http";

export const sourceKey = (id: string) => ["contract-source", id] as const;

export async function fetchSourceText(id: string, signal?: AbortSignal): Promise<string> {
  const res = await apiResponse(`/pack/contracts/contracts/${encodeURIComponent(id)}/source`, {
    signal,
  });
  return res.text();
}
