// CR-103 · fnr-if · node `if` (họ control, design §3): Hub tự đánh giá AND/OR trên field stage bước trước / input run, rẽ Đúng/Sai
// theo bước — không agent, không output field. Phần thuần: luật def (IF_INVALID) + ép trường khi lưu.
import {
  HANDOFF_SECTION,
  NODE_FAMILY_OF,
  type ProcessDefInput,
  resolveSteps,
} from "@ai/contracts/hub-admin";
import { toIfStage } from "../../defs/if-stage.map";
import { ifDefIssues } from "../../domain/if/if.rules";
import type { DefIssue, DefStage, NodeSpec } from "../types";

/** IF_INVALID chỉ khi def có stage If (mapper contract → domain). */
function ifIssuesOf(d: ProcessDefInput): DefIssue[] {
  if (!d.stages.some((s) => s.executor.kind === "if")) return [];
  const steps = resolveSteps(d.stages);
  const stages = d.stages.map((s, i) => toIfStage(s, steps[i] as number));
  return ifDefIssues(
    stages,
    (d.inputs ?? []).map((x) => ({ key: x.key, type: x.type })),
  );
}

const IF_TEMPLATE = `# {name}\n\n## ${HANDOFF_SECTION}\n`;

/** Stage `if`: Hub ép template/mục/field/answerer/nguồn (không sinh output); giữ `filename`, `after`, `real_action` để luật def bắt lỗi. */
export function ensureIfStage<S extends DefStage>(s: S): S {
  if (s.executor.kind !== "if") return s;
  return {
    ...s,
    output: {
      ...s.output,
      template: IF_TEMPLATE,
      required_sections: [HANDOFF_SECTION],
      fields: [],
    },
    answerer: { kind: "starter" },
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
}

export const ifNode: NodeSpec<"if"> = {
  kind: "if",
  family: NODE_FAMILY_OF.if,
  produces: "none",
  realAction: false,
  handoff: false,
  defIssues: ifIssuesOf,
  normalize: ensureIfStage,
};
