// CR-133 · «Tài liệu kèm» trên HĐ: gọi `/pack/contracts/contracts/:id/files…` (Bearer + refresh do web-kit lo).
import type { ContractFilesResponse } from "@ai/contracts/pack-contracts";
import { api, apiResponse } from "@ai/web-kit/http";

const base = (id: string) => `/pack/contracts/contracts/${encodeURIComponent(id)}/files`;

export const filesKey = (id: string) => ["contract", id, "files"] as const;

export const fetchFiles = (id: string, signal?: AbortSignal): Promise<ContractFilesResponse> =>
  api<ContractFilesResponse>(base(id), { signal });

/** `POST …/files` (multipart `file`) ⇒ 201. 415 ⇒ định dạng chưa nhận; 409 ⇒ đủ trần; 403 ⇒ không có quyền sửa HĐ. */
export function addFile(id: string, file: File): Promise<{ id: string; name: string }> {
  const form = new FormData();
  form.append("file", file);
  return api(base(id), { method: "POST", rawBody: form as unknown as Blob });
}

export const removeFile = (id: string, fileId: string): Promise<void> =>
  api<void>(`${base(id)}/${encodeURIComponent(fileId)}`, { method: "DELETE" });

/** CR-149 · bytes tệp gắn vào HĐ để XEM trong hộp: xin link FileBox ngắn hạn (kiểm quyền ở server) rồi tải về Blob. */
export async function fetchOwnFileBlob(
  id: string,
  fileId: string,
  mime: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const { url } = await api<{ url: string }>(`${base(id)}/${encodeURIComponent(fileId)}/link`, {
    signal,
  });
  if (!/^https?:\/\//.test(url) && !/^\/(?!\/)/.test(url)) throw new Error("bad link");
  const res = await fetch(url, { signal, credentials: "omit" });
  if (!res.ok) throw new Error(`file ${res.status}`);
  return new Blob([await res.arrayBuffer()], { type: mime });
}

/** CR-149 · bytes tệp kèm bước duyệt: `GET /attachments/:id/content` (Hub, Bearer). */
export async function fetchStepFileBlob(
  fileId: string,
  mime: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await apiResponse(`/attachments/${encodeURIComponent(fileId)}/content`, { signal });
  return new Blob([await res.blob()], { type: mime });
}
