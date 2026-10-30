// ADM-FR-71 · HUB-FR-143/144 · P-d1 T11b (plan-frontend FD2/FD4/§2): stage "Chờ tới ngày" + nhắc lặp/chuyển cấp của editor —
// ép giá trị khoá, đổi qua lại với contract, validate form. Hàm thuần theo mẫu `apply-form` (không React, không gọi API).
import {
  type ProcessDefIssue,
  type ProcessDefStageDraft,
  type ProcessStageDef,
  STAGE_TIMEOUT_S,
  type StageEscalate,
  type TeamSectionsInfo,
} from "@ai/contracts/hub-admin";
import { escalateIssueKey, remindIssueKey, ruleErrorKey, waitIssueKey } from "../domain/error-keys";
import { escalateIssues, remindIssue } from "../domain/remind-rules";
import { type DateSource, dateSources, parseSourceValue, waitIssues } from "../domain/wait-rules";
import { emptyAutofix } from "./autofix-form";
import type { EscalateDraft, StageDraft, WaitDraft } from "./draft-types";
import type { InputDraft } from "./sources-form";

type Errors = Record<string, string>;
type WaitExecutor = Extract<ProcessStageDef["executor"], { kind: "wait_until" }>;

/** Giá trị `StageDraft.executor` của kiểu "Chờ tới ngày" (P-d2 sẽ thêm "tool"). */
export const WAIT_EXECUTOR = "wait_until";
export const WAIT_HANDOFF_SECTION = "Bàn giao";
export const TEAM_SECTION_KEY = "process.admin.editor.err.TEAM_SECTION_UNOWNED";

export const emptyWait = (): WaitDraft => ({ source: "", offset: "0", time: "09:00" });
export const emptyEscalate = (): EscalateDraft => ({ on: false, afterH: "24", groupId: "" });

export const isWait = (s: Pick<StageDraft, "executor">): boolean => s.executor === WAIT_EXECUTOR;

/** Chọn "Chờ tới ngày": tự chạy tiếp, không hành động thật, không quay lại (cố định). */
export const WAIT_PATCH: Partial<StageDraft> = {
  executor: WAIT_EXECUTOR,
  real: false,
  after: "auto",
  backTo: [],
  groupId: "",
};

/** Bản dùng để gửi/validate: xoá ô ẩn; Hub ép lại output/answerer/token_budget/timeout_s (plan §2, §14 G3). */
export function normalizeWait(s: StageDraft): StageDraft {
  if (!isWait(s)) return s;
  return {
    ...s,
    ...WAIT_PATCH,
    instruction: "",
    filename: `${s.key}.md`,
    template: `# ${s.name.trim()}\n\n## ${WAIT_HANDOFF_SECTION}\n`,
    sections: [WAIT_HANDOFF_SECTION],
    fields: [],
    answerer: "starter",
    answererId: "",
    timeout: String(STAGE_TIMEOUT_S.default),
    budget: "",
    sources: [],
    mustKnow: "",
    autofix: emptyAutofix(),
  };
}

export function waitFromDef(ex: WaitExecutor): WaitDraft {
  const from =
    ex.from.kind === "input"
      ? `input:${ex.from.key}`
      : `field:${ex.from.stage_key}:${ex.from.field}`;
  return { source: from, offset: String(ex.offset_days), time: ex.time };
}

export function waitToDef(w: WaitDraft): WaitExecutor {
  const p = parseSourceValue(w.source);
  const from =
    p?.kind === "field"
      ? ({ kind: "field", stage_key: p.stageKey, field: p.field } as const)
      : ({ kind: "input", key: p?.kind === "input" ? p.key : "" } as const);
  return { kind: "wait_until", from, offset_days: Number(w.offset.trim()), time: w.time };
}

const hours = (t: string): number => Number(t.trim());
export const remindToDef = (s: Pick<StageDraft, "remind">): number | null =>
  s.remind.trim() === "" ? null : hours(s.remind);
export const escalateToDef = (s: Pick<StageDraft, "escalate">): StageEscalate | null =>
  s.escalate.on ? { after_h: hours(s.escalate.afterH), group_id: s.escalate.groupId } : null;

export const remindFromDef = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);
export function escalateFromDef(e: StageEscalate | null | undefined): EscalateDraft {
  return e ? { on: true, afterH: String(e.after_h), groupId: e.group_id ?? "" } : emptyEscalate();
}

/** Lỗi form "Chờ tới ngày": nguồn / chênh / giờ → path như server (`stages.i.executor.*`). */
function validateWaitStage(
  s: StageDraft,
  at: (f: string) => string,
  sources: readonly DateSource[],
  e: Errors,
): void {
  const w = waitIssues(s.wait, sources);
  if (w.source) e[at("executor.from")] = waitIssueKey("source");
  if (w.offset) e[at("executor.offset_days")] = waitIssueKey("offset");
  if (w.time) e[at("executor.time")] = waitIssueKey("time");
}

/** Lỗi form nhắc lặp + chuyển cấp của giai đoạn Duyệt. */
function validateGateStage(s: StageDraft, at: (f: string) => string, e: Errors): void {
  if (remindIssue(s.remind)) e[at("after.remind_every_h")] = remindIssueKey();
  const x = escalateIssues(s.escalate, s.groupId);
  if (x.afterH) e[at("after.escalate.after_h")] = escalateIssueKey("afterH");
  if (x.groupId) e[at("after.escalate.group_id")] = escalateIssueKey("groupId");
}

/** Lỗi form của các giai đoạn: Chờ tới ngày và nhắc/chuyển cấp (Duyệt). */
export function validateWaitPart(
  stages: readonly StageDraft[],
  inputs: readonly InputDraft[],
  e: Errors,
): void {
  stages.forEach((s, i) => {
    const at = (f: string) => `stages.${i}.${f}`;
    if (isWait(s)) validateWaitStage(s, at, dateSources(inputs, stages, s.step), e);
    else if (s.after === "review") validateGateStage(s, at, e);
  });
}
/** Hình stage cho `processDefStageIssues` (stage đã `normalizeWait`). Stage Áp không khai executor (luật Áp chạy riêng). */
export function stageShape(s: StageDraft): ProcessDefStageDraft {
  const executor = isWait(s)
    ? waitToDef(s.wait)
    : s.executor.startsWith("team:")
      ? { kind: "team", team_id: s.executor.slice(5) }
      : s.executor.startsWith("agent:")
        ? { kind: "agent" }
        : undefined;
  // `required_sections` không thuộc hình `WaitStageShape` nhưng `teamSectionIssues` đọc ở runtime ⇒ gán qua biến.
  const output = { fields: s.fields, required_sections: s.sections };
  return {
    key: s.key,
    step: s.step,
    real_action: s.real,
    ...(executor ? { executor } : {}),
    after: {
      kind: s.after,
      back_to_steps: s.after === "review" ? s.backTo : [],
      group_id: s.after === "review" ? s.groupId || null : null,
      escalate: s.after === "review" ? escalateToDef(s) : null,
    },
    output,
  };
}

const covered = (e: Errors, path: string): boolean =>
  Object.keys(e).some((k) => k === path || k.startsWith(`${path}.`));

/** Luật contract P-d1 (WAIT/ESCALATE/TEAM_SECTION) → khoá câu lỗi tại path; ô đã có lỗi riêng thì giữ lỗi đó. */
export function addCrossIssue(issue: ProcessDefIssue, e: Errors): void {
  const key = crossRuleKey(issue.rule);
  if (key && !covered(e, issue.path)) e[issue.path] = key;
}

/** Mã luật 422 `PROCESS_DEF_INVALID` của P-d1 → khoá câu lỗi (luật lạ ⇒ null). */
export const crossRuleKey = (rule: string): string | null =>
  rule === "TEAM_SECTION_UNOWNED" ? TEAM_SECTION_KEY : ruleErrorKey(rule);

/** Thông tin nhóm cho luật mục bắt buộc: team_id → chế độ + mục từng thành viên. */
export type TeamSections = ReadonlyMap<string, TeamSectionsInfo>;

/** Server trả path ô Chờ tới ngày/Chuyển cấp ⇒ ô hiển thị lỗi ("dưới khối Lấy ngày từ" — plan §6). */
export const waitErrorAt = (errors: Errors, i: number): string | undefined =>
  errors[`stages.${i}.executor.from`] ??
  errors[`stages.${i}.executor`] ??
  errors[`stages.${i}.after`];
