// CR-103 · R4 · node `set` (họ work): Hub ghi field từ input run / hằng, không AI, không agent. Phần thuần: luật def
// (`setDefIssues`, SET_INVALID) + ép trường khi lưu (template/mục cố định, không agent-only cấu hình).
import { NODE_FAMILY_OF, type ProcessDefInput } from "@ai/contracts/hub-admin";
import { setDefIssues } from "../../domain/set/set.rules";
import type { DefIssue, DefStage, NodeSpec } from "../types";

export const SET_RESULT_SECTION = "Kết quả";
export const SET_STAGE_TEMPLATE = `# {name}\n\n## ${SET_RESULT_SECTION}\n`;

function setIssuesOf(d: ProcessDefInput): DefIssue[] {
  if (!d.stages.some((s) => s.executor.kind === "set")) return [];
  const inputs = (d.inputs ?? []).map((x) => ({ key: x.key, type: x.type }));
  return setDefIssues(
    d.stages.map((s) => ({
      executor: s.executor.kind === "set" ? s.executor : { kind: s.executor.kind },
      fields: s.output.fields,
    })),
    inputs,
  );
}

/** `set`: Hub ép template/mục/answerer/token_budget/sources/must_know/autofix; giữ `fields`, `timeout_s`. */
export function ensureSetStage<S extends DefStage>(s: S): S {
  if (s.executor.kind !== "set") return s;
  return {
    ...s,
    output: {
      ...s.output,
      template: SET_STAGE_TEMPLATE,
      required_sections: [SET_RESULT_SECTION],
    },
    answerer: { kind: "starter" },
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
}

export const setNode: NodeSpec<"set"> = {
  kind: "set",
  family: NODE_FAMILY_OF.set,
  produces: "declared",
  realAction: false,
  handoff: false,
  defIssues: setIssuesOf,
  normalize: ensureSetStage,
};
