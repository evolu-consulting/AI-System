// contract-flow S5/S4 · truy vấn/ghi mẫu luồng duyệt + danh sách phòng (Group) qua `/groups`.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGroups } from "~/features/contract-approval/hooks/use-groups";
import type { FlowStep } from "../api-flow";
import { fetchFlow, flowKeys, saveFlow } from "../api-flow";

export const useFlow = (enabled: boolean) =>
  useQuery({
    queryKey: flowKeys.flow,
    queryFn: ({ signal }) => fetchFlow(signal),
    enabled,
    retry: false,
  });

/** Phòng/Group chọn cho bước duyệt: `GET /pack/contracts/groups` (mọi người có quyền đọc gói; không cần quyền admin). */
export const useDepartments = (enabled: boolean) => useGroups(enabled);

export function useSaveFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { version: number; steps: FlowStep[] }) => saveFlow(v),
    onSuccess: (d) => qc.setQueryData(flowKeys.flow, d),
  });
}
