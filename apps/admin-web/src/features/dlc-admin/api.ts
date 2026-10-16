// DLC-R14 · DLC-R15 · gọi Hub `/dlc/catalog`, `/dlc/workflows*` (nơi duy nhất của feature dlc-admin).
import type {
  DlcCatalogResponse,
  DlcWorkflow,
  DlcWorkflowCreate,
  DlcWorkflowListResponse,
  DlcWorkflowPatch,
} from "@ai/contracts/hub-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

export const DLC_ADMIN_KEYS = {
  catalog: ["dlc-admin", "catalog"] as const,
  workflows: ["dlc-admin", "workflows"] as const,
};

const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

export function useDlcCatalog() {
  return useQuery({
    queryKey: DLC_ADMIN_KEYS.catalog,
    enabled: hubConfigured(),
    staleTime: 30_000,
    queryFn: () => api<DlcCatalogResponse>(url("/dlc/catalog")),
  });
}

export function useDlcWorkflows() {
  return useQuery({
    queryKey: DLC_ADMIN_KEYS.workflows,
    enabled: hubConfigured(),
    queryFn: () => api<DlcWorkflowListResponse>(url("/dlc/workflows")),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: DLC_ADMIN_KEYS.workflows });
}

export function useCreateDlcWorkflow() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: DlcWorkflowCreate) =>
      api<DlcWorkflow>(url("/dlc/workflows"), { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function usePatchDlcWorkflow() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; patch: DlcWorkflowPatch }) =>
      api<DlcWorkflow>(url(`/dlc/workflows/${encodeURIComponent(v.id)}`), {
        method: "PATCH",
        body: v.patch,
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteDlcWorkflow() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      api<unknown>(url(`/dlc/workflows/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
