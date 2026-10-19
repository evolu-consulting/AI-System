// ADM-FR-65 · ADM-FR-66 · CR-056 · P-a F5: mã lỗi Hub của quy trình → câu hiển thị (plan-frontend-i18n §7) và `paths` lỗi ô.
import { processRunsMaxOf } from "@ai/contracts/chat";
import { describeError, type MessageSpec } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { backPathToField, STEP_ERR } from "./def-form";
import { crossRuleKey } from "./wait-form";

const KNOWN = new Set([
  "PROCESS_NOT_FOUND",
  "PROCESS_KEY_TAKEN",
  "PROCESS_DEF_INCOMPLETE",
  "PROCESS_DEF_INVALID",
  "PROCESS_REF_INVALID",
  "TEMPLATE_READ_ONLY",
  "SOURCE_NOT_FOUND",
  "NOT_PROCESS_DECIDER",
  "PROCESS_RUN_STATE",
  "NO_OUTPUT",
]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const errorCode = (err: unknown): string | null =>
  err instanceof ApiError ? String(err.code) : null;

export function processErrorSpec(err: unknown): MessageSpec {
  const code = errorCode(err);
  if (code === "TOO_MANY_PROCESS_RUNS") {
    return {
      key: "process.admin.apiError.TOO_MANY_PROCESS_RUNS",
      params: { max: processRunsMaxOf(err instanceof ApiError ? err.details : null) }, // N2-FR-04
    };
  }
  if (code && KNOWN.has(code)) return { key: `process.admin.apiError.${code}` };
  if (err instanceof ApiError && err.status === 403) return { key: "state.forbiddenAction" };
  return describeError(err);
}

/** `details.paths` (hoặc `details.path`) của `PROCESS_DEF_INVALID/INCOMPLETE/REF_INVALID`. */
export function serverPaths(err: unknown): string[] {
  if (!(err instanceof ApiError) || !isObj(err.details)) return [];
  const d = err.details;
  if (Array.isArray(d.paths)) return d.paths.filter((p): p is string => typeof p === "string");
  return typeof d.path === "string" ? [d.path] : [];
}

/** `details.rules` (song song với `paths`) của `PROCESS_DEF_INVALID`: mã luật chéo stage (P-b2, UAT L2). */
export function serverRules(err: unknown): string[] {
  if (!(err instanceof ApiError) || !isObj(err.details) || !Array.isArray(err.details.rules))
    return [];
  return err.details.rules.map((r) => (typeof r === "string" ? r : ""));
}

const STAGE_SOURCE_PATH = /^stages\.\d+\.sources\.\d+\.source_key$/;
const AUTOFIX_SOURCE_PATH = /^stages\.\d+\.autofix\.source_key$/;
const TOOL_REF_PATH = /^stages\.\d+\.executor\.tool_key$/;

/** Khoá câu lỗi cho một path của `PROCESS_*_INVALID`: nguồn giai đoạn ngoài danh sách (P-b) có câu riêng, còn lại theo mã. */
export function pathErrorKey(code: string, path: string): string {
  if (code === "PROCESS_REF_INVALID" && STAGE_SOURCE_PATH.test(path))
    return "process.admin.editor.stageSources.notInDef";
  if (code === "PROCESS_REF_INVALID" && AUTOFIX_SOURCE_PATH.test(path))
    return "process.admin.autofix.err.sourceKind";
  if (code === "PROCESS_REF_INVALID" && TOOL_REF_PATH.test(path))
    return "process.admin.editor.stage.tool.err.ref";
  return `process.admin.apiError.${code}`;
}

/** `paths` + `rules` song song ⇒ lỗi theo ô; luật bước/quay lại có câu riêng theo mã luật (UAT L2). */
export function serverErrors(
  code: string,
  paths: string[],
  rules: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  paths.forEach((p, i) => {
    const rule = rules[i] ?? "";
    const byRule =
      code === "PROCESS_DEF_INVALID"
        ? (STEP_ERR[rule] ?? crossRuleKey(rule) ?? undefined)
        : undefined;
    if (byRule) out[backPathToField(p)] = byRule;
    else out[p] ??= pathErrorKey(code, p);
  });
  return out;
}
