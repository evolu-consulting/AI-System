// CR-121 D-6 · bước "Thông báo" + "Chờ tới" của quy trình duyệt HĐ ⇒ stage engine `notify` / `wait_until` (tự sang bước kế). Thuần,
// lớp 1. Biến mẫu nghiệp vụ `{ma_hd}` `{ten_hd}` `{gia_tri}` ⇒ input run (`NOTIFY_CONTRACT_INPUTS`, gói điền lúc mở lượt).
import type {
  ApprovalFlowIssue,
  FlowNotifyStep,
  FlowStep,
  FlowWaitStep,
} from "./approval-flow.types";

/** Input run phụ cho bước Thông báo / Chờ tới (khai ở def khi có bước tương ứng; gói điền từ HĐ). */
export const NOTIFY_CONTRACT_INPUTS = {
  number: { key: "contract-number", type: "text", label: "Số hợp đồng" },
  owner: { key: "contract-owner", type: "text", label: "Người phụ trách" },
  end_date: { key: "contract-end-date", type: "date", label: "Ngày hết hạn" },
  action_deadline: { key: "contract-deadline", type: "date", label: "Hạn xử lý" },
} as const;
/** Biến mẫu nghiệp vụ ⇒ khoá input run (tiêu đề/giá trị dùng input của Dify — một nguồn). */
const VARS: Record<string, string> = {
  ma_hd: NOTIFY_CONTRACT_INPUTS.number.key,
  ten_hd: "contract-title",
  gia_tri: "contract-value",
};
export const NOTIFY_TEMPLATE_VARS = Object.keys(VARS);
const WAIT_OFFSET = { min: -365, max: 365 } as const;

export const hasNotifyOrWait = (steps: readonly FlowStep[]): boolean =>
  steps.some((s) => s.kind === "notify" || s.kind === "wait_until");

const toEngineVars = (t: string) =>
  t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (Object.hasOwn(VARS, k) ? `{${VARS[k]}}` : m));

/** Lỗi kiểm của bước Thông báo / Chờ tới (path `steps.i.<trường>`). */
export function notifyWaitIssues(s: FlowStep, i: number): ApprovalFlowIssue[] {
  const out: ApprovalFlowIssue[] = [];
  if (s.kind === "notify") {
    if (!s.to.creator && !s.to.owner && !s.to.group_key)
      out.push({ path: `steps.${i}.to`, rule: "NOTIFY_TO_REQUIRED" });
    if (s.channels.length === 0)
      out.push({ path: `steps.${i}.channels`, rule: "NOTIFY_CHANNEL_REQUIRED" });
    if (s.title.trim() === "")
      out.push({ path: `steps.${i}.title`, rule: "NOTIFY_TITLE_REQUIRED" });
  }
  if (s.kind === "wait_until") {
    const o = s.offset_days;
    if (!Number.isInteger(o) || o < WAIT_OFFSET.min || o > WAIT_OFFSET.max)
      out.push({ path: `steps.${i}.offset_days`, rule: "WAIT_OFFSET_RANGE" });
  }
  return out;
}

/** Executor engine của bước Thông báo (người gửi duyệt = người bắt đầu lượt; người phụ trách = input `contract-owner`). */
export function notifyExecutorOf(s: FlowNotifyStep) {
  const to = [
    ...(s.to.creator ? [{ who: "starter" as const }] : []),
    ...(s.to.owner
      ? [{ who: "input_user" as const, input: NOTIFY_CONTRACT_INPUTS.owner.key }]
      : []),
    ...(s.to.group_key ? [{ who: "group" as const, group_key: s.to.group_key }] : []),
  ];
  return {
    kind: "notify" as const,
    to,
    channels: [...new Set(["bell" as const, ...s.channels])],
    title: toEngineVars(s.title),
    body: toEngineVars(s.body),
  };
}

export function waitExecutorOf(s: FlowWaitStep) {
  return {
    kind: "wait_until" as const,
    from: { kind: "input" as const, key: NOTIFY_CONTRACT_INPUTS[s.from].key },
    offset_days: s.offset_days,
    time: s.time,
  };
}

/** Stage engine của bước Thông báo / Chờ tới (khuôn stage tool của `compileDef`): `after: auto`, không rẽ — bước sau không điều
 *  kiện (như Dify). `slot` do `compileDef` gắn. */
export function autoStageOf(s: FlowNotifyStep | FlowWaitStep, key: string, step: number) {
  return {
    key,
    name: s.name,
    step,
    executor: s.kind === "notify" ? notifyExecutorOf(s) : waitExecutorOf(s),
    instruction: "",
    output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
    after: { kind: "auto", branch: [] },
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 60,
    token_budget: null,
  };
}

/** Input def thêm khi có bước Thông báo / Chờ tới. */
export function notifyDefInputs(steps: readonly FlowStep[]) {
  if (!hasNotifyOrWait(steps)) return [];
  return Object.values(NOTIFY_CONTRACT_INPUTS).map((x) => ({
    key: x.key,
    label: x.label,
    type: x.type,
    required: false,
  }));
}

export type NotifyFacts = {
  number: string | null;
  owner: string | null;
  endDate: string | null;
  actionDeadline: string | null;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Input run điền cho bước Thông báo / Chờ tới (ngày trống/sai dạng ⇒ không gửi input; bước Chờ tới khi đó dừng "cần quyết"). */
export function notifyRunInputs(f: NotifyFacts) {
  const text = (key: string, v: string | null) =>
    v ? [{ type: "text" as const, key, text: v.slice(0, 200) }] : [];
  const date = (key: string, v: string | null) =>
    v && DATE_RE.test(v) ? [{ type: "date" as const, key, value: v }] : [];
  return [
    ...text(NOTIFY_CONTRACT_INPUTS.number.key, f.number),
    ...text(NOTIFY_CONTRACT_INPUTS.owner.key, f.owner),
    ...date(NOTIFY_CONTRACT_INPUTS.end_date.key, f.endDate),
    ...date(NOTIFY_CONTRACT_INPUTS.action_deadline.key, f.actionDeadline),
  ];
}
