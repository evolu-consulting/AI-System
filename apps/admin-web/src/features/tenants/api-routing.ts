// CR-118 §11.2 · client Hub của "quy trình được gán + luật chọn theo phòng ban" của MỘT tenant × khe. Hợp đồng:
// `@ai/contracts/hub-admin` (process-routing). Gán/bỏ gán: chỉ platform_admin; GET/PUT luật: platform_admin (trang này).
import type { OrgResponse, TenantCapabilitiesResponse } from "@ai/contracts";
import type { ProcessRouting, PutProcessRoutingRequest } from "@ai/contracts/hub-admin";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

const enc = encodeURIComponent;
const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};
const R = (tid: string, slot: string) => `/tenants/${enc(tid)}/process-routing/${enc(slot)}`;

export const RKEYS = {
  routing: (tid: string, slot: string) => ["process", "routing", tid, slot] as const,
  depts: (tid: string) => ["process", "routing", "depts", tid] as const,
};

export const useTenantRouting = (tid: string, slot: string, enabled: boolean) =>
  useQuery({
    queryKey: RKEYS.routing(tid, slot),
    enabled: enabled && hubConfigured(),
    retry: false,
    staleTime: 0,
    queryFn: () => api<ProcessRouting>(url(R(tid, slot))),
  });

/** Phòng ban của tenant (admin-api `GET /admin/org?tenant_id=`, platform_admin xem mọi tenant). */
export const useTenantDepartments = (tid: string, enabled: boolean) =>
  useQuery({
    queryKey: RKEYS.depts(tid),
    enabled,
    retry: false,
    queryFn: () => api<OrgResponse>("/admin/org", { query: { tenant_id: tid } }),
    select: (o) => o.departments.map((d) => ({ id: d.group_id, name: d.name })),
  });

export const putRouting = (tid: string, slot: string, body: PutProcessRoutingRequest) =>
  api<ProcessRouting>(url(R(tid, slot)), { method: "PUT", body });

export const assignRoutingProcess = (tid: string, slot: string, defId: string) =>
  api<unknown>(url(`${R(tid, slot)}/processes/${enc(defId)}`), { method: "PUT" });

/** 409 `ROUTING_PROCESS_IN_USE` (`details.rules`) khi còn luật dùng quy trình này. */
export const unassignRoutingProcess = (tid: string, slot: string, defId: string) =>
  api<undefined>(url(`${R(tid, slot)}/processes/${enc(defId)}`), { method: "DELETE" });

/** CR-120 · luật chọn của nhiều khe một lượt (cùng khoá cache với `useTenantRouting`). */
export const useTenantRoutings = (tid: string, slots: readonly string[], enabled: boolean) =>
  useQueries({
    queries: slots.map((slot) => ({
      queryKey: RKEYS.routing(tid, slot),
      enabled: enabled && hubConfigured(),
      retry: false,
      staleTime: 0,
      queryFn: () => api<ProcessRouting>(url(R(tid, slot))),
    })),
  });

/** CR-120 · khe quy trình theo app của tenant (`GET /hub-admin/tenants/:tid/capabilities`; tenant_admin: tenant mình). */
export const useTenantCaps = (tid: string, enabled: boolean) =>
  useQuery({
    queryKey: ["process", "assigned", "caps", tid] as const,
    enabled: enabled && hubConfigured(),
    retry: false,
    queryFn: () =>
      api<TenantCapabilitiesResponse>(url(`/hub-admin/tenants/${enc(tid)}/capabilities`)),
  });

/** CR-120 · tên phòng ban để đọc luật: platform chọn tenant ⇒ `?tenant_id=`; tenant_admin ⇒ tenant của phiên (không gửi tham số). */
export const useFlowDepartments = (tid: string, isPlatform: boolean, enabled: boolean) =>
  useQuery({
    queryKey: [...RKEYS.depts(tid), "flows"] as const,
    enabled,
    retry: false,
    queryFn: () =>
      api<OrgResponse>("/admin/org", { query: isPlatform ? { tenant_id: tid } : undefined }),
    select: (o) => o.departments.map((d) => ({ id: d.group_id, name: d.name })),
  });
