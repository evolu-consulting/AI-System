// DOC-ui-list: tạo Giao dịch = chứng từ `doc_type='deal'` (DOC-deals). `POST /contracts/deals` (JSON, không file); gắn vào HĐ nguyên tắc
// sau khi lưu bằng `POST /contracts/:id/attach` (DOC-model; `DealCreateRequest` chưa nhận `frame_root_id`).
import type {
  AttachDocsResponse,
  DealCreateRequest,
  DealCreateResponse,
  DealLinkedResponse,
  ManualContractRequest,
  ManualContractResponse,
  OpenMilestone,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

/** HD-FR-26 (ngừng ở UI từ CR-097 K3a; server còn giữ 410): nhập tay HĐ không file. */
export function createManualContract(body: ManualContractRequest): Promise<ManualContractResponse> {
  return api<ManualContractResponse>(`${BASE}/manual`, { method: "POST", body });
}

/** 201 ⇒ chứng từ giao dịch; 201/202 với `obligation_id` ⇒ đã ghi vào mốc (`posted`) hoặc đang chờ duyệt (`pending`). */
export function createDeal(
  body: DealCreateRequest,
): Promise<DealCreateResponse | DealLinkedResponse> {
  return api<DealCreateResponse | DealLinkedResponse>(`${BASE}/deals`, { method: "POST", body });
}

/** CR-127 X2: mốc mở của HĐ đã duyệt xong còn hiệu lực với đối tác (`party_key` lấy từ tra đối tác). */
export function fetchOpenMilestones(
  q: { party_key: string; direction: "sale" | "purchase"; product_id?: string },
  signal?: AbortSignal,
): Promise<OpenMilestone[]> {
  const u = new URLSearchParams({ party_key: q.party_key, direction: q.direction });
  if (q.product_id) u.set("product_id", q.product_id);
  return api<OpenMilestone[]>(`/pack/contracts/open-milestones?${u}`, {
    ...(signal ? { signal } : {}),
  });
}

/** `:frameId` = HĐ nguyên tắc (bản bất kỳ của chuỗi). Cùng đối tác + cùng hướng, nếu không ⇒ 422 `FRAME_PARTNER_MISMATCH`. */
export function attachToFrame(frameId: string, ids: string[]): Promise<AttachDocsResponse> {
  return api<AttachDocsResponse>(`${BASE}/${frameId}/attach`, { method: "POST", body: { ids } });
}
