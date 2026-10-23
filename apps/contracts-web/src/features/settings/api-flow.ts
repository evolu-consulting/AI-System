// contract-flow S5 · API mẫu luồng duyệt (`/pack/contracts/approval-flow`). Kiểu DTO để MỘT chỗ này; khi S2 xuất zod trong
// `@ai/contracts` thì đổi sang import ở đây, nơi khác không đổi.
import { api } from "@ai/web-kit/http";

export type DealKind = "buy" | "sell" | "referral";
export type WhenCmp = "gte" | "lt";
export type StepWhen = {
  op: "and" | "or";
  deal?: DealKind[];
  value?: { cmp: WhenCmp; amount: number };
};
export type ReviewStep = {
  kind: "review";
  key: string;
  name: string;
  department_group_id: string;
  head_only: boolean;
  due_h: number;
  remind_every_h: number | null;
  escalate_group_id: string | null;
  exclude_starter: boolean;
  when: StepWhen | null;
};
export type DifyStep = {
  kind: "dify";
  key: string;
  name: string;
  workflow_key: string;
  after: "auto" | "review";
};
export type FlowStep = ReviewStep | DifyStep;
export type FlowOut = { version: number; is_default: boolean; steps: FlowStep[] };
export type FlowIn = { steps: FlowStep[] };

export const FLOW_MAX_STEPS = 8;

const P = "/pack/contracts/approval-flow";
export const flowKeys = { flow: ["settings", "flow"] as const };

export const fetchFlow = (signal?: AbortSignal) => api<FlowOut>(P, { signal });
export const saveFlow = (body: FlowIn) => api<FlowOut>(P, { method: "PUT", body });
