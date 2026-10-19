// HD4-FR-06: ghi kết quả xử lý HĐ (`POST /pack/contracts/contracts/:id/handled`). Bearer + refresh do web-kit lo.
import type { HandledResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";
import type { Outcome } from "./lib/deadline";

export function postHandled(id: string, outcome: Outcome): Promise<HandledResponse> {
  return api<HandledResponse>(`/pack/contracts/contracts/${encodeURIComponent(id)}/handled`, {
    method: "POST",
    body: { outcome },
  });
}
