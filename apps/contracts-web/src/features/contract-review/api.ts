// HD-FR-24 · HD-FR-26 · S05: chi tiết HĐ (HD1), sửa trường (PATCH HD1, khoá `version`), mở tệp gốc (#220). Bearer + refresh
// do web-kit lo.
import type { ContractDetail, ContractFieldKey, PatchFieldsResponse } from "@ai/contracts";
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

/** Đường dẫn tệp gốc (`href` giữ như mgmt-app; bấm ⇒ `openOriginalFile`). */
export const fileHref = (id: string) => `${BASE}/${encodeURIComponent(id)}/file`;

/** #220: điều hướng trình duyệt không mang Bearer ⇒ xin link FileBox ngắn hạn qua API rồi mở ở tab đã mở sẵn
 * (mở tab ngay trong lúc bấm để không bị chặn popup). Lỗi ⇒ đóng tab, ném cho trang báo. */
export async function openOriginalFile(id: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { url } = await api<{ url: string }>(`${BASE}/${encodeURIComponent(id)}/file-link`);
    if (!/^https?:\/\//.test(url)) throw new Error("bad link");
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else window.location.assign(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
