// V2-F · HD-04/HD-11: các lệnh ghi mốc (xác nhận xong / thêm / sửa / xoá) + làm tươi chi tiết HĐ — component không gọi api.ts trực tiếp.
import { useQueryClient } from "@tanstack/react-query";
import { contractKey } from "~/features/contract-review/api";
import { addMilestone, editMilestone, type Fault, removeMilestone, settleMilestone } from "../api";

export type { Fault };

export function useMilestoneWrites() {
  return { settleMilestone, addMilestone, editMilestone, removeMilestone };
}

/** Làm tươi chi tiết HĐ + danh sách HĐ sau khi ghi mốc. */
export function useRefreshContract(contractId: string) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: contractKey(contractId) });
    await qc.invalidateQueries({ queryKey: ["contracts", "list"] });
  };
}
