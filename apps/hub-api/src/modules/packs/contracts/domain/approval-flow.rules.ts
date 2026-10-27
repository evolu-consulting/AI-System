// contract-flow S2 · mẫu luồng duyệt HĐ theo tenant: luật thuần (lớp 1) — kiểm mẫu, mẫu mặc định từ `approval_settings` (giữ
// hành vi 2 bước cũ), điều kiện AND/OR theo loại HĐ + giá trị (trống ⇒ cần bước, như `needsLevel2`), bước áp dụng kế tiếp và
// dịch mẫu ⇒ def engine `contracts-approval` (`compileDef`). Bản mẫu: def HD3 cũ (`git show 7754adec^:…/approval-def.rules.ts`).

import type { ApprovalSettings } from "./approval-def.rules";
import {
  APPROVAL_FLOW_DUE_DEFAULT_H,
  APPROVAL_FLOW_DUE_H,
  APPROVAL_FLOW_REMIND_H,
  APPROVAL_FLOW_STEPS_MAX,
  type ApprovalFlowIssue,
  type ApprovalFlowRule,
  type DifyWorkflow,
  type FlowCond,
  type FlowDeal,
  type FlowEngineStep,
  type FlowStep,
  type FlowWhen,
} from "./approval-flow.types";
import {
  DIFY_CONTRACT_INPUTS,
  type DifyParamName,
  difyArgsOf,
  hasDifyStep,
} from "./approval-flow-dify.rules";
import { esignIssues } from "./approval-flow-esign.rules";

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
  difyArgsOf,
  difyRunInputs,
  hasDifyStep,
  validateDifyCatalog,
} from "./approval-flow-dify.rules";
export { esignCard, esignIssues, esignStepOf, flowUserIds } from "./approval-flow-esign.rules";

export const APPROVAL_PROCESS_KEY = "contracts-approval";
export const FLOW_TOOL_KEYS = { route: "contracts-route", finalize: "contracts-finalize" } as const;
/** Khoá stage engine: bước người dùng i ⇒ `s<i>`; stage rẽ sau bước 0 ⇒ `route`; ghi "Đã duyệt" ⇒ `finalize`. */
export const ROUTE_STAGE = "route";
export const FINALIZE_STAGE = "finalize";
export const stageKeyOf = (i: number): string => `s${i}`;
/** Trường output của tool `contracts-route` (= bước engine sẽ tới). */
export const NEXT_FIELD = "next";

/** Giá trị HIỆN TẠI của HĐ lúc rẽ (sau sửa tay). */
export type FlowFacts = { deal: FlowDeal | null; total_value: unknown };

// ── Điều kiện ────────────────────────────────────────────────────────────────────────────────────────────────────────
const validTotal = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Một điều kiện; dữ liệu trống (loại HĐ / giá trị không hợp lệ) ⇒ ĐÚNG (an toàn: cần bước, như `needsLevel2`). */
export function condHolds(c: FlowCond, f: FlowFacts): boolean {
  if (c.field === "deal") return f.deal === null || c.in.includes(f.deal);
  const v = f.total_value;
  if (!validTotal(v)) return true;
  if (c.op === "ge") return v >= c.value;
  if (c.op === "gt") return v > c.value;
  if (c.op === "le") return v <= c.value;
  return v < c.value;
}

export function whenHolds(w: FlowWhen | null, f: FlowFacts): boolean {
  if (w === null) return true;
  return w.op === "and"
    ? w.conds.every((c) => condHolds(c, f))
    : w.conds.some((c) => condHolds(c, f));
}

/** Bước Dify luôn chạy (không điều kiện); bước review theo `when`. Bước Ký số không là bước engine (lọc bằng `engineSteps`). */
export const stepApplies = (s: FlowStep, f: FlowFacts): boolean =>
  s.kind === "dify" || (s.kind === "review" && whenHolds(s.when, f));

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
    if (prev?.kind === "dify" && s.kind === "review" && s.when !== null)
      out.push({ path: `steps.${i}.when`, rule: "AFTER_DIFY_CONDITIONAL" });
    if (s.kind === "review") out.push(...reviewIssues(s, i));
  });
  out.push(...esignIssues(steps));
  return out;
}

/** Nhóm (duyệt + chuyển cấp + phòng người ký) mà mẫu tham chiếu. */
export function flowGroupIds(steps: readonly FlowStep[]): string[] {
  const ids = new Set<string>();
  for (const s of steps) {
    if (s.kind === "dify") continue;
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

// ── Dịch ⇒ def engine ────────────────────────────────────────────────────────────────────────────────────────────────
const ARGS = { contract_id: { from: "input", key: "contract-id" } } as const;
/** S3a · tham số `from_step` (= bước người dùng của stage) cho `contracts-route`: tool không biết stage đang chạy. */
export const FROM_STEP_ARG = "from_step";
const routeArgs = (from: number) => ({ ...ARGS, [FROM_STEP_ARG]: { from: "const", value: from } });
const NEXT_FIELDS = [{ key: NEXT_FIELD, type: "number" as const, required: true }];

/** Luật rẽ của stage ở bước người dùng `from`: `next eq E(j) ⇒ goto E(j)` cho mọi đích xa hơn bước kế (bước kế = mặc định). */
function branchFrom(n: number, from: number) {
  const out = [];
  for (let j = from + 2; j <= n; j++) {
    const e = engineStepOf(j);
    out.push({ field: NEXT_FIELD, op: "eq" as const, value: e, goto_step: e });
  }
  return out;
}

type StageOpts = {
  key: string;
  name: string;
  step: number;
  tool: string;
  args: Record<string, unknown>;
  fields: typeof NEXT_FIELDS | [];
  after: Record<string, unknown>;
  timeoutS: number;
};
function toolStage(o: StageOpts) {
  return {
    key: o.key,
    name: o.name,
    step: o.step,
    executor: { kind: "tool", tool_key: o.tool, args: o.args },
    instruction: "",
    output: { filename: `${o.key}.md`, template: "x", required_sections: ["x"], fields: o.fields },
    after: o.after,
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: o.timeoutS,
    token_budget: null,
  };
}

function groupOf(id: string | null, groupIds: ReadonlySet<string>): string {
  if (id === null || !groupIds.has(id)) throw new Error("approval-flow-group-missing");
  return id;
}

/** Args stage tool: mỗi tham số ánh xạ (hoặc khớp cùng tên) ⇒ input run của trường HĐ tương ứng. */
export function difyArgs(wf: DifyWorkflow | undefined, inputs?: Readonly<Record<string, string>>) {
  if (!wf) throw new Error("approval-flow-dify-missing");
  const a = difyArgsOf(wf, inputs);
  if (!a.ok) throw new Error("approval-flow-dify-params");
  return Object.fromEntries(
    a.pairs.map(([p, f]) => [p, { from: "input", key: DIFY_CONTRACT_INPUTS[f].key }]),
  );
}

/** prod-fix2 · Group "cũng quyết" của bước = Group Toàn quyền của gói còn ở tenant, trừ chính Group của bước; rỗng ⇒ không ghi. */
function alsoOf(group: string, owners: readonly string[], groupIds: ReadonlySet<string>) {
  const also = [...new Set(owners)].filter((g) => g !== group && groupIds.has(g));
  return also.length ? { also_group_ids: also } : {};
}

/** esign-flow · Group gắn task của bước: phòng của bước; người duyệt cụ thể mà không phòng ⇒ Group Toàn quyền đầu tiên (cửa
 *  `approver_user_id` chỉ cho người đó quyết phía Group chính; Group Toàn quyền vẫn quyết qua `also_group_ids`). */
function reviewGroupOf(
  s: Extract<FlowStep, { kind: "review" }>,
  groupIds: ReadonlySet<string>,
  owners: readonly string[],
): string {
  if (!s.approver_user_id || (s.department_group_id && groupIds.has(s.department_group_id)))
    return groupOf(s.department_group_id, groupIds);
  return groupOf(owners.find((g) => groupIds.has(g)) ?? null, groupIds);
}

/** Cửa người duyệt cụ thể + Group "cũng quyết": có người cụ thể ⇒ Group Toàn quyền giữ quyền cả khi là Group gắn task. */
function gateAfter(
  s: Extract<FlowStep, { kind: "review" }>,
  group: string,
  owners: readonly string[],
  groupIds: ReadonlySet<string>,
) {
  if (!s.approver_user_id) return alsoOf(group, owners, groupIds);
  const also = [...new Set(owners)].filter((g) => groupIds.has(g));
  return { approver_user_id: s.approver_user_id, ...(also.length ? { also_group_ids: also } : {}) };
}

function stageOfStep(
  steps: readonly FlowEngineStep[],
  i: number,
  groupIds: ReadonlySet<string>,
  wfs: ReadonlyMap<string, DifyWorkflow>,
  owners: readonly string[] = [],
) {
  const s = steps[i] as FlowEngineStep;
  const step = engineStepOf(i);
  if (s.kind === "dify") {
    const after = { kind: "auto", branch: [] };
    return toolStage({
      key: stageKeyOf(i),
      name: s.name,
      step,
      tool: s.workflow_key,
      args: difyArgs(wfs.get(s.workflow_key), s.inputs),
      fields: [],
      after,
      timeoutS: 600,
    });
  }
  const group = reviewGroupOf(s, groupIds, owners);
  const after = {
    kind: "review",
    group_id: group,
    ...(s.head_only && !s.approver_user_id ? { head_only: true } : {}),
    back_to_steps: i === 0 ? [] : [0],
    remind_every_h: s.remind_every_h,
    escalate:
      s.escalate_group_id === null
        ? null
        : { after_h: s.due_h, group_id: groupOf(s.escalate_group_id, groupIds) },
    branch: i === 0 ? [] : branchFrom(steps.length, i),
    exclude_starter: s.exclude_starter,
    ...gateAfter(s, group, owners, groupIds),
  };
  const tool = FLOW_TOOL_KEYS.route;
  return toolStage({
    key: stageKeyOf(i),
    name: s.name,
    step,
    tool,
    args: routeArgs(i),
    fields: NEXT_FIELDS,
    after,
    timeoutS: 60,
  });
}

/** Input run: `contract-id` bắt buộc; có bước Dify ⇒ thêm dữ liệu HĐ (tuỳ chọn, `openRun` điền). */
function defInputs(withDify: boolean) {
  const names = Object.keys(DIFY_CONTRACT_INPUTS) as DifyParamName[];
  return names
    .filter((k) => withDify || k === "contract_id")
    .map((k) => ({
      key: DIFY_CONTRACT_INPUTS[k].key,
      label: DIFY_CONTRACT_INPUTS[k].label,
      type: DIFY_CONTRACT_INPUTS[k].type,
      required: k === "contract_id",
    }));
}

/**
 * Def `contracts-approval` (= body `POST /process-defs`): `s0` (route + review bước 0) → `route` (tự rẽ theo `next`) →
 * `s1..sn` (tool + review/Dify + rẽ) → `finalize` (tool `contracts-finalize`). `groupIds` = Group hiện có của tenant; mẫu trỏ
 * Group không còn ⇒ ném `approval-flow-group-missing` (người gọi rơi về mẫu mặc định / báo lỗi). prod-fix2 · `owners` = Group
 * "Toàn quyền" của gói (Group cấp 2 của cài đặt + Group vai owner): thành viên quyết được MỌI bước duyệt (`also_group_ids` của
 * engine — như máy cũ "người duyệt cấp 2 xác nhận được cấp 1"), vẫn chịu `exclude_starter`.
 */
export function compileDef(
  flow: { steps: readonly FlowStep[] },
  groupIds: ReadonlySet<string>,
  workflows: ReadonlyMap<string, DifyWorkflow> = new Map(),
  owners: readonly string[] = [],
) {
  const steps = engineSteps(flow.steps); // esign-flow · bước Ký số do gói chạy sau finalize
  const n = steps.length;
  const route = toolStage({
    key: ROUTE_STAGE,
    name: "Chọn bước kế",
    step: 1,
    tool: FLOW_TOOL_KEYS.route,
    args: routeArgs(0),
    fields: NEXT_FIELDS,
    after: { kind: "auto", branch: branchFrom(n, 0) },
    timeoutS: 60,
  });
  const finalize = toolStage({
    key: FINALIZE_STAGE,
    name: "Ghi Đã duyệt",
    step: engineStepOf(n),
    tool: FLOW_TOOL_KEYS.finalize,
    args: ARGS,
    fields: [],
    after: { kind: "auto", branch: [] },
    timeoutS: 60,
  });
  const [first, ...rest] = steps.map((_, i) => stageOfStep(steps, i, groupIds, workflows, owners));
  if (!first) throw new Error("approval-flow-empty");
  return {
    key: APPROVAL_PROCESS_KEY,
    name: "Duyệt hợp đồng",
    description: "Duyệt hợp đồng qua các phòng ban theo luồng công ty cài đặt.",
    input_hint: "Mã hợp đồng",
    run_group_ids: [] as string[],
    token_budget: null,
    enabled: true,
    sources: [] as string[],
    inputs: defInputs(hasDifyStep(steps)),
    ttl_days: null,
    stages: [first, route, ...rest, finalize],
  };
}
