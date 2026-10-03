// ADM-FR-51 · M4-R12 · gọi GET /admin/audit và /admin/audit/:id (nơi duy nhất của feature audit).
import type { AuditAction, AuditDetail, AuditEntity, AuditListResponse } from "@ai/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
