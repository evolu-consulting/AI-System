// CR-104 · ops-ui · gọi Hub `/ops/*` (nơi duy nhất của trang `/system`): status (poll 60 s khi tab hiện), check ngay, lưu cấu hình.
import type { OpsSettings, OpsSettingsResponse, OpsStatusResponse } from "@ai/contracts/hub-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

export const OPS_KEY = ["hub", "ops", "status"] as const;
export const OPS_POLL_MS = 60_000;

const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

export function useOpsStatus() {
  return useQuery({
    queryKey: OPS_KEY,
    enabled: hubConfigured(),
    queryFn: () => api<OpsStatusResponse>(url("/ops/status")),
    refetchInterval: OPS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useRunOpsCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<OpsStatusResponse>(url("/ops/check"), { method: "POST" }),
    onSuccess: (data) => qc.setQueryData(OPS_KEY, data),
  });
}

export function useSaveOpsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OpsSettings) =>
      api<OpsSettingsResponse>(url("/ops/settings"), { method: "PUT", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPS_KEY }),
  });
}
