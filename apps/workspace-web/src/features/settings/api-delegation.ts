// CR-127 · U4 · E3: uỷ quyền `GET/POST /me/delegations`, `DELETE /me/delegations/:id`; quản trị đặt thay: `/tenants/:tid/delegations`.
// Cài đặt công ty: `GET/PUT /tenants/:tid/flow-settings` (`claim_release_h`), `GET/PUT /pack/contracts/partner/settings` (`signer_group_id`).
import type {
  CreateDelegationRequest,
  DelegationListResponse,
  FlowSettings,
} from "@ai/contracts/chat";
import { api } from "@ai/web-kit/http";

const enc = encodeURIComponent;
export const delegationKeys = {
  mine: ["settings", "delegations"] as const,
  flow: ["settings", "flow-settings"] as const,
  partner: ["settings", "partner-settings"] as const,
};

export const fetchMyDelegations = (signal?: AbortSignal) =>
  api<DelegationListResponse>("/me/delegations", { signal });
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

export type PartnerSettings = {
  important_min: number;
  critical_min: number;
  owner_user_id: string | null;
  signer_group_id?: string | null;
};
export const fetchPartnerSettings = (signal?: AbortSignal) =>
  api<PartnerSettings>("/pack/contracts/partner/settings", { signal });
export const savePartnerSettings = (s: PartnerSettings) =>
  api<{ ok: true }>("/pack/contracts/partner/settings", { method: "PUT", body: s });
