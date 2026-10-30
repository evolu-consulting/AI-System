// CR-105 · L3: trạng thái soạn Form (danh sách bước tuần tự) của khe `contracts.approval` — chuyển (copy, không import chéo app) từ
// contracts-web `features/settings/lib/flow-state.ts`; khác: phòng ban theo MÃ (`*_group_key`), không id (design §1/§5).
// Thân Form = `slot_body`; Hub biên dịch ra `stages` mỗi lần lưu. Khe hở hợp đồng: tên trường theo mã + dạng bọc `{steps}` (xem `parseSlotBody`).
import {
  APPROVAL_FLOW_DUE_H,
  APPROVAL_FLOW_REMIND_H,
  APPROVAL_FLOW_STEPS_MAX,
  type FlowWhen,
} from "@ai/contracts";

export const FLOW_MAX_STEPS = APPROVAL_FLOW_STEPS_MAX;
export const DUE_MIN = APPROVAL_FLOW_DUE_H.min;
export const DUE_MAX = APPROVAL_FLOW_DUE_H.max;
export const REMIND_MIN = APPROVAL_FLOW_REMIND_H.min;
export const REMIND_MAX = APPROVAL_FLOW_REMIND_H.max;

export type LibReviewStep = {
  kind: "review";
  key: string;
  name: string;
  department_group_key: string | null;
  /** Luôn null ở def thư viện (id Group bị Hub chặn: GROUP_ID_IN_LIBRARY) — gửi kèm cho khớp `FlowStep`. */
  department_group_id?: null;
  escalate_group_id?: null;
  head_only: boolean;
  due_h: number;
  remind_every_h: number | null;
  escalate_group_key: string | null;
  exclude_starter: boolean;
  when: FlowWhen | null;
  approver_user_id?: string | null;
};
export type LibEsignStep = {
  kind: "esign";
  key: string;
  name: string;
  company_signer: {
    mode: "owner" | "dept_head" | "user";
    department_group_key?: string | null;
    user_id?: string | null;
  };
  partner_signs: boolean;
  order: "company_first" | "partner_first";
  provider: string | null;
  due_h: number;
  remind_every_h: number | null;
  escalate_group_key: string | null;
  escalate_group_id?: null;
};
/** Bước Dify: Form chỉ giữ nguyên (khe hở: danh mục workflow Dify chưa có ở admin-web) — sửa ở Canvas. */
export type LibDifyStep = {
  kind: "dify";
  key: string;
  name: string;
  workflow_key: string;
  inputs?: Record<string, string>;
  after: "auto";
};
export type LibStep = LibReviewStep | LibEsignStep | LibDifyStep;

export type FlowAction =
  | { type: "load"; steps: LibStep[] }
  | { type: "addReview" }
  | { type: "addEsign"; name: string }
  | { type: "remove"; index: number }
  | { type: "move"; index: number; dir: -1 | 1 }
  | {
      type: "patch";
      index: number;
      patch: Partial<LibReviewStep> | Partial<LibEsignStep> | Partial<LibDifyStep>;
    }
  | { type: "setWhen"; index: number; when: FlowWhen | null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** `slot_body` → danh sách bước: chấp nhận `{steps:[…]}` hoặc mảng trần; dạng khác ⇒ null (Form chỉ xem + "Sửa ở Canvas"). */
export function parseSlotBody(body: unknown): LibStep[] | null {
  const list = Array.isArray(body)
    ? body
    : isObj(body) && Array.isArray(body.steps)
      ? body.steps
      : null;
  if (!list) return null;
  const ok = list.every(
    (s) => isObj(s) && (s.kind === "review" || s.kind === "esign" || s.kind === "dify"),
  );
  return ok ? (structuredClone(list) as LibStep[]) : null;
}
/** Bước → `slot_body` gửi Hub (một chỗ đổi nếu hợp đồng chốt dạng khác). */
export const toSlotBody = (steps: readonly LibStep[]): { steps: LibStep[] } => ({
  steps: structuredClone([...steps]),
});

function freshKey(steps: readonly LibStep[], prefix: string): string {
  const used = new Set(steps.map((s) => s.key));
  let n = steps.length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
export function newReview(steps: readonly LibStep[], group: string | null = null): LibReviewStep {
  return {
    kind: "review",
    key: freshKey(steps, "s"),
    name: "",
    department_group_key: group,
    department_group_id: null,
    escalate_group_id: null,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_key: null,
    exclude_starter: false,
    when: null,
  };
}
export function newEsign(steps: readonly LibStep[], name: string): LibEsignStep {
  return {
    kind: "esign",
    key: freshKey(steps, "k"),
    name,
    company_signer: { mode: "owner" },
    partner_signs: true,
    order: "company_first",
    provider: null,
    due_h: 72,
    remind_every_h: null,
    escalate_group_key: null,
    escalate_group_id: null,
  };
}
/** Thêm trước bước Ký số (Ký số luôn cuối). */
function insert(steps: LibStep[], s: LibStep): LibStep[] {
  const i = steps.findIndex((x) => x.kind === "esign");
  return i < 0 ? [...steps, s] : [...steps.slice(0, i), s, ...steps.slice(i)];
}
/** Đổi chỗ với bước kề; bước 0 đứng yên, Ký số luôn cuối. */
function move(steps: LibStep[], index: number, dir: -1 | 1): LibStep[] {
  const j = index + dir;
  if (index < 1 || j < 1 || j >= steps.length) return steps;
  if (steps[index]?.kind === "esign" || steps[j]?.kind === "esign") return steps;
  const next = [...steps];
  [next[index], next[j]] = [next[j] as LibStep, next[index] as LibStep];
  return next;
}

export function flowReducer(steps: LibStep[], a: FlowAction): LibStep[] {
  switch (a.type) {
    case "load":
      return structuredClone(a.steps);
    case "addReview":
      return steps.length >= FLOW_MAX_STEPS ? steps : insert(steps, newReview(steps));
    case "addEsign":
      return steps.length >= FLOW_MAX_STEPS || steps.some((s) => s.kind === "esign")
        ? steps
        : [...steps, newEsign(steps, a.name)];
    case "remove":
      return a.index <= 0 ? steps : steps.filter((_, i) => i !== a.index);
    case "move":
      return move(steps, a.index, a.dir);
    case "patch":
      return steps.map((s, i) => (i === a.index ? ({ ...s, ...a.patch } as LibStep) : s));
    case "setWhen":
      return a.index === 0
        ? steps
        : steps.map((s, i) => (i === a.index && s.kind === "review" ? { ...s, when: a.when } : s));
  }
}

export type FlowIssue = { index: number | null; field: string; code: string };

const inRange = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;

function commonIssues(s: LibReviewStep | LibEsignStep, i: number): FlowIssue[] {
  const out: FlowIssue[] = [];
  const bad = (field: string, code: string) => out.push({ index: i, field, code });
  if (!s.name.trim()) bad("name", "nameEmpty");
  if (!inRange(s.due_h, DUE_MIN, DUE_MAX)) bad("due_h", "DUE_RANGE");
  const r = s.remind_every_h;
  if (r !== null && !inRange(r, REMIND_MIN, REMIND_MAX)) bad("remind_every_h", "REMIND_RANGE");
  return out;
}

function whenIssues(w: FlowWhen | null, i: number): FlowIssue[] {
  if (!w) return [];
  const out: FlowIssue[] = [];
  if (w.conds.length === 0) out.push({ index: i, field: "when", code: "whenEmpty" });
  for (const c of w.conds)
    if (c.field === "total_value" && !(Number.isInteger(c.value) && c.value >= 0))
      out.push({ index: i, field: "when", code: "amountInvalid" });
  return out;
}

function reviewIssues(s: LibReviewStep, i: number): FlowIssue[] {
  const out = commonIssues(s, i);
  if (!s.department_group_key && !s.approver_user_id)
    out.push({ index: i, field: "department_group_key", code: "GROUP_REQUIRED" });
  if (s.escalate_group_key && s.escalate_group_key === s.department_group_key)
    out.push({ index: i, field: "escalate_group_key", code: "ESCALATE_SAME_GROUP" });
  if (i === 0 && s.when) out.push({ index: i, field: "when", code: "FIRST_CONDITIONAL" });
  return [...out, ...whenIssues(s.when, i)];
}

function esignIssues(s: LibEsignStep, i: number, n: number): FlowIssue[] {
  const out = commonIssues(s, i);
  if (i !== n - 1) out.push({ index: i, field: "step", code: "ESIGN_NOT_LAST" });
  const c = s.company_signer;
  if (c.mode === "dept_head" && !c.department_group_key)
    out.push({ index: i, field: "company_signer", code: "SIGNER_GROUP_REQUIRED" });
  return out;
}

/** Kiểm sơ bộ phía client (Hub vẫn là nguồn quyết định cuối ở lưu/xuất bản). */
export function validateFlow(steps: readonly LibStep[]): FlowIssue[] {
  const out: FlowIssue[] = [];
  if (steps.length === 0 || steps[0]?.kind !== "review")
    out.push({ index: 0, field: "kind", code: "FIRST_NOT_REVIEW" });
  if (steps.length > FLOW_MAX_STEPS) out.push({ index: null, field: "steps", code: "STEPS_MAX" });
  const keys = new Set<string>();
  steps.forEach((s, i) => {
    if (keys.has(s.key)) out.push({ index: i, field: "key", code: "KEY_DUP" });
    keys.add(s.key);
    if (s.kind === "review") out.push(...reviewIssues(s, i));
    else if (s.kind === "esign") out.push(...esignIssues(s, i, steps.length));
    else if (!s.workflow_key) out.push({ index: i, field: "workflow_key", code: "difyEmpty" });
    const prev = steps[i - 1];
    if (prev?.kind === "dify" && s.kind === "review" && s.when)
      out.push({ index: i, field: "when", code: "AFTER_DIFY_CONDITIONAL" });
  });
  return out;
}

export const issueOf = (issues: readonly FlowIssue[], index: number, field: string) =>
  issues.find((x) => x.index === index && (x.field === field || x.field.startsWith(`${field}.`)));

/** Mã phòng ban (theo mã) đang dùng trong các bước — để hiện "mã chưa có" / kiểm theo tenant. */
export function groupKeysOf(steps: readonly LibStep[]): string[] {
  const out = new Set<string>();
  for (const s of steps) {
    if (s.kind !== "dify" && s.escalate_group_key) out.add(s.escalate_group_key);
    if (s.kind === "review" && s.department_group_key) out.add(s.department_group_key);
    if (s.kind === "esign" && s.company_signer.department_group_key)
      out.add(s.company_signer.department_group_key);
  }
  return [...out].sort();
}
