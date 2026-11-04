// CR-118 · cr118-form-node · node `form` (họ work): một người thuộc Group của bước điền form (tập con trường cố định).
// Phần thuần: luật def (FORM_INVALID: phải `after: review` để có người làm, không `real_action`) + ép trường khi lưu
// (template/mục cố định, `output.fields` dựng từ trường form ⇒ If/bước sau đọc được; không agent-only cấu hình).
import { NODE_FAMILY_OF, type ProcessDefInput } from "@ai/contracts/hub-admin";
import { formOutputFields } from "../../domain/form/form.rules";
import type { DefIssue, DefStage, NodeSpec } from "../types";

export const FORM_RESULT_SECTION = "Kết quả";
export const FORM_STAGE_TEMPLATE = `# {name}\n\n## ${FORM_RESULT_SECTION}\n`;

/** FORM_INVALID: stage form phải chờ người (`after.kind = review`, Group/người duyệt = người điền) và không real_action. */
export function formDefIssues(d: ProcessDefInput): DefIssue[] {
  const out: DefIssue[] = [];
  d.stages.forEach((s, i) => {
    if (s.executor.kind !== "form") return;
    if (s.after.kind !== "review") out.push({ path: `stages.${i}.after`, rule: "FORM_INVALID" });
    if (s.real_action) out.push({ path: `stages.${i}.real_action`, rule: "FORM_INVALID" });
    // Luật chéo stage (If/wait đọc field) kiểm TRƯỚC `normalize` ⇒ `output.fields` phải khớp trường form (key + kiểu).
    if (!sameFields(formOutputFields(s.executor.fields), s.output.fields))
      out.push({ path: `stages.${i}.output.fields`, rule: "FORM_INVALID" });
  });
  return out;
}

const sig = (fs: readonly { key: string; type: string }[]): string =>
  fs.map((f) => `${f.key}:${f.type}`).join(",");
const sameFields = (
  a: readonly { key: string; type: string }[],
  b: readonly { key: string; type: string }[],
): boolean => sig(a) === sig(b);

/** `form`: Hub ép template/mục/fields/answerer/token_budget/sources/must_know/autofix; giữ `after`, `timeout_s`. */
export function ensureFormStage<S extends DefStage>(s: S): S {
  if (s.executor.kind !== "form") return s;
  return {
    ...s,
    output: {
      ...s.output,
      template: FORM_STAGE_TEMPLATE,
      required_sections: [FORM_RESULT_SECTION],
      fields: formOutputFields(s.executor.fields),
    },
    answerer: { kind: "starter" },
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
}

export const formNode: NodeSpec<"form"> = {
  kind: "form",
  family: NODE_FAMILY_OF.form,
  produces: "declared",
  realAction: false,
  handoff: false,
  defIssues: formDefIssues,
  normalize: ensureFormStage,
};
