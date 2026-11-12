// CR-127 · E3 · spec §5.2 · R#33 · cổng gói Hợp đồng cho engine: "B có xem được HĐ này không" (uỷ quyền / giao việc) và "B thuộc
// nhóm Người ký HĐ" (uỷ quyền ký số). Gói contracts đăng ký lúc mount (luật xem hiện có); `processes` đọc lúc gọi. Chưa đăng ký ⇒
// null: engine coi như KHÔNG kiểm được (ký số bị từ chối `DELEGATE_NOT_SIGNER`; giao việc giữ hành vi cũ).
import type { Tx } from "@ai/db";

export type ContractAccess = {
  canView(tx: Tx, tenantId: string, userId: string, contractId: string): Promise<boolean>;
  isSigner(tx: Tx, tenantId: string, userId: string): Promise<boolean>;
};

let current: ContractAccess | null = null;
export function registerContractAccess(p: ContractAccess | null): void {
  current = p;
}
export const contractAccess = (): ContractAccess | null => current;
