// CR-182 · cổng (kiểu) của SQL «Đối tác ký qua link» — adapter `adapters/partner-sign.repo.ts` cài, mount tiêm vào use case (khuôn `signatures`:
// `application/ports.ts` + `adapters/*.store.ts`). Lớp 2 — chỉ kiểu; không I/O.
import type { PartnerLinkState, PartnerQuickMethod } from "@ai/contracts/pack-contracts";

export type LinkRow = {
  link_id: string;
  tenant_id: string;
  contract_id: string;
  contact_id: string;
  state: PartnerLinkState;
  expires_at: Date | string;
  sent_at: Date | string | null;
  opened_at: Date | string | null;
  signed_at: Date | string | null;
  declined_at: Date | string | null;
  decline_reason: string | null;
  quick_id: string | null;
  quick_method: PartnerQuickMethod | null;
};
export type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  partner_name: string | null;
};
export type LinkStatusRow = {
  state: PartnerLinkState;
  sent_at: Date | string | null;
  opened_at: Date | string | null;
  expires_at: Date | string;
  signed_at: Date | string | null;
  declined_at: Date | string | null;
  decline_reason: string | null;
  contact_name: string | null;
};
export type CloseCode = "ok" | "closed" | "gone" | "limit" | "invalid";

export type PartnerSignRepo = {
  /** Tra link theo BĂM token (DEFINER). `audit` ⇒ ghi `opened_at` lần đầu. */
  open(th: string, audit: boolean): Promise<LinkRow | null>;
  quickPut(th: string, method: PartnerQuickMethod, pngB64: string): Promise<CloseCode>;
  quickGet(th: string): Promise<{ id: string; png: Uint8Array } | null>;
  finish(th: string, how: "sign" | "decline", why: string | null): Promise<CloseCode>;
  /** Khoá hàng link FOR UPDATE (DEFINER) ⇒ open | signed | declined | expired | revoked | invalid. */
  lockState(th: string): Promise<string>;
  signedRun(contractId: string): Promise<string | null>;
  versionCount(contractId: string, contactId: string): Promise<number>;
  contract(
    contractId: string,
  ): Promise<{ title: string; created_by: string; company_name: string } | null>;
  firstContact(contractId: string): Promise<ContactRow | null>;
  contact(contactId: string, contractId: string): Promise<ContactRow | null>;
  lock(contractId: string): Promise<void>;
  hasActive(contractId: string): Promise<boolean>;
  revokeActive(contractId: string): Promise<number>;
  insert(l: {
    id: string;
    contractId: string;
    contactId: string;
    hash: string;
    expiresAt: Date;
    by: string;
  }): Promise<void>;
  markSent(linkId: string): Promise<void>;
  latest(contractId: string): Promise<LinkStatusRow | null>;
  versionOut(
    contractId: string,
    fileId: string,
    versionId: string,
  ): Promise<{ org: string; box_id: string; name: string } | null>;
};
