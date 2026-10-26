// W1 · "Việc của tôi": kiểu ra + hằng số ở lớp domain (ADR-0023: domain/application không import `@ai/contracts`).
// Bản sao có chủ đích của `packages/contracts/src/pack-contracts/mywork.ts`; `dto-mirror.test.ts` kiểm hai bên khớp nhau.

export const MYWORK_AHEAD_DAYS = 7;
export const MYWORK_SOURCE_MAX = 100;
export const MYWORK_MAX = 200;

export type MyWorkKind = "followup" | "obligation" | "deadline" | "reminder";
export type MyWorkTone = "late" | "soon" | "dim";
export type MyWorkItem = {
  id: string;
  kind: MyWorkKind;
  tone: MyWorkTone;
  days: number;
  due: string;
  at: string | null;
  title: string | null;
  party: string | null;
  amount: number | null;
  direction: "pay" | "receive" | null;
  contract_direction: "sale" | "purchase" | null;
  contract_id: string | null;
  customer_id: string | null;
  note: string | null;
  milestone: number | null;
  subject: "renewal" | "customer" | "obligation" | "contract" | "company" | null;
};
export type MyWorkApproval = {
  task_id: string;
  contract_id: string;
  contract_number: string | null;
  contract_title: string | null;
  stage_name: string;
  due_at: string | null;
  escalated: boolean;
};
export type MyWorkOut = {
  today: string;
  items: MyWorkItem[];
  counts: { late: number; today: number; upcoming: number };
  truncated: boolean;
  approvals?: MyWorkApproval[];
};
