// HUB-FR-146 · HUB-FR-147 · AC-H44 · AC-H45 · P-d2 (plan-frontend-d2 §10, §13): validate "Gọi tool" + "Rẽ nhánh" của editor — gọi CÙNG hàm
// contract với server (`toolStageIssues`, `branchStageIssues`) rồi đổi mã luật + path thành khoá câu lỗi theo ô. Thuần.
import {
  type BranchStageDraft,
  branchStageIssues,
  type ProcessDefIssue,
  type ProcessToolItem,
  type ToolCatalogShape,
  type ToolStageDraft,
  toolStageIssues,
} from "@ai/contracts/hub-admin";
import { targetHasReal } from "../domain/branch-rules";
import { branchToRules } from "./branch-form";
import type { DraftErrors, StageDraft } from "./draft-types";
import type { InputDraft } from "./sources-form";
import { hasArg, isTool, toolToDef } from "./tool-form";
import { isWait } from "./wait-form";

const T = "process.admin.editor.stage.tool.err.";
const B = "process.admin.editor.stage.branch.err.";
export const TOOL_ERR = {
  invalid: `${T}TOOL_INVALID`,
  sideEffect: `${T}TOOL_SIDE_EFFECT`,
  ref: `${T}ref`,
  argRequired: `${T}argRequired`,
  pick: `${T}pick`,
} as const;
/** Khoá lỗi P-d2 do `d2LiveErrors` tính lại mỗi lần render (trừ `argRequired`, chỉ sinh khi Lưu). */
export const isD2Key = (v: string): boolean =>
  v !== TOOL_ERR.argRequired && (v.startsWith(T) || v.startsWith(B));
export const BRANCH_ERR = { all: `${B}BRANCH_INVALID`, real: `${B}real` } as const;

const isApplyKind = (s: Pick<StageDraft, "executor">) => s.executor === "apply";
/** Giai đoạn không dùng rẽ nhánh (chờ ngày / áp bản sửa) ⇒ luật bị bỏ khi gửi. */
export const branchOff = (s: Pick<StageDraft, "executor">): boolean => isWait(s) || isApplyKind(s);

export function toolMap(tools: readonly ProcessToolItem[]): Map<string, ToolCatalogShape> {
  return new Map(tools.map((t) => [t.key, t]));
}

function toolShape(s: StageDraft): ToolStageDraft {
  return {
    key: s.key,
    step: s.step,
    real_action: s.real,
    after: { kind: s.after, back_to_steps: s.backTo },
    executor: isTool(s) ? toolToDef(s.tool) : { kind: "agent" },
    answerer: { kind: "starter" },
    output: { fields: s.fields },
  };
}

function branchShape(s: StageDraft): BranchStageDraft {
  return {
    key: s.key,
    step: s.step,
    real_action: s.real,
    after: {
      kind: s.after,
      back_to_steps: s.backTo,
      branch: branchOff(s) ? [] : branchToRules(s.branch, s.fields),
    },
    output: { fields: s.fields },
  };
}

function branchKey(i: ProcessDefIssue, stages: readonly StageDraft[]): string {
  const m = /^stages\.(\d+)\.after\.branch\.\d+\.(field|op|value|goto_step)$/.exec(i.path);
  if (!m) return BRANCH_ERR.all;
  const cell = m[2] as string;
  if (cell !== "goto_step") return `${B}${cell}`;
  const s = stages[Number(m[1])];
  const g = s?.branch[Number(i.path.split(".")[4])]?.goto ?? null;
  const real = targetHasReal(
    stages.map((x) => ({ step: x.step, real: x.real })),
    g === null ? null : g - 1,
  );
  return real && s?.after !== "review" ? BRANCH_ERR.real : `${B}goto`;
}

/** Lỗi rẽ nhánh theo path (`stages.i.after.branch[.j.<ô>]`). */
export function branchErrors(stages: readonly StageDraft[]): DraftErrors {
  const e: DraftErrors = {};
  for (const i of branchStageIssues(stages.map(branchShape))) e[i.path] ??= branchKey(i, stages);
  return e;
}

/** Tham số bắt buộc CHƯA khai nguồn (path `stages.i.executor.args.<name>`) ⇒ chỉ báo khi Lưu (`toolSubmitErrors`), không báo live. */
function unfilled(stages: readonly StageDraft[], path: string): boolean {
  const m = /^stages\.(\d+)\.executor\.args\.(.+)$/.exec(path);
  const s = m ? stages[Number(m[1])] : undefined;
  return s !== undefined && isTool(s) && !hasArg(s.tool, m?.[2] ?? "");
}

/** Lỗi gọi tool hiện NGAY khi sửa;  `tools` vắng (catalog chưa nạp) ⇒ bỏ kiểm theo catalog. */
export function toolErrors(
  stages: readonly StageDraft[],
  inputs: readonly InputDraft[],
  tools: readonly ProcessToolItem[] | undefined,
): DraftErrors {
  const e: DraftErrors = {};
  if (!tools) return e;
  const issues = toolStageIssues(
    stages.map(toolShape),
    inputs.map((x) => ({ key: x.key, type: x.type })),
    toolMap(tools),
  );
  for (const i of issues) {
    if (i.rule === "TOOL_SIDE_EFFECT") e[i.path] ??= TOOL_ERR.sideEffect;
    else if (i.rule === "TOOL_INVALID" && !unfilled(stages, i.path)) e[i.path] ??= TOOL_ERR.invalid;
  }
  stages.forEach((s, i) => {
    if (isTool(s) && s.tool.key !== "" && !tools.some((t) => t.key === s.tool.key))
      e[`stages.${i}.executor.tool_key`] = TOOL_ERR.ref;
  });
  return e;
}

/** Khi Lưu: thêm "chọn nguồn" cho tham số bắt buộc chưa khai, và "chọn tool" khi chưa chọn. */
export function toolSubmitErrors(
  stages: readonly StageDraft[],
  tools: readonly ProcessToolItem[] | undefined,
): DraftErrors {
  const e: DraftErrors = {};
  stages.forEach((s, i) => {
    if (!isTool(s)) return;
    if (s.tool.key === "") e[`stages.${i}.executor`] = TOOL_ERR.pick;
    const tool = tools?.find((t) => t.key === s.tool.key);
    for (const p of tool?.params ?? [])
      if (p.required && !hasArg(s.tool, p.name))
        e[`stages.${i}.executor.args.${p.name}`] = TOOL_ERR.argRequired;
  });
  return e;
}

/** Gộp lỗi P-d2 (live) vào `e`; lỗi đã có ở cùng path (vd từ server) bị thay bởi bản live mới nhất. */
export function d2LiveErrors(
  stages: readonly StageDraft[],
  inputs: readonly InputDraft[],
  tools: readonly ProcessToolItem[] | undefined,
): DraftErrors {
  return { ...branchErrors(stages), ...toolErrors(stages, inputs, tools) };
}

/**
 * Lỗi đã có (lần Lưu trước / server) trừ khoá P-d2 mà `d2LiveErrors` tính lại mỗi lần render; riêng `argRequired` (chỉ sinh khi Lưu)
 * còn giữ chừng nào tham số đó vẫn chưa khai nguồn.
 */
export function carryErrors(
  errors: DraftErrors,
  stages: readonly StageDraft[],
  tools: readonly ProcessToolItem[] | undefined,
): DraftErrors {
  const submit = toolSubmitErrors(stages, tools);
  return Object.fromEntries(
    Object.entries(errors).filter(([k, v]) =>
      v === TOOL_ERR.argRequired ? !!submit[k] : !isD2Key(v),
    ),
  );
}
