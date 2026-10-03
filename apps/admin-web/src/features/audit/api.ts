// ADM-FR-51 · ADM-FR-52 · M4-R12 · R13 · gọi GET /admin/audit, /admin/audit/:id và POST …/restore (nơi duy nhất của feature audit).
import type {
  AuditAction,
  AuditDetail,
  AuditEntity,
  AuditListResponse,
  AuditRestoreResponse,
} from "@ai/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const AUDIT_PAGE_SIZE = 50;

export type AuditParams = {
  /** Id tenant, hoặc `"system"` (Toàn hệ thống). */
  tenantId?: string;
  entity?: AuditEntity;
  action?: AuditAction;
  actorId?: string;
  from: string;
  to: string;
  q?: string;
};

/** Gốc khoá cache; `invalidateQueries({ queryKey: AUDIT_KEY })` sau khi khôi phục. */
export const AUDIT_KEY = ["audit"] as const;

/** Danh sách theo con trỏ (limit 50), mới nhất trước. */
export function useAuditList(params: AuditParams, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...AUDIT_KEY, "list", params] as const,
    enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AuditListResponse) => last.next_cursor ?? undefined,
    queryFn: ({ pageParam }) =>
      api<AuditListResponse>("/admin/audit", {
        query: {
          tenant_id: params.tenantId,
          entity: params.entity,
          action: params.action,
          actor_id: params.actorId,
          from: params.from,
          to: params.to,
          q: params.q,
          limit: AUDIT_PAGE_SIZE,
          cursor: pageParam,
        },
      }),
  });
}

export function useAuditEntry(id: string) {
  return useQuery({
    queryKey: [...AUDIT_KEY, "entry", id] as const,
    retry: false,
    queryFn: () => api<AuditDetail>(`/admin/audit/${id}`),
  });
}

/** Gốc query của thực thể bị khôi phục (ngoài `AUDIT_KEY`), theo `AuditEntity` khôi phục được (BR-08). */
const RESTORE_ROOTS: Partial<Record<AuditEntity, readonly string[]>> = {
  command: ["commands", "access", "overview"],
  workflow: ["workflows", "commands"],
  feature: ["features", "commands", "access", "tenants"],
  group: ["groups", "access", "grants"],
  quota: ["quotas", "tenants", "quota-banner", "usage", "overview"],
};

/** POST /admin/audit/:id/restore (body `{}`); xong → làm mới nhật ký + thực thể bị khôi phục. */
export function useAuditRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AuditRestoreResponse>(`/admin/audit/${id}/restore`, { method: "POST", body: {} }),
    // 409 (vd NOT_RESTORABLE, VERSION_CONFLICT): `restorable` có thể đã đổi → nạp lại nhật ký.
    onError: () => void qc.invalidateQueries({ queryKey: AUDIT_KEY }),
    onSuccess: (res) => {
      for (const root of [AUDIT_KEY[0], ...(RESTORE_ROOTS[res.entity] ?? [])]) {
        void qc.invalidateQueries({ queryKey: [root] });
      }
    },
  });
}
