// ADM-FR-71/72 · P-d1 · plan-frontend §6: mã lỗi / vấn đề form → khoá i18n (admin, tiền tố `process.admin.*`). Thuần.
import type { EscalateIssues } from "./remind-rules";
import type { WaitFormIssues } from "./wait-rules";

const WAIT = "process.admin.editor.stage.wait.err";
const STAGE = "process.admin.editor.stage.err";

/** Luật 422 `PROCESS_DEF_INVALID` (rule) → khoá; luật lạ ⇒ null (người gọi dùng câu chung). */
export function ruleErrorKey(rule: string): string | null {
  if (rule === "WAIT_INVALID") return `${WAIT}.WAIT_INVALID`;
  if (rule === "ESCALATE_INVALID") return `${STAGE}.ESCALATE_INVALID`;
  if (rule === "TOOL_INVALID" || rule === "TOOL_SIDE_EFFECT") return `${STAGE}.tool.err.${rule}`;
  if (rule === "SET_INVALID") return "process.admin.editor.stage.set.err";
  if (rule === "BRANCH_INVALID") return `${STAGE}.branch.err.BRANCH_INVALID`;
  return null;
}

export const waitIssueKey = (field: keyof WaitFormIssues): string => `${WAIT}.${field}`;
export const remindIssueKey = (): string => `${STAGE}.remind`;
export function escalateIssueKey(field: keyof EscalateIssues): string {
  return field === "afterH" ? `${STAGE}.escalateAfter` : `${STAGE}.escalateGroup`;
}
export const ttlIssueKey = (): string => "process.admin.editor.err.ttl";
export const TIMEZONE_UNSUPPORTED_KEY = "tenants.error.timezoneUnsupported";
