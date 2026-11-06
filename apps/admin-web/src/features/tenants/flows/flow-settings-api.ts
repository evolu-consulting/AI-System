// CR-122 · P7 · client `/tenants/:tid/flow-settings` (chỉ platform_admin): đọc + đặt cờ "dùng quy trình mới".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

type Settings = { flow_triggers: boolean };
const key = (tid: string) => ["flow-settings", tid] as const;
const url = (tid: string): string => {
  const u = hubUrl(`/tenants/${encodeURIComponent(tid)}/flow-settings`);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

export const useFlowSettings = (tid: string) =>
  useQuery({
    queryKey: key(tid),
    enabled: hubConfigured(),
    retry: false,
    queryFn: () => api<Settings>(url(tid)),
  });

export function useSetFlowTriggers(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) =>
      api<Settings>(url(tid), { method: "PUT", body: { flow_triggers: on } }),
    onSuccess: (s) => qc.setQueryData(key(tid), s),
    onError: () => qc.invalidateQueries({ queryKey: key(tid) }),
  });
}
