// V2-C · V2-I · ADR-0023: bản sao kiểu/hằng số vai đối tác (`@ai/contracts` pack-contracts/partner-roles) cho lớp 1–2 — khớp hai
// chiều kiểm ở `dto-mirror.test.ts`.

export type PartnerDeal = "referral" | "buy" | "sell";
export type PartnerRoleV2 = "customer" | "supplier" | "commission_payer";
export type ScoreBand = "good" | "fair" | "watch";
export const NEW_PARTNER_LABEL = "Đối tác mới · sẽ tạo khi lưu";

export type PartnerLookup =
  | {
      status: "existing";
      party: string;
      name: string | null;
      tax_id: string | null;
      roles: PartnerRoleV2[];
      role: PartnerRoleV2 | null;
      has_role: boolean;
      is_new: boolean;
      score: number | null;
      band: ScoreBand | null;
    }
  | { status: "new"; party: string; role: PartnerRoleV2 | null; label: string };

export type PartnerWebLine = { title: string; summary: string; source: string | null };
export type PartnerContractCount = { party: string; n: number };

export type PartnerContractRow = {
  id: string;
  title: string;
  number: string | null;
  deal: "buy" | "sell" | "referral" | null;
  value: number | null;
  start_date: string | null;
  end_date: string | null;
  stage: "not_started" | "in_progress" | "done";
  next: { title: string; due_date: string; overdue: boolean } | null;
};

export type PartnerNote = {
  id: string;
  party: string;
  body: string;
  source: "manual" | "internet";
  by_user: string | null;
  by: string | null;
  at: string;
};

export type PartnerContactIn = { party: string; phone: string | null; contact: string | null };

export type PartnerContactPerson = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  our_owner: string | null;
};
export type PartnerContactsPut = {
  party: string;
  contacts: Omit<PartnerContactPerson, "id">[];
};

export type PartnerProfile = {
  party: string;
  name: string | null;
  tax_id: string | null;
  phone: string | null;
  contact: string | null;
};

export type PartnerRoleRow = {
  party: string;
  role: PartnerRoleV2;
  name: string | null;
  created_from: "contract" | "backfill" | "manual";
  contract_id: string | null;
  first_at: string;
  events: number;
  min_events: number;
  is_new: boolean;
};
