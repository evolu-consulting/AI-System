// CR-127 K1a · R#23 · spec §3: việc chạy khi HĐ vào DONE (cùng tx với cổng `applyTransition`). K1a chỉ khai port + cài đặt rỗng;
// K7 cài adapter lập mốc AI (đăng ký ở `extraction.mount.ts`).

export interface ContractDoneHook {
  onDone(tx: unknown, tenantId: string, contractId: string): Promise<void>;
}

export const noopContractDoneHook: ContractDoneHook = { onDone: async () => {} };
