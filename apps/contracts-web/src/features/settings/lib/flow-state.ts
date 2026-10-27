// contract-flow S5 · trạng thái soạn mẫu luồng (reducer thuần) + kiểm sơ bộ + đọc lỗi trường từ server.
import {
  APPROVAL_FLOW_DUE_H,
  APPROVAL_FLOW_REMIND_H,
  APPROVAL_FLOW_STEPS_MAX,
} from "@ai/contracts";
import type { FlowDifyStep, FlowEsignStep, FlowReviewStep, FlowStep, FlowWhen } from "../api-flow";

const FLOW_MAX_STEPS = APPROVAL_FLOW_STEPS_MAX;
type ReviewStep = FlowReviewStep;
type DifyStep = FlowDifyStep;
type EsignStep = FlowEsignStep;

/** esign-flow · bước Ký số mới (người ký = người phụ trách, đối tác ký sau, nhà cung cấp mặc định công ty). */
export function newEsign(steps: readonly FlowStep[], name: string): EsignStep {
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
    escalate_group_id: null,
  };
}
const hasEsign = (steps: readonly FlowStep[]) => steps.some((s) => s.kind === "esign");
/** Thêm bước trước bước Ký số (Ký số luôn cuối). */
function insert(steps: FlowStep[], s: FlowStep): FlowStep[] {
  const i = steps.findIndex((x) => x.kind === "esign");
  return i < 0 ? [...steps, s] : [...steps.slice(0, i), s, ...steps.slice(i)];
}
type StepWhen = FlowWhen;

export type FlowAction =
  | { type: "load"; steps: FlowStep[] }
  | { type: "addReview"; department_group_id?: string | null }
  | { type: "addDify"; workflow_key: string; name: string }
  | { type: "addEsign"; name: string }
  | { type: "remove"; index: number }
  | { type: "move"; index: number; dir: -1 | 1 }
  | {
      type: "patch";
      index: number;
      patch: Partial<ReviewStep> | Partial<DifyStep> | Partial<EsignStep>;
    }
  | { type: "setWhen"; index: number; when: StepWhen | null };

function freshKey(steps: readonly FlowStep[], prefix: string): string {
  const used = new Set(steps.map((s) => s.key));
  let n = steps.length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function newReview(
  steps: readonly FlowStep[],
  department_group_id: string | null = null,
): ReviewStep {
  return {
    kind: "review",
    key: freshKey(steps, "s"),
    name: "",
    department_group_id,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
  };
}

/** Đổi chỗ bước `index` với bước kề; bước 0 đứng yên, bước Ký số luôn cuối. */
function move(steps: FlowStep[], index: number, dir: -1 | 1): FlowStep[] {
  const j = index + dir;
  if (index < 1 || j < 1 || j >= steps.length) return steps;
  if (steps[index]?.kind === "esign" || steps[j]?.kind === "esign") return steps;
  const next = [...steps];
  [next[index], next[j]] = [next[j] as FlowStep, next[index] as FlowStep];
  return next;
}

export function flowReducer(steps: FlowStep[], a: FlowAction): FlowStep[] {
  switch (a.type) {
    case "load":
      return structuredClone(a.steps);
    case "addReview":
      return steps.length >= FLOW_MAX_STEPS
        ? steps
        : insert(steps, newReview(steps, a.department_group_id));
    case "addDify":
      return steps.length >= FLOW_MAX_STEPS
        ? steps
        : insert(steps, {
            kind: "dify",
            key: freshKey(steps, "d"),
            name: a.name,
            workflow_key: a.workflow_key,
            after: "auto",
          });
    case "addEsign":
      return steps.length >= FLOW_MAX_STEPS || hasEsign(steps)
        ? steps
        : [...steps, newEsign(steps, a.name)];
    case "remove":
      return a.index <= 0 ? steps : steps.filter((_, i) => i !== a.index);
    case "move":
      return move(steps, a.index, a.dir);
    case "patch":
      return steps.map((s, i) => (i === a.index ? ({ ...s, ...a.patch } as FlowStep) : s));
    case "setWhen":
      return a.index === 0
        ? steps
        : steps.map((s, i) => (i === a.index && s.kind === "review" ? { ...s, when: a.when } : s));
  }
}

export type FlowIssue = { index: number | null; field: string; code: string; message?: string };

export const REMIND_MIN = APPROVAL_FLOW_REMIND_H.min;
export const REMIND_MAX = APPROVAL_FLOW_REMIND_H.max;
export const DUE_MIN = APPROVAL_FLOW_DUE_H.min;
export const DUE_MAX = APPROVAL_FLOW_DUE_H.max;

/** Mã lỗi client dùng chung tên luật server (`APPROVAL_FLOW_RULES`) khi trùng nghĩa. */
function reviewIssues(s: ReviewStep, i: number): FlowIssue[] {
  const out: FlowIssue[] = [];
  const bad = (field: string, code: string) => out.push({ index: i, field, code });
  if (!s.name.trim()) bad("name", "nameEmpty");
  if (!s.department_group_id && !s.approver_user_id) bad("department_group_id", "GROUP_REQUIRED");
  if (!Number.isInteger(s.due_h) || s.due_h < DUE_MIN || s.due_h > DUE_MAX)
    bad("due_h", "DUE_RANGE");
  const r = s.remind_every_h;
  if (r !== null && (!Number.isInteger(r) || r < REMIND_MIN || r > REMIND_MAX))
    bad("remind_every_h", "REMIND_RANGE");
  if (s.escalate_group_id && s.escalate_group_id === s.department_group_id)
    bad("escalate_group_id", "ESCALATE_SAME_GROUP");
  if (i === 0 && s.when) bad("when", "FIRST_CONDITIONAL");
  return [...out, ...whenIssues(s.when, i)];
}

/** esign-flow · bước Ký số: cuối luồng, người ký đủ, hạn trong giới hạn. */
function esignIssues(s: EsignStep, i: number, n: number): FlowIssue[] {
  const out: FlowIssue[] = [];
  const bad = (field: string, code: string) => out.push({ index: i, field, code });
  if (!s.name.trim()) bad("name", "nameEmpty");
  if (i !== n - 1) bad("step", "ESIGN_NOT_LAST");
  const c = s.company_signer;
  if (c.mode === "dept_head" && !c.department_group_id)
    bad("company_signer.department_group_id", "SIGNER_GROUP_REQUIRED");
  if (c.mode === "user" && !c.user_id) bad("company_signer.user_id", "SIGNER_USER_REQUIRED");
  if (!Number.isInteger(s.due_h) || s.due_h < DUE_MIN || s.due_h > DUE_MAX)
    bad("due_h", "DUE_RANGE");
  const r = s.remind_every_h;
  if (r !== null && (!Number.isInteger(r) || r < REMIND_MIN || r > REMIND_MAX))
    bad("remind_every_h", "REMIND_RANGE");
  return out;
}

function whenIssues(w: StepWhen | null, i: number): FlowIssue[] {
  if (!w) return [];
  const out: FlowIssue[] = [];
  if (w.conds.length === 0) out.push({ index: i, field: "when", code: "whenEmpty" });
  for (const c of w.conds)
    if (c.field === "total_value" && !(Number.isInteger(c.value) && c.value >= 0))
      out.push({ index: i, field: "when", code: "amountInvalid" });
  return out;
}

/** Kiểm sơ bộ phía client (server vẫn là nguồn quyết định cuối). */
export function validateFlow(steps: readonly FlowStep[]): FlowIssue[] {
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

/** Lỗi 422 `APPROVAL_FLOW_INVALID`: `details.issues[{path:"steps.1.due_h", rule}]` ⇒ trường của bước. */
export function serverIssues(err: unknown): FlowIssue[] {
  const d = (err as { details?: { issues?: { path?: string; rule?: string }[] } } | null)?.details;
  return (d?.issues ?? []).map((it) => {
    const path = it.path ?? "steps";
    const code = it.rule ?? "server";
    const m = /^steps\.(\d+)\.?(.*)$/.exec(path);
    return m
      ? { index: Number(m[1]), field: m[2] || "step", code }
      : { index: null, field: path, code };
  });
}

export const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;
