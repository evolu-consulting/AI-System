// contract-flow S5 · API mẫu luồng duyệt (`/pack/contracts/approval-flow`). Kiểu DTO lấy từ `@ai/contracts` (S2).
import type {
  ApprovalFlowPut,
  ApprovalFlowResponse,
  FlowCond,
  FlowDifyStep,
  FlowReviewStep,
  FlowStep,
  FlowWhen,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

export type { FlowCond, FlowDifyStep, FlowReviewStep, FlowStep, FlowWhen };
export type FlowOut = ApprovalFlowResponse;
export type DealKind = "buy" | "sell" | "referral";
export type ValueOp = "ge" | "gt" | "le" | "lt";

const P = "/pack/contracts/approval-flow";
export const flowKeys = {
  flow: ["settings", "flow"] as const,
  dify: ["settings", "flow", "dify"] as const,
};

export type DifyWorkflowItem = { key: string; name: string };
export const fetchDifyWorkflows = (signal?: AbortSignal) =>
  api<{ items: DifyWorkflowItem[] }>("/pack/contracts/dify-workflows", { signal });

export const fetchFlow = (signal?: AbortSignal) => api<FlowOut>(P, { signal });
export const saveFlow = (body: ApprovalFlowPut) => api<FlowOut>(P, { method: "PUT", body });
