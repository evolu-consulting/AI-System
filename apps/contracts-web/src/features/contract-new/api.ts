// DOC-ui-list: tạo Giao dịch = chứng từ `doc_type='deal'` (DOC-deals). `POST /contracts/deals` (JSON, không file); gắn vào HĐ nguyên tắc
// sau khi lưu bằng `POST /contracts/:id/attach` (DOC-model; `DealCreateRequest` chưa nhận `frame_root_id`).
import type {
  AttachDocsResponse,
  DealCreateRequest,
  DealCreateResponse,
  ManualContractRequest,
  ManualContractResponse,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

/** HD-FR-26 (ngừng ở UI từ CR-097 K3a; server còn giữ 410): nhập tay HĐ không file. */
export function createManualContract(body: ManualContractRequest): Promise<ManualContractResponse> {
  return api<ManualContractResponse>(`${BASE}/manual`, { method: "POST", body });
}

export function createDeal(body: DealCreateRequest): Promise<DealCreateResponse> {
  return api<DealCreateResponse>(`${BASE}/deals`, { method: "POST", body });
}

/** `:frameId` = HĐ nguyên tắc (bản bất kỳ của chuỗi). Cùng đối tác + cùng hướng, nếu không ⇒ 422 `FRAME_PARTNER_MISMATCH`. */
export function attachToFrame(frameId: string, ids: string[]): Promise<AttachDocsResponse> {
  return api<AttachDocsResponse>(`${BASE}/${frameId}/attach`, { method: "POST", body: { ids } });
}
