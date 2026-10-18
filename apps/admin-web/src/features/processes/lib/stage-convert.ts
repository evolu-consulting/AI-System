// ADM-FR-66 · CR-056 · P-a F5 · P-d2: đổi một giai đoạn qua lại giữa `ProcessStageDef` (contract) và `StageDraft` (editor) — tách từ
// `def-form` (file ≤ 400 dòng). Hàm thuần: không React, không gọi API.
import { type ProcessStageDef, STAGE_TIMEOUT_S } from "@ai/contracts/hub-admin";
import { executorToDef, normalizeApply } from "./apply-form";
import { autofixToDef, autofixToDraft, emptyAutofix } from "./autofix-form";
import { branchToRules, rulesToBranch } from "./branch-form";
import type { StageDraft } from "./draft-types";
import {
  mustKnowToDef,
  mustKnowToDraft,
  stageSourcesToDef,
  stageSourcesToDraft,
} from "./sources-form";
import { emptyTool, isTool, normalizeTool, toolFromDef, toolToDef } from "./tool-form";
import {
  emptyEscalate,
  emptyWait,
  escalateFromDef,
  escalateToDef,
  isWait,
  normalizeWait,
  remindFromDef,
  remindToDef,
  waitFromDef,
  waitToDef,
} from "./wait-form";

let seq = 0;
export const nextUid = (): string => `s${++seq}`;

export const num = (v: number | null): string => (v === null ? "" : String(v));
export const intOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim()));

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
    tool: emptyTool(),
    branch: [],
  };
}

const executorOf = (ex: ProcessStageDef["executor"]): string =>
  ex.kind === "agent"
    ? `agent:${ex.agent_id}`
    : ex.kind === "team"
      ? `team:${ex.team_id}`
      : ex.kind === "wait_until" || ex.kind === "tool"
        ? ex.kind
        : "apply";

export function stageToDraft(s: ProcessStageDef, step: number): StageDraft {
  const a = s.answerer;
  const rv = s.after.kind === "review" ? s.after : null;
  return {
    uid: nextUid(),
    keyAuto: false,
    key: s.key,
    name: s.name,
    executor: executorOf(s.executor),
    wait: s.executor.kind === "wait_until" ? waitFromDef(s.executor) : emptyWait(),
    tool: s.executor.kind === "tool" ? toolFromDef(s.executor) : emptyTool(),
    branch: rulesToBranch(s.after.branch),
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

function executorDef(s: StageDraft): ProcessStageDef["executor"] {
  if (isWait(s)) return waitToDef(s.wait);
  return isTool(s) ? toolToDef(s.tool) : executorToDef(s.executor);
}

/** Wait / Áp không rẽ nhánh (luật bị bỏ khi gửi). */
const branchOf = (s: StageDraft): ProcessStageDef["after"]["branch"] =>
  isWait(s) || s.executor === "apply" ? [] : branchToRules(s.branch, s.fields);

export function stageToInput(draft: StageDraft): ProcessStageDef {
  const s = normalizeTool(normalizeWait(normalizeApply(draft)));
  const rules = branchOf(s) ?? [];
  const branch = rules.length > 0 ? { branch: rules } : {};
  return {
    key: s.key,
    name: s.name.trim(),
    step: s.step,
    executor: executorDef(s),
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
            ...branch,
          }
        : { kind: "auto", ...branch },
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
