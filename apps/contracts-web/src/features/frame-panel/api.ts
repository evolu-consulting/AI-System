// CR-101 DOC-ui-frame · R42: gắn / gỡ chứng từ con của HĐ nguyên tắc. Bearer + refresh do web-kit lo.
import type { AttachDocsResponse, ContractListResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

/** `POST /contracts/:id/attach` (`:id` = HĐ NT). Lệch đối tác/hướng ⇒ 422 `FRAME_PARTNER_MISMATCH`. */
export function attachDocs(frameId: string, ids: string[]): Promise<AttachDocsResponse> {
  return api<AttachDocsResponse>(`${BASE}/${encodeURIComponent(frameId)}/attach`, {
    method: "POST",
    body: { ids },
  });
}

/** `DELETE /contracts/:id/frame` (`:id` = con) ⇒ con đứng riêng. */
export function detachFrame(childId: string): Promise<{ id: string; detached: boolean }> {
  return api<{ id: string; detached: boolean }>(`${BASE}/${encodeURIComponent(childId)}/frame`, {
    method: "DELETE",
  });
}

export const candidatesKey = (q: string) => ["contract", "attach-candidates", q] as const;

/** Tìm chứng từ để gắn (`nest=1` để biết `doc_type`; tìm theo chữ ≥ 2 ký tự, bỏ trống ⇒ mới cập nhật gần nhất). */
export function fetchCandidates(q: string, signal?: AbortSignal): Promise<ContractListResponse> {
  const p = new URLSearchParams({ nest: "1", page_size: "50" });
  if (q.trim().length >= 2) p.set("q", q.trim());
  return api<ContractListResponse>(`/pack/contracts/contracts?${p.toString()}`, { signal });
}
