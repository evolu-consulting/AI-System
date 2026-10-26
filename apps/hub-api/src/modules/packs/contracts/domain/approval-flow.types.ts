// contract-flow S2 · ADR-0023: bản sao kiểu/hằng của DTO mẫu luồng duyệt (`@ai/contracts` pack-contracts/approval-flow.ts) cho lớp
// 1–2 (domain chỉ import builtin). Khớp hai chiều kiểm ở `approval-flow.rules.test.ts` (hằng chạy, kiểu lúc typecheck).

export const APPROVAL_FLOW_STEPS_MAX = 8;
/** = `ESCALATE_AFTER_H` của engine. */
export const APPROVAL_FLOW_DUE_H = { min: 4, max: 2160 } as const;
/** = `REMIND_EVERY_H` của engine. */
export const APPROVAL_FLOW_REMIND_H = { min: 4, max: 168 } as const;
export const APPROVAL_FLOW_DUE_DEFAULT_H = 72;

export type ApprovalFlowRule =
  | "KEY_DUP"
  | "STEPS_MAX"
  | "FIRST_NOT_REVIEW"
  | "FIRST_CONDITIONAL"
  | "AFTER_DIFY_CONDITIONAL"
  | "GROUP_REQUIRED"
  | "ESCALATE_SAME_GROUP"
  | "DUE_RANGE"
  | "REMIND_RANGE"
  | "DIFY_WORKFLOW_UNKNOWN"
  | "DIFY_PARAM_UNSUPPORTED";

/** cf-dify · workflow Dify trong catalog mà tenant được dùng (khoá, tên, tham số khai trong `input_schema`). */
export type DifyParam = { name: string; type: string; required: boolean };
export type DifyWorkflow = { key: string; name: string; params: readonly DifyParam[] };
export type ApprovalFlowIssue = { path: string; rule: ApprovalFlowRule };

export type FlowDeal = "buy" | "sell" | "referral";
export type FlowCond =
  | { field: "deal"; in: FlowDeal[] }
  | { field: "total_value"; op: "ge" | "gt" | "le" | "lt"; value: number };
export type FlowWhen = { op: "and" | "or"; conds: FlowCond[] };
export type FlowReviewStep = {
  kind: "review";
  key: string;
  name: string;
  department_group_id: string | null;
  head_only: boolean;
  due_h: number;
  remind_every_h: number | null;
  escalate_group_id: string | null;
  exclude_starter: boolean;
  when: FlowWhen | null;
};
export type FlowDifyStep = {
  kind: "dify";
  key: string;
  name: string;
  workflow_key: string;
  after: "auto";
};
export type FlowStep = FlowReviewStep | FlowDifyStep;
export type ApprovalFlowResponse = {
  version: number;
  is_default: boolean;
  steps: FlowStep[];
  updated_at: string | null;
};
