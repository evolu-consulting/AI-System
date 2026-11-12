// HD-FR-31 · kiểu kết quả/hành động của lượt duyệt HĐ (tách khỏi pproval.usecase.ts để phá vòng với low-submit.usecase.ts).
import type { ProductLink } from "@ai/contracts/pack-contracts";
import type { ApprovalErrorCode, approvalView } from "../domain/approval-run.rules";
import type { EngineCard } from "./approval-engine-card.usecase";

export type ContractApproval =
  | ReturnType<typeof approvalView>
  | Awaited<ReturnType<EngineCard["view"]>>;
/** `products` (products-confirm): gắn/tạo SP cho dòng HĐ — áp TRONG tx chỉ khi bước này làm HĐ thành "đã xác nhận". */
export type ApprovalAction = {
  action: "approve" | "reject" | "redo" | "return";
  feedback?: string;
  products?: readonly ProductLink[];
  /** CR-127 · E4 · bằng chứng của quyết định (engine ghi `hub.evidence` cùng tx đóng task). */
  evidence?:
    | { note: string; signature_attachment_id?: string; attachment_ids?: string[] }
    | undefined;
  /** CR-120 · FlowRuntime.act: task (+ giai đoạn thẻ) người bấm đang thấy; khác task/giai đoạn đang mở ⇒ APPROVAL_NOT_OPEN — kiểm
   *  TRONG khoá (máy cũ) / theo task engine định quyết, nên bấm lại hay đua KHÔNG quyết bước kế. Route cũ không gửi (giữ y hệt). */
  expect?: { taskId: string; step: string | null } | undefined;
};
export type ActOutcome =
  | ContractApproval
  | "not_found"
  | "unavailable"
  | { error: ApprovalErrorCode };
