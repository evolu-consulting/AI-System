// CR-118 §11.2 · client Hub của "quy trình được gán + luật chọn theo phòng ban" của MỘT tenant × khe. Hợp đồng:
// `@ai/contracts/hub-admin` (process-routing). Gán/bỏ gán: chỉ platform_admin; GET/PUT luật: platform_admin (trang này).
import type { OrgResponse } from "@ai/contracts";
import type { ProcessRouting, PutProcessRoutingRequest } from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
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
