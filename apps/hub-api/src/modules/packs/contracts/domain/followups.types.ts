// W1 · hẹn nhắc chung: kiểu vào/ra ở lớp domain (ADR-0023: domain/application không import `@ai/contracts`).
// Bản sao có chủ đích của `packages/contracts/src/pack-contracts/followups.ts`; `dto-mirror.test.ts` kiểm hai bên khớp nhau.

export type FollowupKind = "obligation" | "contract" | "company" | "renewal";
/** Đầu vào đã qua zod ở route (`FollowupCreateSchema`). */
export type FollowupCreate = {
  subject_kind: FollowupKind;
  subject_id: string;
  at: string;
  note: string | null;
};
export type Followup = {
  id: string;
  subject_kind: FollowupKind;
  subject_id: string;
  contract_id: string | null;
  at: string;
  title: string;
  note: string | null;
  status: "pending" | "sent";
};
