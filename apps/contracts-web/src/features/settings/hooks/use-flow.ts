// contract-flow S5 · truy vấn/ghi mẫu luồng duyệt + danh sách phòng ban (hook của features/org).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOrg, orgKeys } from "~/features/org/api";
import type { FlowStep } from "../api-flow";
import { fetchFlow, flowKeys, saveFlow } from "../api-flow";

export const useFlow = (enabled: boolean) =>
  useQuery({
    queryKey: flowKeys.flow,
    queryFn: ({ signal }) => fetchFlow(signal),
    enabled,
    retry: false,
  });

export const useDepartments = (enabled: boolean) =>
  useQuery({
    queryKey: orgKeys.org,
    queryFn: ({ signal }) => fetchOrg(signal),
    enabled,
    retry: false,
    select: (o) => o.departments.map((d) => ({ id: d.group_id, name: d.name })),
  });

export function useSaveFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (steps: FlowStep[]) => saveFlow({ steps }),
    onSuccess: (d) => qc.setQueryData(flowKeys.flow, d),
  });
}
