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

/** Mở tệp gắn vào HĐ: xin link FileBox ngắn hạn rồi mở ở tab đã mở sẵn (tránh bị chặn popup); PDF/ảnh hiện tại chỗ, tệp khác tải về. */
export async function openOwnFile(id: string, fileId: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { url } = await api<{ url: string }>(`${base(id)}/${encodeURIComponent(fileId)}/link`);
    if (!/^https?:\/\//.test(url) && !/^\/(?!\/)/.test(url)) throw new Error("bad link");
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else window.location.assign(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Tệp kèm bước duyệt: `GET /attachments/:id/content` (Hub, Bearer) ⇒ blob ⇒ mở / tải. */
export async function openStepFile(f: { id: string; name: string; mime: string }): Promise<void> {
  const blob = await (await apiResponse(`/attachments/${encodeURIComponent(f.id)}/content`)).blob();
  const url = URL.createObjectURL(new Blob([blob], { type: f.mime }));
  const a = document.createElement("a");
  a.href = url;
  if (isPreviewable(f.mime)) a.target = "_blank";
  else a.download = f.name;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Xem được tại chỗ trong trình duyệt: PDF hoặc ảnh. */
export const isPreviewable = (mime: string): boolean =>
  mime === "application/pdf" || /^image\/(png|jpe?g|gif|webp)$/.test(mime);
