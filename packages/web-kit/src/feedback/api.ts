// feedback · gọi `/auth/feedback*` (mọi web proxy `/auth` tới admin-api). Mỗi web có client HTTP riêng (admin/studio chép bản của mình),
// nên khung nhận `transport`; mặc định dùng `http.ts` của web-kit (chat, contracts). Tệp đính kèm tải bằng Bearer rồi hiện qua blob URL.
import type { FeedbackCreateRequest, FeedbackItem } from "@ai/contracts";
import { api, apiResponse } from "../http";

const BASE = "/auth/feedback";

export type FeedbackTransport = {
  request<T>(
    path: string,
    opts?: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal },
  ): Promise<T>;
  /** Có ⇒ tải tệp đính kèm (Blob); vắng ⇒ chỉ hiện tên tệp. */
  blob?(path: string): Promise<Blob>;
};

export const defaultTransport: FeedbackTransport = {
  request: (path, opts) => api(path, opts),
  blob: async (path) => (await apiResponse(path)).blob(),
};

export const fetchMine = (t: FeedbackTransport, signal?: AbortSignal) =>
  t.request<{ items: FeedbackItem[] }>(BASE, { signal });

export const sendFeedback = (t: FeedbackTransport, body: FeedbackCreateRequest) =>
  t.request<FeedbackItem>(BASE, { method: "POST", body });

/** Đọc `File` thành base64 (không tiền tố data:). */
export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.readAsDataURL(file);
  });
}

/** Đường dẫn tải tệp đính kèm (user: `/auth/feedback`; admin: `/admin/feedback`). */
export const fileUrl = (feedbackId: string, fileId: string, base = BASE): string =>
  `${base}/${encodeURIComponent(feedbackId)}/files/${encodeURIComponent(fileId)}`;

/** Tải Blob về máy bằng thẻ `<a download>`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
