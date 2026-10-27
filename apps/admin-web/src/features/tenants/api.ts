// ADM-FR-60, ADM-FR-61, ADM-FR-40 · gọi API /admin/tenants* (nơi duy nhất) dưới dạng hook TanStack Query.
import type {
  DailyLimitKind,
  DailyLimitsPut,
  DailyLimitsResponse,
  GrantMatrix,
  PackListResponse,
  PackState,
  QuotaSetRequest,
  QuotaSetResponse,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantDetail,
  TenantListResponse,
  TenantUpdateRequest,
  TenantWorkflowToolList,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { QuotaFeatureOption } from "./lib/quota-draft";

export type TenantListParams = { q: string; status?: "active" | "locked" };

const KEYS = {
  all: ["tenants"] as const,
  list: (p: TenantListParams) => ["tenants", "list", p] as const,
  detail: (id: string) => ["tenants", "detail", id] as const,
};

/** Tenant ≤ 200 → lấy một lần; lọc trạng thái do server (`status`), số chip lấy từ `counts` của response. */
export function useTenantList(params: TenantListParams, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<TenantListResponse>("/admin/tenants", {
        query: { limit: 200, q: params.q || undefined, status: params.status },
      }),
  });
}

export function useTenantDetail(id: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.detail(id),
    enabled,
    queryFn: () => api<TenantDetail>(`/admin/tenants/${id}`),
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TenantCreateRequest) =>
      api<TenantCreateResponse>("/admin/tenants", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useUpdateTenant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TenantUpdateRequest) =>
      api<TenantDetail>(`/admin/tenants/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

/** Khoá/mở khoá ảnh hưởng cả user của tenant → làm mới cả danh sách user. */
export function useSetTenantLocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
      api<TenantDetail>(`/admin/tenants/${id}/${locked ? "lock" : "unlock"}`, { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.all });
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/** Danh sách tenant cho ô chọn Tenant (chỉ platform_admin; ánh xạ mã → id); dùng chung cho Groups, Phân quyền. */
export function useTenantOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["tenants", "options"] as const,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<TenantListResponse>("/admin/tenants", { query: { limit: 200 } });
      return res.items.map((t) => ({ id: t.id, key: t.key }));
    },
  });
}

const QUOTA_KEYS = {
  quotas: (id: string) => ["tenants", "quotas", id] as const,
  features: (id: string) => ["tenants", "quota-features", id] as const,
};

/** Quota tháng hiện tại + mức đã dùng (platform_admin xem mọi tenant). */
export function useTenantQuotas(id: string, enabled: boolean) {
  return useQuery({
    queryKey: QUOTA_KEYS.quotas(id),
    enabled,
    queryFn: () => api<QuotaSetResponse>(`/admin/tenants/${id}/quotas`),
  });
}

/** PUT thay cả bộ; thành công → ghi `version` mới vào bản tenant đang cache (Info và Quota dùng chung version, E22) và làm mới banner/usage. */
export function useSetTenantQuotas(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: QuotaSetRequest) =>
      api<QuotaSetResponse>(`/admin/tenants/${id}/quotas`, { method: "PUT", body }),
    onSuccess: (res) => {
      qc.setQueryData(QUOTA_KEYS.quotas(id), res);
      qc.setQueryData<TenantDetail>(KEYS.detail(id), (old) =>
        old ? { ...old, version: res.version } : old,
      );
      void qc.invalidateQueries({ queryKey: ["quota-banner"] });
      void qc.invalidateQueries({ queryKey: ["usage"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

/** Feature tenant dùng được (core + đã entitlement chưa thu hồi) để thêm quota; `limit=1` vì chỉ cần `features`. */
export function useQuotaFeatureOptions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: QUOTA_KEYS.features(id),
    enabled,
    queryFn: async (): Promise<QuotaFeatureOption[]> => {
      const m = await api<GrantMatrix>("/admin/grants/matrix", {
        query: { tenant_id: id, limit: 1 },
      });
      return m.features
        .filter((f) => f.state === "core" || f.state === "entitled")
        .map((f) => ({ id: f.feature.id, key: f.feature.key, name: f.feature.name }));
    },
  });
}

const PACK_KEYS = { list: (id: string) => ["tenants", "packs", id] as const };

/** PK-FR-05 · D-05 · UAT B3: gói đã cài + trạng thái bật của tenant; chỉ platform_admin. */
export function useTenantPacks(id: string, enabled: boolean) {
  return useQuery({
    queryKey: PACK_KEYS.list(id),
    enabled,
    queryFn: () => api<PackListResponse>(`/admin/tenants/${id}/packs`),
  });
}

/** Bật (`PUT` → `PackState`) hoặc tắt (`DELETE` → 204); xong làm mới danh sách (không optimistic). */
export function useSetTenantPack(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, on }: { key: string; on: boolean }) =>
      api<PackState | undefined>(`/admin/tenants/${id}/packs/${key}`, {
        method: on ? "PUT" : "DELETE",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: PACK_KEYS.list(id) }),
  });
}

const TOOL_KEYS = { list: (id: string) => ["tenants", "workflow-tools", id] as const };

/** ADM-FR-73 · danh sách tool quy trình của tenant (mọi workflow catalog + công tắc); chỉ platform_admin. */
export function useTenantWorkflowTools(id: string, enabled: boolean) {
  return useQuery({
    queryKey: TOOL_KEYS.list(id),
    enabled,
    queryFn: () => api<TenantWorkflowToolList>(`/admin/tenants/${id}/workflow-tools`),
  });
}

/** Bật (`PUT`, body rỗng) hoặc tắt (`DELETE`) một tool; xong làm mới danh sách (công tắc không optimistic). */
export function useSetTenantTool(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, on }: { workflowId: string; on: boolean }) =>
      api<unknown>(`/admin/tenants/${id}/workflow-tools/${workflowId}`, {
        method: on ? "PUT" : "DELETE",
        body: on ? {} : undefined,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: TOOL_KEYS.list(id) }),
  });
}

const DAILY_KEYS = { limits: (id: string) => ["tenants", "daily-limits", id] as const };

/** tenant-quotas · hạn mức ngày theo công ty (riêng/env/hiệu lực/đã dùng hôm nay); chỉ platform_admin. */
export function useTenantDailyLimits(id: string, enabled: boolean) {
  return useQuery({
    queryKey: DAILY_KEYS.limits(id),
    enabled,
    queryFn: () => api<DailyLimitsResponse>(`/admin/tenants/${id}/daily-limits`),
  });
}

/** PUT thay cả bộ (null = mặc định env); thành công ⇒ ghi kết quả vào cache + làm mới nhật ký. */
export function useSetTenantDailyLimits(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DailyLimitsPut) =>
      api<DailyLimitsResponse>(`/admin/tenants/${id}/daily-limits`, { method: "PUT", body }),
    onSuccess: (res) => {
      qc.setQueryData(DAILY_KEYS.limits(id), res);
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

/** "Đặt lại hôm nay" một loại hạn mức. */
export function useResetTenantDailyLimit(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: DailyLimitKind) =>
      api<DailyLimitsResponse>(`/admin/tenants/${id}/daily-limits/${kind}/reset`, {
        method: "POST",
      }),
    onSuccess: (res) => {
      qc.setQueryData(DAILY_KEYS.limits(id), res);
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}
