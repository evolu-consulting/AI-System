// CR-097 K3a · HD-FR-104: owner mở lại HĐ đã khoá (kèm lý do) ⇒ về Chờ duyệt.
import type { ReopenResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

export function reopenContract(id: string, reason: string): Promise<ReopenResponse> {
  return api<ReopenResponse>(`/pack/contracts/contracts/${encodeURIComponent(id)}/reopen`, {
    method: "POST",
    body: { reason },
  });
}
