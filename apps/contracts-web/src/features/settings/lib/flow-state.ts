// contract-flow S5 · trạng thái soạn mẫu luồng (reducer thuần) + kiểm sơ bộ + đọc lỗi trường từ server.
import {
  type DifyStep,
  FLOW_MAX_STEPS,
  type FlowStep,
  type ReviewStep,
  type StepWhen,
} from "../api-flow";

export type FlowAction =
  | { type: "load"; steps: FlowStep[] }
  | { type: "addReview"; department_group_id?: string }
  | { type: "addDify"; workflow_key: string; name: string }
  | { type: "remove"; index: number }
  | { type: "move"; index: number; dir: -1 | 1 }
  | { type: "patch"; index: number; patch: Partial<ReviewStep> | Partial<DifyStep> }
  | { type: "setWhen"; index: number; when: StepWhen | null };

function freshKey(steps: readonly FlowStep[], prefix: string): string {
  const used = new Set(steps.map((s) => s.key));
  let n = steps.length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function newReview(steps: readonly FlowStep[], department_group_id = ""): ReviewStep {
  return {
    kind: "review",
    key: freshKey(steps, "s"),
    name: "",
    department_group_id,
    head_only: false,
    due_h: 24,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
  };
}

export function flowReducer(steps: FlowStep[], a: FlowAction): FlowStep[] {
  switch (a.type) {
    case "load":
      return structuredClone(a.steps);
    case "addReview":
      return steps.length >= FLOW_MAX_STEPS
        ? steps
        : [...steps, newReview(steps, a.department_group_id)];
    case "addDify":
      return steps.length >= FLOW_MAX_STEPS
        ? steps
        : [
            ...steps,
            {
              kind: "dify",
              key: freshKey(steps, "d"),
              name: a.name,
              workflow_key: a.workflow_key,
              after: "auto",
            },
          ];
    case "remove":
      return a.index <= 0 ? steps : steps.filter((_, i) => i !== a.index);
    case "move": {
      const j = a.index + a.dir;
      if (a.index < 1 || j < 1 || j >= steps.length) return steps; // bước 0 đứng yên
      const next = [...steps];
      [next[a.index], next[j]] = [next[j] as FlowStep, next[a.index] as FlowStep];
      return next;
    }
    case "patch":
      return steps.map((s, i) => (i === a.index ? ({ ...s, ...a.patch } as FlowStep) : s));
    case "setWhen":
      return a.index === 0
        ? steps
        : steps.map((s, i) => (i === a.index && s.kind === "review" ? { ...s, when: a.when } : s));
  }
}

export type FlowIssue = { index: number | null; field: string; code: string; message?: string };

export const REMIND_MIN = 4;
export const REMIND_MAX = 168;
export const DUE_MAX = 720;

function reviewIssues(s: ReviewStep, i: number): FlowIssue[] {
  const out: FlowIssue[] = [];
  const bad = (field: string, code: string) => out.push({ index: i, field, code });
  if (!s.name.trim()) bad("name", "nameEmpty");
  if (!s.department_group_id) bad("department_group_id", "deptEmpty");
  if (!Number.isInteger(s.due_h) || s.due_h < 1 || s.due_h > DUE_MAX) bad("due_h", "dueRange");
  const r = s.remind_every_h;
  if (r !== null && (!Number.isInteger(r) || r < REMIND_MIN || r > REMIND_MAX))
    bad("remind_every_h", "remindRange");
  if (s.escalate_group_id && s.escalate_group_id === s.department_group_id)
    bad("escalate_group_id", "escalateSame");
  if (i === 0 && s.when) bad("when", "firstWhen");
  return [...out, ...whenIssues(s.when, i)];
}

function whenIssues(w: StepWhen | null, i: number): FlowIssue[] {
  if (!w) return [];
  const out: FlowIssue[] = [];
  if (!(w.deal?.length || w.value)) out.push({ index: i, field: "when", code: "whenEmpty" });
  if (w.value && !(Number.isFinite(w.value.amount) && w.value.amount >= 0))
    out.push({ index: i, field: "when.value", code: "amountInvalid" });
  return out;
}

/** Kiểm sơ bộ phía client (server vẫn là nguồn quyết định cuối). */
export function validateFlow(steps: readonly FlowStep[]): FlowIssue[] {
  const out: FlowIssue[] = [];
  if (steps.length === 0 || steps[0]?.kind !== "review")
    out.push({ index: 0, field: "kind", code: "firstReview" });
  if (steps.length > FLOW_MAX_STEPS) out.push({ index: null, field: "steps", code: "tooMany" });
  const keys = new Set<string>();
  steps.forEach((s, i) => {
    if (keys.has(s.key)) out.push({ index: i, field: "key", code: "dupKey" });
    keys.add(s.key);
    if (s.kind === "review") out.push(...reviewIssues(s, i));
    else if (!s.workflow_key) out.push({ index: i, field: "workflow_key", code: "difyEmpty" });
  });
  return out;
}

export const issueOf = (issues: readonly FlowIssue[], index: number, field: string) =>
  issues.find((x) => x.index === index && (x.field === field || x.field.startsWith(`${field}.`)));

/** Lỗi trường từ server: `details.issues[{path:["steps",1,"due_h"],message}]` hoặc `details.fields{"steps.1.due_h":msg}`. */
export function serverIssues(err: unknown): FlowIssue[] {
  const d = (err as { details?: unknown } | null)?.details as
    | {
        issues?: { path?: (string | number)[]; message?: string }[];
        fields?: Record<string, string>;
      }
    | undefined;
  const raw: [string, string][] = [];
  for (const it of d?.issues ?? []) raw.push([(it.path ?? []).join("."), it.message ?? ""]);
  for (const [k, v] of Object.entries(d?.fields ?? {})) raw.push([k, String(v)]);
  return raw.map(([path, message]) => {
    const m = /^steps\.(\d+)\.?(.*)$/.exec(path);
    return m
      ? { index: Number(m[1]), field: m[2] || "step", code: "server", message }
      : { index: null, field: path || "steps", code: "server", message };
  });
}
