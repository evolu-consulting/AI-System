// HD-FR-34 · HD-FR-36 · S05: trạng thái + quyết bước duyệt của HĐ (`/pack/contracts/contracts/:id/approval`). Bearer + refresh
// do web-kit lo; lỗi (403 STARTER_CANNOT_REVIEW, 422 FEEDBACK_REQUIRED, 429 ACTION_QUOTA…) ném `ApiError` cho trang báo.
import type { ContractApproval, ContractGroup } from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

export const approvalKey = (id: string) => ["contract-approval", id] as const;

export function fetchApproval(id: string, signal?: AbortSignal): Promise<ContractApproval> {
  return api<ContractApproval>(`${BASE}/${encodeURIComponent(id)}/approval`, { signal });
}

// CR-120/121: Duyệt/Trả lại/Từ chối KHÔNG gọi thẳng `POST …/approval` — chỉ đi `FlowRuntime.act` (`~/platform/flow`).

export const groupsKey = ["contract-groups"] as const;
/** S3b · Group của tenant (id + tên) cho tên phòng ở thẻ duyệt + chọn phòng ở mẫu luồng (mọi người có quyền đọc gói). */
export function fetchGroups(signal?: AbortSignal): Promise<ContractGroup[]> {
  return api<ContractGroup[]>("/pack/contracts/groups", { signal });
}

/** esign-flow · "Gửi lại" bước Ký số đang cần quyết (người phụ trách HĐ / owner gói). */
export function resendEsignStep(id: string): Promise<{ result: "sent" | "needs_decision" }> {
  return api<{ result: "sent" | "needs_decision" }>(
    `${BASE}/${encodeURIComponent(id)}/approval/esign-resend`,
    { method: "POST", body: {} },
  );
}
