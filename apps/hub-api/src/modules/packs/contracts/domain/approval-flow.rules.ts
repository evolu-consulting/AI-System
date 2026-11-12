// contract-flow S2 · mẫu luồng duyệt HĐ theo tenant: luật thuần (lớp 1) — kiểm mẫu, mẫu mặc định từ `approval_settings` (giữ
// hành vi 2 bước cũ), điều kiện AND/OR theo loại HĐ + giá trị (trống ⇒ cần bước, như `needsLevel2`), bước áp dụng kế tiếp và
// dịch mẫu ⇒ def engine `contracts-approval` (`compileDef`). Bản mẫu: def HD3 cũ (`git show 7754adec^:…/approval-def.rules.ts`).

import { ownerAlsoGroups } from "@ai/contracts/flow";
import type { ApprovalSettings } from "./approval-def.rules";
import {
  APPROVAL_FLOW_DUE_DEFAULT_H,
  APPROVAL_FLOW_DUE_H,
  APPROVAL_FLOW_REMIND_H,
  APPROVAL_FLOW_STEPS_MAX,
  type ApprovalFlowIssue,
  type ApprovalFlowRule,
  type DifyWorkflow,
  type FlowEngineStep,
  type FlowStep,
} from "./approval-flow.types";
import { type FlowFacts, whenHolds } from "./approval-flow-cond.rules";
import {
  DIFY_CONTRACT_INPUTS,
  type DifyParamName,
  type DifySelectBinding,
  difyArgs,
  difySelectBindings,
  hasDifyStep,
} from "./approval-flow-dify.rules";
import { esignIssues } from "./approval-flow-esign.rules";
import {
  autoStageOf,
  hasNotifyOrWait,
  notifyDefInputs,
  notifyWaitIssues,
} from "./approval-flow-notify.rules";
import { escalateOf } from "./approval-owner.rules";

export type {
  ApprovalFlowIssue,
  ApprovalFlowResponse,
  DifyWorkflow,
  FlowEngineStep,
  FlowEsignStep,
  FlowStep,
} from "./approval-flow.types";
export {
  DIFY_CONTRACT_INPUTS,
  type DifySelectBinding,
  difyArgs,
  difyArgsOf,
  difyRunInputs,
  difySelectBindings,
  hasDifyStep,
  validateDifyCatalog,
} from "./approval-flow-dify.rules";
export { esignCard, esignIssues, esignStepOf, flowUserIds } from "./approval-flow-esign.rules";

export const APPROVAL_PROCESS_KEY = "contracts-approval";

// CR-121 D-0 · điều kiện bước tách sang `approval-flow-cond.rules.ts` (giữ đường import cũ).
export { condHasData, condHolds, type FlowFacts, whenHolds } from "./approval-flow-cond.rules";

/** Bước Dify luôn chạy (không điều kiện); bước review theo `when`. Bước Ký số không là bước engine (lọc bằng `engineSteps`). */
export const stepApplies = (s: FlowStep, f: FlowFacts): boolean =>
  s.kind === "dify" ||
  s.kind === "notify" ||
  s.kind === "wait_until" ||
  (s.kind === "review" && whenHolds(s.when, f));

/** esign-flow · các bước chạy trên engine (review + Dify). Bước Ký số luôn ở CUỐI ⇒ chỉ số bước engine không đổi. */
export const engineSteps = (steps: readonly FlowStep[]): FlowEngineStep[] =>
  steps.filter((s): s is FlowEngineStep => s.kind !== "esign");

/** Chỉ số bước người dùng áp dụng kế sau `from`; không còn ⇒ `steps.length` (= ghi "Đã duyệt"). */
export function nextApplicable(steps: readonly FlowStep[], f: FlowFacts, from: number): number {
  for (let j = from + 1; j < steps.length; j++) if (stepApplies(steps[j] as FlowStep, f)) return j;
  return steps.length;
}

/** Chỉ số các bước bắt buộc theo giá trị hiện tại (finalize kiểm mọi bước này đã Đạt). */
export function requiredSteps(steps: readonly FlowStep[], f: FlowFacts): number[] {
  return steps.flatMap((s, i) => (i === 0 || stepApplies(s, f) ? [i] : []));
}

/** Bước engine của bước người dùng `i` (0 ⇒ 0; i ≥ 1 ⇒ i + 1 vì `route` ở bước 1); `i = n` ⇒ `finalize`. */
export const engineStepOf = (i: number): number => (i === 0 ? 0 : i + 1);

/** Giá trị `next` tool `contracts-route` trả ở bước người dùng `from` (route sau bước 0 dùng `from = 0`). */
export const routeNext = (steps: readonly FlowStep[], f: FlowFacts, from: number): number =>
  engineStepOf(nextApplicable(steps, f, from));

// ── Kiểm mẫu ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const inRange = (v: number, r: { min: number; max: number }) =>
  Number.isInteger(v) && v >= r.min && v <= r.max;

function reviewIssues(s: Extract<FlowStep, { kind: "review" }>, i: number): ApprovalFlowIssue[] {
  const out: ApprovalFlowIssue[] = [];
  const add = (f: string, rule: ApprovalFlowRule) => out.push({ path: `steps.${i}.${f}`, rule });
  if (s.department_group_id === null && !s.approver_user_id)
    add("department_group_id", "GROUP_REQUIRED");
  if (s.escalate_group_id !== null && s.escalate_group_id === s.department_group_id)
    add("escalate_group_id", "ESCALATE_SAME_GROUP");
  if (!inRange(s.due_h, APPROVAL_FLOW_DUE_H)) add("due_h", "DUE_RANGE");
  if (s.remind_every_h !== null && !inRange(s.remind_every_h, APPROVAL_FLOW_REMIND_H))
    add("remind_every_h", "REMIND_RANGE");
  return out;
}

/** Luật chéo bước (hình dạng đã qua zod). Rỗng ⇒ hợp lệ. Nhóm tồn tại ở tenant xét ở use case. */
export function validateFlow(steps: readonly FlowStep[]): ApprovalFlowIssue[] {
  const out: ApprovalFlowIssue[] = [];
  if (steps.length < 1 || steps.length > APPROVAL_FLOW_STEPS_MAX)
    out.push({ path: "steps", rule: "STEPS_MAX" });
  const first = steps[0];
  if (first && first.kind !== "review")
    out.push({ path: "steps.0.kind", rule: "FIRST_NOT_REVIEW" });
  if (first?.kind === "review" && first.when !== null)
    out.push({ path: "steps.0.when", rule: "FIRST_CONDITIONAL" });
  const seen = new Set<string>();
  steps.forEach((s, i) => {
    if (seen.has(s.key)) out.push({ path: `steps.${i}.key`, rule: "KEY_DUP" });
    seen.add(s.key);
    const prev = steps[i - 1];
    // CR-121 D-6 · bước tự sang bước kế (Dify / Thông báo / Chờ tới) không rẽ ⇒ bước sau nó không được có điều kiện.
    const autoPrev =
      prev?.kind === "dify" || prev?.kind === "notify" || prev?.kind === "wait_until";
    if (autoPrev && s.kind === "review" && s.when !== null)
      out.push({ path: `steps.${i}.when`, rule: "AFTER_DIFY_CONDITIONAL" });
    if (s.kind === "review") out.push(...reviewIssues(s, i));
    out.push(...notifyWaitIssues(s, i));
  });
  out.push(...esignIssues(steps));
  return out;
}

/** Nhóm (duyệt + chuyển cấp + phòng người ký) mà mẫu tham chiếu. */
export function flowGroupIds(steps: readonly FlowStep[]): string[] {
  const ids = new Set<string>();
  for (const s of steps) {
    if (s.kind === "dify" || s.kind === "notify" || s.kind === "wait_until") continue;
    if (s.escalate_group_id) ids.add(s.escalate_group_id);
    const g = s.kind === "review" ? s.department_group_id : s.company_signer.department_group_id;
    if (g) ids.add(g);
  }
  return [...ids];
}

/**
 * Mẫu mặc định = máy 2 bước cũ: bước 1 nhóm cấp 1 (người gửi được duyệt); bước 2 nhóm cấp 2, người gửi không được, chỉ khi
 * giá trị ≥ ngưỡng hoặc trống. `groupIds` = khoá Group ⇒ id của tenant; thiếu ⇒ `null` (PUT phải chọn nhóm).
 */
export function defaultFlowFromSettings(
  s: ApprovalSettings,
  groupIds: ReadonlyMap<string, string>,
): FlowStep[] {
  const base = {
    kind: "review" as const,
    head_only: false,
    due_h: APPROVAL_FLOW_DUE_DEFAULT_H,
    remind_every_h: null,
    escalate_group_id: null,
  };
  return [
    {
      ...base,
      key: "level1",
      name: "Kiểm tra hợp đồng",
      department_group_id: groupIds.get(s.level1GroupKey) ?? null,
      exclude_starter: false,
      when: null,
    },
    {
      ...base,
      key: "level2",
      name: "Duyệt cấp 2",
      department_group_id: groupIds.get(s.level2GroupKey) ?? null,
      exclude_starter: true,
      when: { op: "and", conds: [{ field: "total_value", op: "ge", value: s.threshold }] },
    },
  ];
}
