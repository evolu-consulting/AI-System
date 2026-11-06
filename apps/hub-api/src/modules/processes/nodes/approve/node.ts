// CR-122 · E2b · node Duyệt độc lập (họ work, không AI): người/Group của bước quyết qua cổng kiểm có sẵn (`after: review`).
// Phần thuần: luật def (APPROVE_INVALID) + ép trường khi lưu (template/mục cố định, field `decision` cho bước sau đọc).
import {
  APPROVE_DECISION_FIELD,
  approveStageIssues,
  NODE_FAMILY_OF,
  type ProcessDefInput,
  resolveSteps,
} from "@ai/contracts/hub-admin";
import type { DefIssue, DefStage, NodeSpec } from "../types";

export const APPROVE_RESULT_SECTION = "Quyết định";
export const APPROVE_TEMPLATE = `# {name}\n\n## ${APPROVE_RESULT_SECTION}\n`;

function approveIssuesOf(d: ProcessDefInput): DefIssue[] {
  if (!d.stages.some((s) => s.executor.kind === "approve")) return [];
  return approveStageIssues(d.stages, resolveSteps(d.stages));
}

/** `approve`: Hub ép template/mục/field `decision`/answerer/nguồn; giữ `after` (Group, nhắc, chuyển cấp) và đích rẽ. */
export function ensureApproveStage<S extends DefStage>(s: S): S {
  if (s.executor.kind !== "approve") return s;
  return {
    ...s,
    output: {
      ...s.output,
      template: APPROVE_TEMPLATE,
      required_sections: [APPROVE_RESULT_SECTION],
      // `required` bắt buộc theo `ProcessStageDefSchema` (thiếu ⇒ def đã lưu không đọc lại được bằng `parseFlowDef`).
      fields: [{ key: APPROVE_DECISION_FIELD, type: "string", required: true }],
    },
    answerer: { kind: "starter" },
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
}

export const approveNode: NodeSpec<"approve"> = {
  kind: "approve",
  family: NODE_FAMILY_OF.approve,
  produces: "declared",
  realAction: false,
  handoff: false,
  defIssues: approveIssuesOf,
  normalize: ensureApproveStage,
};
