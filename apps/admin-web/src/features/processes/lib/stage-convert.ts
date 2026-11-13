// ADM-FR-66 · CR-056 · P-a F5 · P-d2: đổi một giai đoạn qua lại giữa `ProcessStageDef` (contract) và `StageDraft` (editor) — tách từ
// `def-form` (file ≤ 400 dòng). Hàm thuần: không React, không gọi API.
import {
  type LayoutDir,
  type ProcessStageDef,
  STAGE_TIMEOUT_S,
  STAGE_UI_Y,
} from "@ai/contracts/hub-admin";
import { draftKindOf, type FeNode, feNodeOf } from "../nodes/registry";
import { executorToDef, normalizeApply } from "./apply-form";
import { autofixToDef, autofixToDraft, emptyAutofix } from "./autofix-form";
import { branchToRules, rulesToBranch } from "./branch-form";
import type { ReviewExtra, StageDraft } from "./draft-types";
import { normalizeForm } from "./form-fields";
import { emptyIf, normalizeIf } from "./if-form";
import { parallelFromDef, parallelToDef } from "./parallel-form";
import { emptySet, normalizeSet } from "./set-form";
import { repairSlot } from "./slot-canvas";
import {
  mustKnowToDef,
  mustKnowToDraft,
  stageSourcesToDef,
  stageSourcesToDraft,
} from "./sources-form";
import { startFormToDef, startFormToDraft } from "./start-form";
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
): Pick<
  StageDraft,
  "executor" | "wait" | "tool" | "set" | "ifx" | "approve" | "notifyRaw" | "subprocess"
> {
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

/** Stage THÔ (chưa qua zod) vẫn đọc được: stage biên dịch từ khe của Thư viện (xem chỉ đọc `process-library`) không mang các trường mặc định này. */
const rawListsToDraft = (s: ProcessStageDef) => ({
  sources: stageSourcesToDraft(s.sources ?? []),
  mustKnow: mustKnowToDraft(s.must_know ?? []),
});

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
    ...reviewExtraToDraft(rv),
    ...(rv?.parallel ? { parallel: parallelFromDef(rv.parallel) } : {}),
    instruction: s.instruction,
    filename: s.output.filename,
    template: s.output.template,
    sections: [...s.output.required_sections],
    fields: s.output.fields.map((f) => ({ ...f })),
    after: s.after.kind,
    step,
    backTo: s.after.kind === "review" ? [...(s.after.back_to_steps ?? [])] : [],
    groupId: s.after.kind === "review" ? (s.after.group_id ?? "") : "",
    ...groupKeyDraft(s.after),
    real: s.real_action,
    answerer: a.kind,
    answererId: a.kind === "group" ? (a.group_id ?? "") : a.kind === "user" ? a.user_id : "",
    timeout: String(s.timeout_s),
    budget: num(s.token_budget),
    ...rawListsToDraft(s),
    autofix: autofixToDraft(s.autofix),
    ...uiToDraft(s.ui),
    ...optionalDraftPart(s),
  };
}

const optionalDraftPart = (s: ProcessStageDef): Partial<StageDraft> => ({
  ...(s.outcome === undefined ? {} : { outcome: s.outcome }),
  ...(s.next_step === undefined ? {} : { nextStep: s.next_step }),
  ...(s.node === undefined ? {} : { node: s.node }),
  ...(s.start_form ? { startForm: startFormToDraft(s.start_form) } : {}),
  ...(s.slot ? { slotRaw: repairSlot(structuredClone(s.slot)) } : {}),
});

/** CR-127 · U2 · `need` / `evidence` + trường giữ nguyên của bước Duyệt ⇄ `StageDraft.review`. */
function reviewExtraToDraft(
  rv: Extract<ProcessStageDef["after"], { kind: "review" }> | null,
): Partial<StageDraft> {
  if (!rv) return {};
  const r: ReviewExtra = {
    ...(rv.need ? { need: rv.need } : {}),
    ...(rv.evidence ? { evidence: rv.evidence } : {}),
    ...(rv.head_only ? { headOnly: true } : {}),
    ...(rv.approver_user_id ? { approverUserId: rv.approver_user_id } : {}),
    ...(rv.approver_mode === "starter_head" ? { approverMode: "starter_head" as const } : {}),
    ...(rv.also_group_ids?.length ? { alsoGroupIds: [...rv.also_group_ids] } : {}),
    ...(rv.also_group_keys?.length ? { alsoGroupKeys: [...rv.also_group_keys] } : {}),
  };
  return Object.keys(r).length > 0 ? { review: r } : {};
}
const reviewExtraToDef = (r: ReviewExtra | undefined) =>
  r
    ? {
        ...(r.need ? { need: r.need } : {}),
        ...(r.evidence ? { evidence: r.evidence } : {}),
        ...(r.headOnly ? { head_only: true } : {}),
        ...(r.approverUserId ? { approver_user_id: r.approverUserId } : {}),
        ...(r.approverMode === "starter_head" ? { approver_mode: "starter_head" as const } : {}),
        ...(r.alsoGroupIds?.length ? { also_group_ids: r.alsoGroupIds } : {}),
        ...(r.alsoGroupKeys?.length ? { also_group_keys: r.alsoGroupKeys } : {}),
      }
    : {};

/** Mã nhóm duyệt của mẫu Thư viện (`after.group_key`) ⇒ nháp. */
const groupKeyDraft = (a: ProcessStageDef["after"]): { groupKey?: string } =>
  a.kind === "review" && a.group_key ? { groupKey: a.group_key } : {};

/** Nhóm duyệt khi lưu: mã (mẫu Thư viện) thì không có id, và ngược lại. */
// CR-140 · «cùng duyệt»: nhóm nằm trong `parallel.groups` ⇒ `group_id` của bước luôn null (máy chủ báo PARALLEL_RULE_INVALID nếu khác).
const reviewGroupToDef = (s: StageDraft): { group_id: string | null; group_key?: string } =>
  s.parallel
    ? { group_id: null }
    : s.groupKey
      ? { group_id: null, group_key: s.groupKey }
      : { group_id: s.groupId || null };

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

function answererToDef(s: StageDraft): ProcessStageDef["answerer"] {
  return s.answerer === "group"
    ? { kind: "group", group_id: s.answererId }
    : s.answerer === "user"
      ? { kind: "user", user_id: s.answererId }
      : { kind: "starter" };
}

export function stageToInput(draft: StageDraft): ProcessStageDef {
  const s = normalizeForm(
    normalizeIf(normalizeSet(normalizeTool(normalizeWait(normalizeApply(draft))))),
  );
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
            ...reviewGroupToDef(s),
            back_to_steps: s.backTo,
            remind_every_h: remindToDef(s),
            escalate: escalateToDef(s),
            ...(s.excludeStarter ? { exclude_starter: true } : {}),
            ...reviewExtraToDef(s.review),
            ...(s.parallel ? { parallel: parallelToDef(s.parallel) } : {}),
            ...branch,
          }
        : { kind: "auto", ...branch },
    real_action: s.real,
    answerer: answererToDef(s),
    timeout_s: Number(s.timeout),
    token_budget: intOrNull(s.budget),
    sources: stageSourcesToDef(s.sources),
    must_know: mustKnowToDef(s.mustKnow),
    autofix: autofixToDef(s.autofix),
    ...uiToDef(s),
    ...(s.outcome === undefined ? {} : { outcome: s.outcome }),
    ...(s.nextStep === undefined ? {} : { next_step: s.nextStep }),
    ...(s.node === undefined ? {} : { node: s.node }),
    ...(s.startForm ? { start_form: startFormToDef(s.startForm) } : {}),
    ...(s.slotRaw ? { slot: s.slotRaw } : {}),
  };
}

/** `ui.y` gửi Hub: làm tròn + kẹp trong biên contract. */
const clampUiY = (y: number): number =>
  Math.min(Math.max(Math.round(y), STAGE_UI_Y.min), STAGE_UI_Y.max);

/** CR-123 · u13 · `ui` của def → vị trí kéo tay của bản nháp (`uiY` + tuỳ chọn `uiX`); CR-125 · x9 · + hướng bố cục (`uiDir`). */
const uiToDraft = (
  ui: { y?: number | undefined; x?: number | undefined; dir?: LayoutDir | undefined } | undefined,
) => ({
  ...(ui?.y === undefined ? {} : { uiY: ui.y }),
  ...(ui?.x === undefined ? {} : { uiX: ui.x }),
  ...(ui?.dir === undefined ? {} : { uiDir: ui.dir }),
});

/** Bản nháp → `ui` gửi Hub (vị trí tay khi có `uiY`, `x` đi kèm nếu có; hướng bố cục khi có `uiDir`). */
const uiToDef = (s: {
  uiY?: number | undefined;
  uiX?: number | undefined;
  uiDir?: LayoutDir | undefined;
}) =>
  s.uiY === undefined && s.uiDir === undefined
    ? {}
    : {
        ui: {
          ...(s.uiY === undefined ? {} : { y: clampUiY(s.uiY) }),
          ...(s.uiY === undefined || s.uiX === undefined ? {} : { x: clampUiY(s.uiX) }),
          ...(s.uiDir === undefined ? {} : { dir: s.uiDir }),
        },
      };
