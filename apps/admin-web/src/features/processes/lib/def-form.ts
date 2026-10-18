// ADM-FR-66 · CR-056 · P-a F5: mô hình form của editor quy trình (bản nháp ↔ `ProcessDefInput`) và validate client khớp
// contract (plan-frontend-admin §2). Hàm thuần: không React, không gọi API.
import {
  PROCESS_DESC_MAX,
  PROCESS_KEY_RE,
  PROCESS_NAME_MAX,
  PROCESS_RUN_GROUPS_MAX,
  PROCESS_STAGES_MAX,
  type ProcessDef,
  type ProcessDefInput,
  type ProcessStageDef,
  processDefStageIssues,
  resolveSteps,
  STAGE_TIMEOUT_S,
} from "@ai/contracts/hub-admin";
import { ttlIssueKey } from "../domain/error-keys";
import { PROCESS_TTL_DAYS } from "../domain/limits";
import { ttlFromValue, ttlIssue, ttlToValue } from "../domain/ttl-rules";
import { APPLY_RULE_ERR, applyCrossErrors, executorToDef, normalizeApply } from "./apply-form";
import {
  AUTOFIX_RULE_ERR,
  autofixToDef,
  autofixToDraft,
  emptyAutofix,
  validateAutofixPart,
} from "./autofix-form";
import {
  type InputDraft,
  inputsToDef,
  inputsToDraft,
  mustKnowToDef,
  mustKnowToDraft,
  stageSourcesToDef,
  stageSourcesToDraft,
  validateSourcesPart,
} from "./sources-form";
import { slugKey } from "./stage-key";
import { budgetOk, P, validateStage } from "./stage-validate";
import {
  addCrossIssue,
  emptyEscalate,
  emptyWait,
  escalateFromDef,
  escalateToDef,
  isWait,
  normalizeWait,
  remindFromDef,
  remindToDef,
  stageShape,
  type TeamSections,
  validateWaitPart,
  waitFromDef,
  waitToDef,
} from "./wait-form";

export type {
  DefDraft,
  DraftErrors,
  EscalateDraft,
  FieldDraft,
  StageDraft,
  WaitDraft,
} from "./draft-types";

import type { DefDraft, DraftErrors, StageDraft } from "./draft-types";

export { slugKey };

let seq = 0;
const nextUid = (): string => `s${++seq}`;

export function emptyStage(step = 0): StageDraft {
  return {
    uid: nextUid(),
    keyAuto: true,
    key: "",
    name: "",
    executor: "",
    instruction: "",
    filename: "",
    template: "",
    sections: [],
    fields: [],
    after: "auto",
    step,
    backTo: [],
    groupId: "",
    real: false,
    answerer: "starter",
    answererId: "",
    timeout: String(STAGE_TIMEOUT_S.default),
    budget: "",
    sources: [],
    mustKnow: "",
    autofix: emptyAutofix(),
    wait: emptyWait(),
    remind: "",
    escalate: emptyEscalate(),
  };
}

export const emptyDraft = (): DefDraft => ({
  key: "",
  name: "",
  description: "",
  hint: "",
  groupIds: [],
  budget: "",
  enabled: false,
  stages: [emptyStage()],
  sources: [],
  inputs: [],
  ttl: String(PROCESS_TTL_DAYS.default),
  noExpiry: false,
});

const num = (v: number | null): string => (v === null ? "" : String(v));

const executorOf = (ex: ProcessStageDef["executor"]): string =>
  ex.kind === "agent"
    ? `agent:${ex.agent_id}`
    : ex.kind === "team"
      ? `team:${ex.team_id}`
      : ex.kind === "wait_until"
        ? "wait_until"
        : "apply";

function stageToDraft(s: ProcessStageDef, step: number): StageDraft {
  const a = s.answerer;
  const rv = s.after.kind === "review" ? s.after : null;
  return {
    uid: nextUid(),
    keyAuto: false,
    key: s.key,
    name: s.name,
    executor: executorOf(s.executor),
    wait: s.executor.kind === "wait_until" ? waitFromDef(s.executor) : emptyWait(),
    remind: remindFromDef(rv?.remind_every_h),
    escalate: escalateFromDef(rv?.escalate),
    instruction: s.instruction,
    filename: s.output.filename,
    template: s.output.template,
    sections: [...s.output.required_sections],
    fields: s.output.fields.map((f) => ({ ...f })),
    after: s.after.kind,
    step,
    backTo: s.after.kind === "review" ? [...(s.after.back_to_steps ?? [])] : [],
    groupId: s.after.kind === "review" ? (s.after.group_id ?? "") : "",
    real: s.real_action,
    answerer: a.kind,
    answererId: a.kind === "group" ? a.group_id : a.kind === "user" ? a.user_id : "",
    timeout: String(s.timeout_s),
    budget: num(s.token_budget),
    sources: stageSourcesToDraft(s.sources),
    mustKnow: mustKnowToDraft(s.must_know),
    autofix: autofixToDraft(s.autofix),
  };
}

export function toDraft(d: ProcessDefInput | ProcessDef): DefDraft {
  const steps = resolveSteps(d.stages);
  return {
    key: d.key,
    name: d.name,
    description: d.description,
    hint: d.input_hint,
    groupIds: [...d.run_group_ids],
    budget: num(d.token_budget),
    enabled: d.enabled,
    stages: d.stages.map((s, i) => stageToDraft(s, steps[i] as number)),
    sources: [...d.sources],
    inputs: inputsToDraft(d.inputs),
    ...ttlDraft(d),
  };
}

/** `ttl_days` vắng (bản nháp/def cũ) ⇒ mặc định 7; `null` ⇒ "Không hết hạn". */
function ttlDraft(d: { ttl_days?: number | null }): Pick<DefDraft, "ttl" | "noExpiry"> {
  const t = ttlFromValue(d.ttl_days === undefined ? PROCESS_TTL_DAYS.default : d.ttl_days);
  return { ttl: t.text, noExpiry: t.noExpiry };
}

const intOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim()));

function stageToInput(draft: StageDraft): ProcessStageDef {
  const s = normalizeWait(normalizeApply(draft));
  return {
    key: s.key,
    name: s.name.trim(),
    step: s.step,
    executor: isWait(s) ? waitToDef(s.wait) : executorToDef(s.executor),
    instruction: s.instruction,
    output: {
      filename: s.filename,
      template: s.template,
      required_sections: s.sections,
      fields: s.fields,
    },
    after:
      s.after === "review"
        ? {
            kind: "review",
            group_id: s.groupId || null,
            back_to_steps: s.backTo,
            remind_every_h: remindToDef(s),
            escalate: escalateToDef(s),
          }
        : { kind: "auto" },
    real_action: s.real,
    answerer:
      s.answerer === "group"
        ? { kind: "group", group_id: s.answererId }
        : s.answerer === "user"
          ? { kind: "user", user_id: s.answererId }
          : { kind: "starter" },
    timeout_s: Number(s.timeout),
    token_budget: intOrNull(s.budget),
    sources: stageSourcesToDef(s.sources),
    must_know: mustKnowToDef(s.mustKnow),
    autofix: autofixToDef(s.autofix),
  };
}

/** Bản nháp (đã qua `validateDraft`) → body gửi Hub. */
export function toInput(d: DefDraft): ProcessDefInput {
  return {
    key: d.key,
    name: d.name.trim(),
    description: d.description,
    input_hint: d.hint,
    run_group_ids: d.groupIds,
    stages: d.stages.map(stageToInput),
    token_budget: intOrNull(d.budget),
    enabled: d.enabled,
    sources: d.sources,
    inputs: inputsToDef(d.inputs),
    ttl_days: ttlToValue(d.ttl, d.noExpiry),
  };
}

/** Giai đoạn `i` có được bật "Hành động thật"? Bước ≥ 1 và MỌI giai đoạn của bước liền trước có người kiểm (PB2-R03). */
export function canRealAction(stages: readonly StageDraft[], i: number): boolean {
  const step = stages[i]?.step ?? 0;
  if (step < 1) return false;
  return stages.filter((s) => s.step === step - 1).every((s) => s.after === "review");
}

export const STEP_ERR: Record<string, string> = {
  STEP_TOO_WIDE: "process.admin.canvas.err.stepFull",
  STEP_ORDER: "process.admin.canvas.err.step",
  STEP_INCOMPLETE: "process.admin.canvas.err.step",
  REAL_ACTION: "process.admin.canvas.err.realStep",
  BACK_TARGET_INVALID: "process.admin.canvas.err.backTarget",
  ...AUTOFIX_RULE_ERR,
  ...APPLY_RULE_ERR,
};

/** `stages.N.after.back_to_steps.K` → ô `stages.N.after.back_to_steps` (một dòng lỗi cho cả nhóm checkbox). */
export const backPathToField = (path: string): string =>
  path.replace(/\.after\.back_to_steps\.\d+$/, ".after.back_to_steps");

/** Luật chéo stage về bước (dùng chung với server: `processDefStageIssues`) → lỗi theo ô. */
export function validateSteps(
  stages: readonly StageDraft[],
  e: DraftErrors,
  ctx?: { inputs?: readonly InputDraft[]; teams?: TeamSections },
): void {
  const inputs = ctx?.inputs?.map((i) => ({ key: i.key, type: i.type }));
  for (const issue of processDefStageIssues(stages.map(stageShape), {
    inputs,
    teams: ctx?.teams,
  })) {
    const key = STEP_ERR[issue.rule];
    if (key) e[backPathToField(issue.path)] = key;
    else addCrossIssue(issue, e);
  }
}

/** Validate toàn bản nháp. `forEnable` ⇒ thêm luật "bật": mọi giai đoạn có người kiểm phải có Group. */
export function validateDraft(
  d: DefDraft,
  forEnable = d.enabled,
  teams?: TeamSections,
): DraftErrors {
  const e: DraftErrors = {};
  if (ttlIssue(d.ttl, d.noExpiry)) e.ttl_days = ttlIssueKey();
  if (d.name.trim() === "" || d.name.trim().length > PROCESS_NAME_MAX) e.name = `${P}nameRequired`;
  if (!PROCESS_KEY_RE.test(d.key)) e.key = `${P}keyFormat`;
  if (d.description.length > PROCESS_DESC_MAX) e.description = `${P}tooLong`;
  if (d.hint.length > PROCESS_DESC_MAX) e.input_hint = `${P}tooLong`;
  if (d.groupIds.length > PROCESS_RUN_GROUPS_MAX) e.run_group_ids = `${P}tooMany`;
  if (!budgetOk(d.budget)) e.token_budget = `${P}budget`;
  if (d.stages.length < 1 || d.stages.length > PROCESS_STAGES_MAX) e.stages = `${P}stageCount`;
  d.stages.forEach((s, i) => {
    validateStage(normalizeWait(s), i, d.stages, e);
    if (forEnable && s.after === "review" && s.groupId === "")
      e[`stages.${i}.after.group_id`] = "process.admin.apiError.PROCESS_DEF_INCOMPLETE";
  });
  const eff = d.stages.map((s) => normalizeWait(normalizeApply(s)));
  validateWaitPart(eff, d.inputs, e);
  validateSteps(eff, e, { inputs: d.inputs, teams });
  validateSourcesPart({ ...d, stages: eff }, e);
  validateAutofixPart(eff, e);
  Object.assign(e, applyCrossErrors(d.stages));
  return e;
}

/** Chỉ số giai đoạn nhắc tới trong các path lỗi (để mở accordion). */
export function stageIndexesOf(paths: Iterable<string>): number[] {
  const out = new Set<number>();
  for (const p of paths) {
    const m = /^stages\.(\d+)(\.|$)/.exec(p);
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** Path lỗi từ Hub (`PROCESS_DEF_INVALID/INCOMPLETE{paths}`) → lỗi theo ô. */
export function errorsFromServer(paths: readonly string[], key: string): DraftErrors {
  return Object.fromEntries(paths.map((p) => [p, key]));
}

/** `ProcessDef` đọc từ Hub → body PUT (bỏ id, tenant, version…). */
export function defToInput(d: ProcessDef): ProcessDefInput {
  return {
    key: d.key,
    name: d.name,
    description: d.description,
    input_hint: d.input_hint,
    run_group_ids: d.run_group_ids,
    stages: d.stages,
    token_budget: d.token_budget,
    enabled: d.enabled,
    sources: d.sources,
    inputs: d.inputs,
    ttl_days: d.ttl_days,
  };
}

/** Chuỗi so sánh "đã sửa chưa" (bỏ `uid` cục bộ). */
export const snapshot = (d: DefDraft): string =>
  JSON.stringify({
    ...d,
    stages: d.stages.map(({ uid: _uid, ...s }) => s),
    inputs: d.inputs.map(({ uid: _uid, ...i }) => i),
  });

/** Sửa giai đoạn `i`; còn `keyAuto` mà đổi tên ⇒ mã giai đoạn sinh lại (không trùng mã khác). */
export function patchStage(stages: StageDraft[], i: number, p: Partial<StageDraft>): StageDraft[] {
  return stages.map((s, j) => {
    if (j !== i) return s;
    const next = { ...s, ...p };
    if (next.after === "auto") next.backTo = [];
    if (next.keyAuto && p.name !== undefined) {
      const others = stages.filter((_, k) => k !== i).map((o) => o.key);
      next.key = slugKey(p.name, others);
    }
    return next;
  });
}
