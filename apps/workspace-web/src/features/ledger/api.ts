// HD7-FR-04…08 · HD7-FR-10 · HD7-FR-12: sổ đối tác (`/pack/contracts/{obligations,partner-events}`, `/contracts/:id/partner`) —
// port `mgmt-app/web/src/api/partners.ts:52-82`. Đối tác = `party` (khoá `tax:`/`name:`, D7-04) thay `company_id` của mgmt.
import type {
  ContractPartner,
  Obligation,
  PartnerEvent,
  PartnerEventCreate,
  PartnerRole,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";
const q = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) s.set(k, v);
  const t = s.toString();
  return t ? `?${t}` : "";
};

/** Mọi khoá truy vấn của sổ đối tác bắt đầu bằng `partners` ⇒ một lần invalidate làm mới cả danh sách đối tác (HD8). */
export const ledgerKeys = {
  instalments: (party: string, contractId?: string) =>
    ["partners", party, "instalments", contractId ?? ""] as const,
  events: (party: string) => ["partners", party, "events"] as const,
  partner: (contractId: string) => ["contract", contractId, "partner"] as const,
};

export const fetchInstalments = (party: string, contractId?: string, signal?: AbortSignal) =>
  api<Obligation[]>(`${BASE}/obligations${q({ party, contract_id: contractId, status: "open" })}`, {
    signal,
  });
export const fetchPartnerEvents = (party: string, signal?: AbortSignal) =>
  api<PartnerEvent[]>(`${BASE}/partner-events${q({ party })}`, { signal });
export const fetchContractPartner = (contractId: string, signal?: AbortSignal) =>
  api<ContractPartner>(`${BASE}/contracts/${encodeURIComponent(contractId)}/partner`, { signal });

export const settleInstalment = (id: string, at: string) =>
  api<Obligation>(`${BASE}/obligations/${encodeURIComponent(id)}/settle`, {
    method: "POST",
    body: { at },
  });
export const remindInstalment = (id: string) =>
  api<Obligation>(`${BASE}/obligations/${encodeURIComponent(id)}/remind`, {
    method: "POST",
    body: {},
  });
export const postponeInstalment = (id: string, to: string) =>
  api<Obligation>(`${BASE}/obligations/${encodeURIComponent(id)}/postpone`, {
    method: "POST",
    body: { to },
  });
export const recordEvent = (body: PartnerEventCreate) =>
  api<PartnerEvent>(`${BASE}/partner-events`, { method: "POST", body });
/** GAP-D2 · #25: huỷ kèm lý do (không lý do ⇒ thân `{}` như cũ). */
export const voidEvent = (id: string, reason?: string) =>
  api<PartnerEvent>(`${BASE}/partner-events/${encodeURIComponent(id)}/void`, {
    method: "POST",
    body: reason ? { reason } : {},
  });

export type { PartnerRole };
