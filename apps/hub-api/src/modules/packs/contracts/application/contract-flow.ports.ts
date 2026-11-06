// CR-122 · A1 · FLOW2-FR-18/19 · cổng gói Hợp đồng bắn sự kiện flow. Lớp 2: chỉ kiểu + hàm thuần; SQL ở `adapters/contract-flow.repo.ts`.
import type { ContractEvent } from "../domain/contract-flow-events.rules";

/** Ghi sự kiện CÙNG tx bản ghi (đã nằm trong `PackUow.tenant`). Vắng ⇒ gói chưa nối (test cũ) ⇒ không bắn. */
export type ContractFlowRepo = {
  /** `contract.submitted` | `contract.approved`: facts từ hàng HĐ + phòng ban người tạo. true = ghi mới. */
  emitContract(
    event: Exclude<ContractEvent, "contract.uploaded">,
    contractId: string,
    versionKey: string,
    o: { actor: string | null; departments: readonly string[] | null },
  ): Promise<boolean>;
  /** `contract.uploaded`: facts = loại tệp + phòng ban người tải. */
  emitUploaded(
    contractId: string,
    o: { fileType: string; actor: string | null; departments: readonly string[] | null },
  ): Promise<boolean>;
  readFacts(
    contractId: string,
  ): Promise<{ facts: Record<string, unknown>; startedBy: string | null } | null>;
};
export type ContractFlowTxRepos = { contractFlow?: ContractFlowRepo | undefined };

/** Kết quả đọc cờ TRƯỚC tx (role gói không đọc `hub.tenant_flow_settings`): bật ⇒ bắn sự kiện, KHÔNG mở lượt theo đường cũ. */
export type FlowPrep = { on: boolean; departments: readonly string[] | null };
export const FLOW_OFF: FlowPrep = { on: false, departments: null };
/** `prepare` đọc cờ `flowTriggersOn(tenant)` (+ phòng ban người gây sự kiện khi bật). Không ném: lỗi ⇒ tắt (đường cũ). */
export type ContractFlowGate = {
  prepare(tenantId: string, userId: string): Promise<FlowPrep>;
};

/** Bắn trong tx đang mở; cờ bật mà repo chưa nối ⇒ ném (không im lặng nuốt sự kiện). */
export function requireFlow(r: ContractFlowTxRepos): ContractFlowRepo {
  if (!r.contractFlow) throw new Error("contract flow repo missing");
  return r.contractFlow;
}
