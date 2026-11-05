// contract-flow S2 · ADR-0023: bản sao kiểu/hằng của DTO mẫu luồng duyệt (`@ai/contracts` pack-contracts/approval-flow.ts) cho lớp
// 1–2 (domain chỉ import builtin). Khớp hai chiều kiểm ở `approval-flow.rules.test.ts` (hằng chạy, kiểu lúc typecheck).

export const APPROVAL_FLOW_STEPS_MAX = 20;
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
  | "DIFY_PARAM_UNSUPPORTED"
  | "DIFY_INPUT_UNKNOWN"
  | "ESIGN_MULTI"
  | "ESIGN_NOT_LAST"
  | "SIGNER_GROUP_REQUIRED"
  | "SIGNER_USER_REQUIRED"
  | "USER_NOT_MEMBER"
  | "NOTIFY_TO_REQUIRED"
  | "NOTIFY_CHANNEL_REQUIRED"
  | "NOTIFY_TITLE_REQUIRED"
  | "WAIT_OFFSET_RANGE";

/** cf-dify · workflow Dify trong catalog mà tenant được dùng (khoá, tên, tham số khai trong `input_schema`). */
export type FlowContractField = "contract_id" | "title" | "deal" | "total_value" | "partner";
export type DifyParam = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  /** Lựa chọn của tham số `select`. */
  options?: readonly string[];
};
export type DifyWorkflow = { key: string; name: string; params: readonly DifyParam[] };
export type ApprovalFlowIssue = { path: string; rule: ApprovalFlowRule };

export type FlowDeal = "buy" | "sell" | "referral";
/** CR-121 D-0 · `creator_department` theo MÃ Group (tính cả phòng con); `new_partner` = chưa có HĐ được duyệt với đối tác. */
export type FlowCond =
  | { field: "deal"; in: FlowDeal[] }
  | { field: "total_value"; op: "ge" | "gt" | "le" | "lt"; value: number }
  | { field: "creator_department"; in: string[] }
  | { field: "new_partner"; is: boolean };
/** Nhóm điều kiện lồng một cấp (không có `field`). */
export type FlowCondGroup = { op: "and" | "or"; conds: FlowCond[] };
export type FlowWhen = { op: "and" | "or"; conds: (FlowCond | FlowCondGroup)[] };
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
  /** esign-flow · người duyệt cụ thể (thay phòng khi đặt). */
  approver_user_id?: string | null | undefined;
};
export type FlowDifyStep = {
  kind: "dify";
  key: string;
  name: string;
  workflow_key: string;
  /** dify-input-map · tham số workflow ⇒ trường HĐ (vắng ⇒ khớp cùng tên). */
  inputs?: Record<string, FlowContractField> | undefined;
  after: "auto";
};
export type FlowEsignSigner = {
  mode: "owner" | "dept_head" | "user";
  department_group_id?: string | null | undefined;
  user_id?: string | null | undefined;
};
/** esign-flow · bước Ký số (cuối luồng, không phải stage engine — gói tự chạy sau khi duyệt xong). */
export type FlowEsignStep = {
  kind: "esign";
  key: string;
  name: string;
  company_signer: FlowEsignSigner;
  partner_signs: boolean;
  order: "company_first" | "partner_first";
  provider: string | null;
  due_h: number;
  remind_every_h: number | null;
  escalate_group_id: string | null;
};
/** CR-121 D-6 · bước "Thông báo": người gửi duyệt / người phụ trách / thành viên Group (theo MÃ); chạy xong là sang bước kế. */
export type FlowNotifyStep = {
  kind: "notify";
  key: string;
  name: string;
  to: { creator: boolean; owner: boolean; group_key: string | null };
  channels: ("bell" | "email")[];
  /** Mẫu có biến `{ma_hd}` `{ten_hd}` `{gia_tri}`. */
  title: string;
  body: string;
};
/** CR-121 D-6 · bước "Chờ tới": ngày HĐ (`end_date` hết hạn / `action_deadline` hạn xử lý) + `offset_days` lúc `time`. */
export type FlowWaitStep = {
  kind: "wait_until";
  key: string;
  name: string;
  from: "end_date" | "action_deadline";
  offset_days: number;
  time: string;
};
export type FlowStep =
  | FlowReviewStep
  | FlowDifyStep
  | FlowEsignStep
  | FlowNotifyStep
  | FlowWaitStep;
/** Bước chạy trên engine (review + Dify + Thông báo + Chờ tới); bước Ký số do gói chạy sau "Đã duyệt". */
export type FlowEngineStep = FlowReviewStep | FlowDifyStep | FlowNotifyStep | FlowWaitStep;
export type ApprovalFlowResponse = {
  version: number;
  is_default: boolean;
  steps: FlowStep[];
  updated_at: string | null;
};
