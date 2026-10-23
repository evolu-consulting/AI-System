// CR-097 K3b: tải bản cập nhật (phiên bản mới) + danh sách phiên bản + so sánh. Bearer + refresh do web-kit lo.
import type { UploadVersionResponse, VersionDiffResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

export const diffKey = (id: string, a: string, b: string) =>
  ["contract", id, "versions-diff", a, b] as const;

/** `POST /contracts/:id/versions` (multipart `file`, `title` tuỳ chọn) ⇒ bản nháp v(n+1). */
export function uploadVersion(id: string, file: File): Promise<UploadVersionResponse> {
  const form = new FormData();
  form.append("file", file);
  return api<UploadVersionResponse>(`${BASE}/${encodeURIComponent(id)}/versions`, {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
}

export const fetchVersionDiff = (
  id: string,
  a: string,
  b: string,
  signal?: AbortSignal,
): Promise<VersionDiffResponse> =>
  api<VersionDiffResponse>(
    `${BASE}/${encodeURIComponent(id)}/versions/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    { signal },
  );
