// CR-127 · U4 · E3: uỷ quyền `GET/POST /me/delegations`, `DELETE /me/delegations/:id`; quản trị đặt thay: `/tenants/:tid/delegations`.
// Cài đặt công ty: `GET/PUT /tenants/:tid/flow-settings` (`claim_release_h`).
import type {
  CreateDelegationRequest,
  DelegationHistoryResponse,
  DelegationListResponse,
  DelegationWorkResponse,
  FlowSettings,
} from "@ai/contracts/chat";
import { api } from "@ai/web-kit/http";

const enc = encodeURIComponent;
export const delegationKeys = {
  mine: ["settings", "delegations"] as const,
  history: ["settings", "delegations", "history"] as const,
  flow: ["settings", "flow-settings"] as const,
};

export const fetchMyDelegations = (signal?: AbortSignal) =>
  api<DelegationListResponse>("/me/delegations", { signal });
/** CR-184 · lịch sử uỷ quyền (tải dần). Quản trị công ty xem cả công ty (`/tenants/:tid`), người thường chỉ phần có mình (`/me`). */
const scope = (tenantId: string | null, admin: boolean) =>
  admin && tenantId ? `/tenants/${enc(tenantId)}/delegations` : "/me/delegations";
export const fetchDelegationHistory = (
  tenantId: string | null,
  admin: boolean,
  cursor: string | null,
  signal?: AbortSignal,
) =>
  api<DelegationHistoryResponse>(`${scope(tenantId, admin)}/history`, {
    query: { limit: "20", ...(cursor ? { cursor } : {}) },
    signal,
  });
export const fetchDelegationWork = (
  tenantId: string | null,
  admin: boolean,
  id: string,
  cursor: string | null,
  signal?: AbortSignal,
) =>
  api<DelegationWorkResponse>(`${scope(tenantId, admin)}/${enc(id)}/work`, {
    query: { limit: "20", ...(cursor ? { cursor } : {}) },
    signal,
  });
/** «Ký hợp đồng» chỉ chọn được khi người được giao thuộc nhóm người ký hợp đồng (`DELEGATE_NOT_SIGNER`). */
export const fetchEsignEligible = (userId: string, signal?: AbortSignal) =>
  api<{ eligible: boolean }>("/me/delegations/esign-eligible", {
    query: { user_id: userId },
    signal,
  });
export const createDelegation = (tenantId: string | null, b: CreateDelegationRequest) =>
  api<unknown>(
    b.for_user_id && tenantId ? `/tenants/${enc(tenantId)}/delegations` : "/me/delegations",
    {
      method: "POST",
      body: b,
    },
  );
export const revokeDelegation = (id: string) =>
  api<unknown>(`/me/delegations/${enc(id)}`, { method: "DELETE" });

export const fetchFlowSettings = (tenantId: string, signal?: AbortSignal) =>
  api<FlowSettings>(`/tenants/${enc(tenantId)}/flow-settings`, { signal });
export const saveFlowSettings = (tenantId: string, s: FlowSettings) =>
  api<FlowSettings>(`/tenants/${enc(tenantId)}/flow-settings`, { method: "PUT", body: s });
