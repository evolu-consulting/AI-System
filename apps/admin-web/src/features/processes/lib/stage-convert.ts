// ADM-FR-66 · CR-056 · P-a F5 · P-d2: đổi một giai đoạn qua lại giữa `ProcessStageDef` (contract) và `StageDraft` (editor) — tách từ
// `def-form` (file ≤ 400 dòng). Hàm thuần: không React, không gọi API.
import { type ProcessStageDef, STAGE_TIMEOUT_S, STAGE_UI_Y } from "@ai/contracts/hub-admin";
import { draftKindOf, type FeNode, feNodeOf } from "../nodes/registry";
import { executorToDef, normalizeApply } from "./apply-form";
import { autofixToDef, autofixToDraft, emptyAutofix } from "./autofix-form";
import { branchToRules, rulesToBranch } from "./branch-form";
import type { StageDraft } from "./draft-types";
import { emptyIf, normalizeIf } from "./if-form";
import { emptySet, normalizeSet } from "./set-form";
import { repairSlot } from "./slot-canvas";
import {
  mustKnowToDef,
  mustKnowToDraft,
  stageSourcesToDef,
  stageSourcesToDraft,
} from "./sources-form";
import { emptyTool, normalizeTool } from "./tool-form";
import {
  emptyEscalate,
  emptyWait,
  escalateFromDef,
  escalateToDef,
  normalizeWait,
  remindFromDef,
  remindToDef,
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
    set: emptySet(),
    branch: [],
    ifx: emptyIf(),
  };
}

/** CR-103 · ô `executor` + phần draft riêng của loại (wait/tool) theo registry node. */
function executorPart(
  ex: ProcessStageDef["executor"],
): Pick<StageDraft, "executor" | "wait" | "tool" | "set" | "ifx"> {
  const node = feNodeOf(ex.kind) as FeNode;
  return {
    executor: node.draftExecutor(ex as never),
    wait: emptyWait(),
    tool: emptyTool(),
    set: emptySet(),
    ifx: emptyIf(),
    ...node.fromDef?.(ex as never),
  };
}

export function stageToDraft(s: ProcessStageDef, step: number): StageDraft {
  const a = s.answerer;
  const rv = s.after.kind === "review" ? s.after : null;
  return {
    uid: nextUid(),
    keyAuto: false,
    key: s.key,
    name: s.name,
    ...executorPart(s.executor),
    branch: rulesToBranch(s.after.branch),
    remind: remindFromDef(rv?.remind_every_h),
    escalate: escalateFromDef(rv?.escalate),
    ...(rv?.exclude_starter ? { excludeStarter: true } : {}),
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
    answererId: a.kind === "group" ? (a.group_id ?? "") : a.kind === "user" ? a.user_id : "",
    timeout: String(s.timeout_s),
    budget: num(s.token_budget),
    sources: stageSourcesToDraft(s.sources),
    mustKnow: mustKnowToDraft(s.must_know),
    autofix: autofixToDraft(s.autofix),
    ...(s.ui ? { uiY: s.ui.y } : {}),
    ...(s.slot ? { slotRaw: repairSlot(structuredClone(s.slot)) } : {}),
  };
}

function executorDef(s: StageDraft): ProcessStageDef["executor"] {
  const kind = draftKindOf(s.executor);
  return kind ? feNodeOf(kind).toDef(s) : executorToDef(s.executor);
}

/** Họ wait / apply (Chờ / Áp) không rẽ nhánh (luật bị bỏ khi gửi). */
function branchOf(s: StageDraft): ProcessStageDef["after"]["branch"] {
  const kind = draftKindOf(s.executor);
  const family = kind ? feNodeOf(kind).family : null;
  return family === "wait" || family === "apply" || family === "control"
    ? []
    : branchToRules(s.branch, s.fields);
}

export function stageToInput(draft: StageDraft): ProcessStageDef {
  const s = normalizeIf(normalizeSet(normalizeTool(normalizeWait(normalizeApply(draft)))));
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
            ...(s.excludeStarter ? { exclude_starter: true } : {}),
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
    ...(s.uiY === undefined ? {} : { ui: { y: clampUiY(s.uiY) } }),
    ...(s.slotRaw ? { slot: s.slotRaw } : {}),
  };
}

/** `ui.y` gửi Hub: làm tròn + kẹp trong biên contract. */
const clampUiY = (y: number): number =>
  Math.min(Math.max(Math.round(y), STAGE_UI_Y.min), STAGE_UI_Y.max);
