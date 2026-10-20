// HD7 · sổ thanh toán: kiểu vào/ra ở lớp domain (ADR-0023: domain/application không import `@ai/contracts`).
// Bản sao có chủ đích của `packages/contracts/src/pack-contracts/ledger.ts`; `dto-mirror.test.ts` kiểm hai bên khớp nhau.
import type { Direction, ObligationKind, PartnerRole } from "./ledger.rules";

/** Việc ghi tay được (`types.MANUAL_TYPES`). */
export const MANUAL_EVENT_TYPES = [
  "appointment_kept",
  "appointment_missed",
  "delivered",
  "complaint",
  "manual_adjust",
] as const;

/** Đầu vào đã qua zod ở route (`ScheduleRequestSchema`). */
export type ScheduleRequest = {
  rows: { due_date: string; amount: number | null; kind: ObligationKind }[];
};
/** Đầu vào đã qua zod ở route (`PartnerEventCreateSchema`). */
export type PartnerEventCreate = {
  party: string;
  role: PartnerRole;
  type: string;
  at?: string | null | undefined;
  days_late?: number | null | undefined;
  delta?: number | null | undefined;
  note?: string | null | undefined;
  contract_id?: string | null | undefined;
};

export type Obligation = {
  id: string;
  contract_id: string;
  party: string | null;
  direction: Direction;
  kind: ObligationKind;
  seq: number;
  due_date: string;
  amount: number | null;
  status: "open" | "done" | "cancelled";
  done_at: string | null;
  postponed_to: string | null;
  postpones: number;
  reminders: number;
  source: "manual" | "ai" | "default" | "cks";
  estimated: boolean;
  basis: string | null;
  contract_number?: string | null;
};
export type PaymentRow = Omit<Obligation, "party" | "contract_number"> & {
  party_key: string | null;
  party: string | null;
  of: number;
  contract_title: string | null;
  days_late: number;
};
export type PaymentsOut = {
  stats: {
    receive_open: string;
    pay_open: string;
    overdue_count: number;
    overdue_amount: string;
    due_7d: string;
  };
  rows: PaymentRow[];
  total: number;
};
export type PartnerEvent = {
  id: string;
  party: string;
  role: PartnerRole;
  type: string;
  at: string;
  by: string | null;
  by_name: string | null;
  source: "action" | "assistant" | "system";
  contract_id: string | null;
  obligation_id: string | null;
  days_late: number | null;
  amount: number | null;
  note: string | null;
  voided: boolean;
  voided_by: string | null;
  voided_at: string | null;
  to?: string;
  was?: string;
  due_date?: string;
  party_late?: boolean;
  kind?: string;
  seq?: number;
  delta?: number;
  criterion?: string;
  value?: number;
  rated_at?: string;
  days_before_expiry?: number;
  with_us?: boolean;
};
export type ContractPartner = {
  party: string | null;
  role: PartnerRole;
  name: string | null;
};
