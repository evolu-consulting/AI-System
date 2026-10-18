// ADM-FR-66 · CR-056 · P-a F5: validate client từng giai đoạn (tên, mã, người làm, output, người trả lời, hạn) — tách từ `def-form`
// (file ≤ 400 dòng). Khớp contract; câu lỗi ở i18n `process.admin.validate.*`. Hàm thuần.
import {
  FIELD_KEY_RE,
  OUTPUT_FILENAME_RE,
  PROCESS_NAME_MAX,
  STAGE_FIELDS_MAX,
  STAGE_INSTRUCTION_MAX,
  STAGE_KEY_RE,
  STAGE_SECTIONS_MAX,
  STAGE_TEMPLATE_MAX,
  STAGE_TIMEOUT_S,
  STAGE_TOKEN_BUDGET,
} from "@ai/contracts/hub-admin";
import { isApply } from "./apply-form";
import type { DraftErrors, StageDraft } from "./draft-types";

export const P = "process.admin.validate.";
export const inRange = (s: string, min: number, max: number): boolean => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
};
export const budgetOk = (s: string): boolean =>
  s.trim() === "" || inRange(s, STAGE_TOKEN_BUDGET.min, STAGE_TOKEN_BUDGET.max);

function validateOutput(s: StageDraft, at: (f: string) => string, e: DraftErrors) {
  if (!OUTPUT_FILENAME_RE.test(s.filename)) e[at("output.filename")] = `${P}fileName`;
  if (s.template.length < 1 || s.template.length > STAGE_TEMPLATE_MAX)
    e[at("output.template")] = s.template.length < 1 ? `${P}templateRequired` : `${P}tooLong`;
  if (s.sections.length < 1 || s.sections.length > STAGE_SECTIONS_MAX)
    e[at("output.required_sections")] = `${P}sectionRequired`;
  if (s.fields.length > STAGE_FIELDS_MAX) e[at("output.fields")] = `${P}tooMany`;
  s.fields.forEach((f, j) => {
    if (!FIELD_KEY_RE.test(f.key)) e[at(`output.fields.${j}.key`)] = `${P}fieldKey`;
  });
}

export function validateStage(
  s: StageDraft,
  i: number,
  all: readonly StageDraft[],
  e: DraftErrors,
) {
  const at = (f: string) => `stages.${i}.${f}`;
  if (s.name.trim() === "" || s.name.trim().length > PROCESS_NAME_MAX)
    e[at("name")] = `${P}nameRequired`;
  if (!STAGE_KEY_RE.test(s.key)) e[at("key")] = `${P}stageKey`;
  else if (all.some((o, j) => j < i && o.key === s.key)) e[at("key")] = `${P}stageKeyDup`;
  if (s.executor === "") e[at("executor")] = `${P}executor`;
  if (!isApply(s) && s.instruction.length > STAGE_INSTRUCTION_MAX)
    e[at("instruction")] = `${P}tooLong`;
  validateOutput(s, at, e);
  if (s.answerer !== "starter" && s.answererId === "") e[at("answerer")] = `${P}answerer`;
  if (!inRange(s.timeout, STAGE_TIMEOUT_S.min, STAGE_TIMEOUT_S.max))
    e[at("timeout_s")] = `${P}timeout`;
  if (!isApply(s) && !budgetOk(s.budget)) e[at("token_budget")] = `${P}budget`;
}
