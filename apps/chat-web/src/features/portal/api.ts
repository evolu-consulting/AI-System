// portal-home · gọi API cho trang chủ AI System: app mặc định (admin-api) + con số cho thẻ (Sổ Hợp Tác qua hub-api, đúng quyền người gọi).
import {
  type DefaultAppRequest,
  MY_DEFAULT_APP_PATH,
  PORTAL_PATH,
  type PortalResponse,
  TENANT_DEFAULT_APP_PATH,
  type TodoOut,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

export const fetchPortal = (signal?: AbortSignal) => api<PortalResponse>(PORTAL_PATH, { signal });
export const putMyDefaultApp = (b: DefaultAppRequest) =>
  api<PortalResponse>(MY_DEFAULT_APP_PATH, { method: "PUT", body: b });
export const putTenantDefaultApp = (b: DefaultAppRequest) =>
  api<PortalResponse>(TENANT_DEFAULT_APP_PATH, { method: "PUT", body: b });
export const fetchContractsTodo = (signal?: AbortSignal) =>
  api<TodoOut>("/pack/contracts/my-work/todo", { signal });
