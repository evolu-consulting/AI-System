// CR-118 §6 · §11.2 · "Ứng dụng & quy trình" trong Cài đặt: năng lực của công ty (chỉ đọc) + luật chọn quy trình theo phòng ban.
// `GET /hub-admin/tenants/:tid/capabilities` (tenant_admin: tenant mình, chỉ đọc) và `GET|PUT /tenants/:tid/process-routing/:slot`
// (tenant_admin: tenant mình). Cùng origin: nginx/dev proxy chuyển `/hub-admin` + `/tenants` sang hub-api. Không gán quy trình ở đây (platform).
import type { TenantCapabilitiesResponse } from "@ai/contracts";
import type {
  ProcessRouting,
  ProcessRoutingDefView,
  PutProcessRoutingRequest,
} from "@ai/contracts/hub-admin";
import { api } from "@ai/web-kit/http";

const enc = encodeURIComponent;
/** Năng lực: nhánh `/hub-admin`; luật chọn quy trình: mount ở GỐC hub như `/tenants/:tid/process-slots` (processes.mount). */
const CAP = (tid: string) => `/hub-admin/tenants/${enc(tid)}/capabilities`;
const ROUTE = (tid: string, slot: string) => `/tenants/${enc(tid)}/process-routing/${enc(slot)}`;

/** Xem sơ đồ một quy trình trong tập gán (tenant_admin CHÍNH tenant; ngoài tập/tenant khác ⇒ 404). */
const DEF = (tid: string, slot: string, defId: string) =>
  `${ROUTE(tid, slot)}/processes/${enc(defId)}`;

export const appsKeys = {
  routingDef: (tid: string, slot: string, defId: string) =>
    ["settings", "apps", "routing-def", tid, slot, defId] as const,
  caps: (tid: string) => ["settings", "apps", "caps", tid] as const,
  routing: (tid: string, slot: string) => ["settings", "apps", "routing", tid, slot] as const,
};

export const fetchCapabilities = (tid: string, signal?: AbortSignal) =>
  api<TenantCapabilitiesResponse>(CAP(tid), { signal });

export const fetchRouting = (tid: string, slot: string, signal?: AbortSignal) =>
  api<ProcessRouting>(ROUTE(tid, slot), { signal });

export const putRouting = (tid: string, slot: string, body: PutProcessRoutingRequest) =>
  api<ProcessRouting>(ROUTE(tid, slot), { method: "PUT", body });

export const fetchRoutingDef = (tid: string, slot: string, defId: string, signal?: AbortSignal) =>
  api<ProcessRoutingDefView>(DEF(tid, slot, defId), { signal });
