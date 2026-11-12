// CR-127 Z3d · (test) biên dịch mẫu `Flow` ⇒ def engine `contracts-approval` (stage route/finalize). Production không còn đường này
// (duyệt HĐ chạy bằng quy trình gán trên app, xem Z3); chỉ giữ cho fixture khe `contracts.approval` của test thư viện quy trình.
import { ownerAlsoGroups } from "@ai/contracts/flow";
import {
  APPROVAL_PROCESS_KEY,
  engineStepOf,
  engineSteps,
  stepApplies,
} from "../../domain/approval-flow.rules";
import type { DifyWorkflow, FlowEngineStep, FlowStep } from "../../domain/approval-flow.types";
import {
  DIFY_CONTRACT_INPUTS,
  type DifyParamName,
  type DifySelectBinding,
  difyArgs,
  difySelectBindings,
  hasDifyStep,
} from "../../domain/approval-flow-dify.rules";
import {
  autoStageOf,
  hasNotifyOrWait,
  notifyDefInputs,
} from "../../domain/approval-flow-notify.rules";
import { escalateOf } from "../../domain/approval-owner.rules";

export const FLOW_TOOL_KEYS = { route: "contracts-route", finalize: "contracts-finalize" } as const;
/** Khoá stage engine: bước người dùng i ⇒ `s<i>`; stage rẽ sau bước 0 ⇒ `route`; ghi "Đã duyệt" ⇒ `finalize`. */
export const ROUTE_STAGE = "route";
export const FINALIZE_STAGE = "finalize";
export const stageKeyOf = (i: number): string => `s${i}`;
/** Trường output của tool `contracts-route` (= bước engine sẽ tới). */
export const NEXT_FIELD = "next";

// ── Dịch ⇒ def engine ────────────────────────────────────────────────────────────────────────────────────────────────
const ARGS = { contract_id: { from: "input", key: "contract_id" } } as const;
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

/** prod-fix2 · Group "cũng quyết" của bước = Group Toàn quyền của gói còn ở tenant, trừ chính Group của bước; rỗng ⇒ không ghi. */
function alsoOf(group: string, owners: readonly string[], ids: ReadonlySet<string>, keep = false) {
  const live = owners.filter((g) => ids.has(g));
  const also = ownerAlsoGroups(live, group, keep); // luật chung CR-113 (cùng flow theo sự kiện)
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
  return { approver_user_id: s.approver_user_id, ...alsoOf(group, owners, groupIds, true) };
}

function stageOfStep(
  steps: readonly FlowEngineStep[],
  i: number,
  groupIds: ReadonlySet<string>,
  wfs: ReadonlyMap<string, DifyWorkflow>,
  o: { owners: readonly string[]; escalateTo: readonly string[] },
) {
  const owners = o.owners;
  const s = steps[i] as FlowEngineStep;
  const step = engineStepOf(i);
  if (s.kind === "notify" || s.kind === "wait_until")
    return autoStageOf(s, stageKeyOf(i), step) as unknown as ReturnType<typeof toolStage>;
  if (s.kind === "dify") {
    const after = { kind: "auto", branch: [] };
    return toolStage({
      key: stageKeyOf(i),
      name: s.name,
      step,
      tool: s.workflow_key,
      args: difyArgs(wfs.get(s.workflow_key), s.inputs, i),
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
    escalate: escalateOf(s, { group, groupIds, escalateTo: o.escalateTo }, (g) =>
      groupOf(g, groupIds),
    ),
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

/** Input run: `contract_id` bắt buộc; có bước Dify ⇒ thêm dữ liệu HĐ (tuỳ chọn, `openRun` điền). */
function defInputs(withDify: boolean, selects: readonly DifySelectBinding[] = []) {
  const names = Object.keys(DIFY_CONTRACT_INPUTS) as DifyParamName[];
  const base = names
    .filter((k) => withDify || k === "contract_id")
    .map((k) => ({
      key: DIFY_CONTRACT_INPUTS[k].key,
      label: DIFY_CONTRACT_INPUTS[k].label,
      type: DIFY_CONTRACT_INPUTS[k].type,
      required: k === "contract_id",
    }));
  const extra = selects.map((s) => ({ key: s.key, label: s.key, type: "text", required: false }));
  return [...base, ...extra];
}

/**
 * Def `contracts-approval` (= body `POST /process-defs`): `s0` (route + review bước 0) → `route` (tự rẽ theo `next`) →
 * `s1..sn` (tool + review/Dify + rẽ) → `finalize` (tool `contracts-finalize`). `groupIds` = Group hiện có của tenant; mẫu trỏ
 * Group không còn ⇒ ném `approval-flow-group-missing` (người gọi rơi về mẫu mặc định / báo lỗi). prod-fix2 · `owners` = Group
 * "Toàn quyền" của gói (Group cấp 2 của cài đặt + Group vai owner): thành viên quyết được MỌI bước duyệt (`also_group_ids` của
 * engine — như máy cũ "người duyệt cấp 2 xác nhận được cấp 1"), vẫn chịu `exclude_starter`. CR-113 · `escalateTo` = Group
 * Toàn quyền theo thứ tự ưu tiên: bước có hạn, không đặt nhóm chuyển cấp ⇒ chuyển cấp về Group đầu tiên hợp lệ (`defaultEscalateOf`).
 */
export function compileDef(
  flow: { steps: readonly FlowStep[] },
  groupIds: ReadonlySet<string>,
  workflows: ReadonlyMap<string, DifyWorkflow> = new Map(),
  owners: readonly string[] = [],
  escalateTo: readonly string[] = [],
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
  // CR-105 · pl-slot-shape: `stage.slot` = bước người dùng nguyên vẹn (engine bỏ qua) ⇒ `fromStages` dựng lại đúng; bước Ký số
  // nằm ở `finalize.slot.esign` (không là stage engine).
  const [first, ...rest] = steps.map((s, i) => ({
    ...stageOfStep(steps, i, groupIds, workflows, { owners, escalateTo }),
    slot: { ...s },
  }));
  if (!first) throw new Error("approval-flow-empty");
  const esign = flow.steps.find((s) => s.kind === "esign");
  if (esign) (finalize as { slot?: Record<string, unknown> }).slot = { esign: { ...esign } };
  return {
    key: APPROVAL_PROCESS_KEY,
    name: "Duyệt hợp đồng",
    description: "Duyệt hợp đồng qua các phòng ban theo luồng công ty cài đặt.",
    input_hint: "Mã hợp đồng",
    run_group_ids: [] as string[],
    token_budget: null,
    enabled: true,
    sources: [] as string[],
    // CR-121 D-6 · Thông báo / Chờ tới dùng dữ liệu HĐ (tiêu đề, giá trị — chung input của Dify) + input riêng.
    inputs: [
      ...defInputs(
        hasDifyStep(steps) || hasNotifyOrWait(steps),
        difySelectBindings(steps, [...workflows.values()]),
      ),
      ...notifyDefInputs(steps),
    ],
    ttl_days: null,
    stages: [first, route, ...rest, finalize],
  };
}
