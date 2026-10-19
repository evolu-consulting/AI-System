// HD-FR-01 · HD-FR-03 · D-04 · plan §1/§4: kiểu trạng thái hợp đồng (khớp `CONTRACT_STATUSES`/`HANDLED_OUTCOMES` ở contract
// zod T4; domain không import ngoài built-in nên khai lại, test parity ở T4/T5).

export const CONTRACT_STATUS_ORDER = [
  "extracting",
  "extract_failed",
  "needs_review",
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
  "rejected",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUS_ORDER)[number];

export const HANDLED_OUTCOME_ORDER = ["renewed", "not_renewed", "negotiating", "replaced"] as const;
export type HandledOutcome = (typeof HANDLED_OUTCOME_ORDER)[number];

export const isContractStatus = (s: unknown): s is ContractStatus =>
  (CONTRACT_STATUS_ORDER as readonly unknown[]).includes(s);
