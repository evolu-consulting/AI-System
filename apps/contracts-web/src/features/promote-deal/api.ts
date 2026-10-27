// CR-101 DOC-ui-frame · R10: nâng giao dịch thành hợp đồng + lịch sử sửa. Bearer + refresh do web-kit lo.
import type { EditLogResponse, PromoteResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

export const editLogKey = (id: string) => ["contract", id, "edit-log"] as const;

/** `POST /contracts/:id/promote` (multipart `file` ký + `number`) ⇒ giữ id, đổi loại, khoá ngay. */
export function promoteDeal(id: string, file: File, number: string): Promise<PromoteResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("number", number);
  return api<PromoteResponse>(`${BASE}/${encodeURIComponent(id)}/promote`, {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
}

export const fetchEditLog = (id: string, signal?: AbortSignal): Promise<EditLogResponse> =>
  api<EditLogResponse>(`${BASE}/${encodeURIComponent(id)}/edit-log`, { signal });
