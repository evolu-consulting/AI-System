// HD-FR-24 · HD-FR-26 · S05: chi tiết HĐ (HD1), sửa trường (PATCH HD1, khoá `version`), mở tệp gốc (#220). Bearer + refresh
// do web-kit lo.
import type {
  AssigneesResponse,
  CommissionEditResponse,
  ContractDetail,
  ContractFieldKey,
  HistoryResponse,
  ItemProductRequest,
  ItemProductResponse,
  OwnerAssignResponse,
  PatchFieldsResponse,
  ReviewSaveRequest,
  ReviewSaveResponse,
  SummaryResponse,
} from "@ai/contracts";
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

/** V2-G: Lưu ở màn xác nhận — trường + loại + dòng hàng + mốc trong MỘT lần ghi (tenant tắt duyệt ⇒ `active`). */
export function saveReview(id: string, body: ReviewSaveRequest): Promise<ReviewSaveResponse> {
  return api<ReviewSaveResponse>(`${BASE}/${encodeURIComponent(id)}/review`, {
    method: "POST",
    body,
  });
}

/** V2-G: gắn / gắn lại SP cho dòng của HĐ đã lưu. */
export function putItemProduct(
  id: string,
  itemId: string,
  body: ItemProductRequest,
): Promise<ItemProductResponse> {
  return api<ItemProductResponse>(
    `${BASE}/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/product`,
    { method: "PUT", body },
  );
}

const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
export const historyKey = (id: string) => ["contract", id, "history"] as const;
export const ASSIGNEES_KEY = ["contracts", "assignees"] as const;

/** gap-a1 #5: "AI đọc lại từ đầu" / thử lại sau khi đọc lỗi (đúng route trích lại có sẵn, 202). */
export function extractContract(id: string): Promise<{ id: string; status: string }> {
  return api<{ id: string; status: string }>(`${one(id)}/extract`, { method: "POST" });
}

/** gap-a1 #4: lịch sử thay đổi (theo luật thấy của người gọi). */
export function fetchHistory(id: string, signal?: AbortSignal): Promise<HistoryResponse> {
  return api<HistoryResponse>(`${one(id)}/history`, { signal });
}

/** gap-a1 #7: người có thể được giao (thành viên có quyền xem gói) + giao / bỏ giao. */
export function fetchAssignees(signal?: AbortSignal): Promise<AssigneesResponse> {
  return api<AssigneesResponse>("/pack/contracts/assignees", { signal });
}
export function assignOwner(id: string, owner: string | null): Promise<OwnerAssignResponse> {
  return api<OwnerAssignResponse>(`${one(id)}/owner`, {
    method: "PUT",
    body: { owner_user_id: owner },
  });
}

/** gap-a1 #16: sửa hoa hồng % của HĐ Giới thiệu sau khi lưu. */
export function editCommission(
  id: string,
  version: number,
  commission_pct: number | null,
): Promise<CommissionEditResponse> {
  return api<CommissionEditResponse>(`${one(id)}/commission`, {
    method: "PUT",
    body: { version, commission_pct },
  });
}

/** gap-a1 #17: "Tạo tóm tắt bằng AI" (usage `contracts.summary`). */
export function generateSummary(id: string): Promise<SummaryResponse> {
  return api<SummaryResponse>(`${one(id)}/summary`, { method: "POST" });
}

/** Đường dẫn tệp gốc (`href` giữ như mgmt-app; bấm ⇒ `openOriginalFile`). */
export const fileHref = (id: string) => `${BASE}/${encodeURIComponent(id)}/file`;

/** Link hợp lệ: `https?://…` hoặc đường dẫn cùng origin `/…` (FileBox riêng: `/_fb/d/…` qua nginx của web; không nhận `//host`). */
export const isOpenableLink = (url: string): boolean =>
  /^https?:\/\//.test(url) || /^\/(?!\/)/.test(url);

/** Xem tại chỗ: xin link FileBox ngắn hạn qua API (RLS ở server: HĐ không thấy ⇒ 404) rồi tải về Blob có đúng `mime` (cho khung PDF/ảnh + nút tải).
 * Lỗi mạng/CORS khi tải Blob ⇒ nén về `openOriginalFile` ở tầng gọi. */
export async function fetchOriginalBlob(
  id: string,
  mime: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const { url } = await api<{ url: string }>(`${BASE}/${encodeURIComponent(id)}/file-link`, {
    signal,
  });
  if (!isOpenableLink(url)) throw new Error("bad link");
  const res = await fetch(url, { signal, credentials: "omit" });
  if (!res.ok) throw new Error(`file ${res.status}`);
  return new Blob([await res.arrayBuffer()], { type: mime });
}

/** Xem được tại chỗ: PDF hoặc ảnh. */
export const isPreviewable = (mime: string): boolean =>
  mime === "application/pdf" || /^image\/(png|jpe?g|gif|webp)$/.test(mime);

/** #220: điều hướng trình duyệt không mang Bearer ⇒ xin link FileBox ngắn hạn qua API rồi mở ở tab đã mở sẵn
 * (mở tab ngay trong lúc bấm để không bị chặn popup). Lỗi ⇒ đóng tab, ném cho trang báo. */
export async function openOriginalFile(id: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { url } = await api<{ url: string }>(`${BASE}/${encodeURIComponent(id)}/file-link`);
    if (!isOpenableLink(url)) throw new Error("bad link");
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else window.location.assign(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
